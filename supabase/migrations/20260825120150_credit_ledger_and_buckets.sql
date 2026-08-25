-- Credit ledger. Revenue is a markup on AI calls, so every AI call is metered
-- from day one; checkout arrives later, the ledger does not.
-- Atomic: locks the balance row before checking it, so two concurrent AI calls
-- cannot both spend the last credit.

create or replace function public.deduct_credits(
  _user_id uuid, _base_cost numeric, _reason text, _metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare _balance numeric; _is_admin boolean;
begin
  select public.has_role(_user_id, 'admin') into _is_admin;
  if _is_admin then
    return jsonb_build_object('allowed', true, 'reason', 'admin_bypass',
                              'charged', 0, 'new_balance', null);
  end if;

  select balance into _balance from public.user_credits where user_id = _user_id for update;
  if _balance is null then
    insert into public.user_credits (user_id, balance) values (_user_id, 0)
      on conflict (user_id) do nothing;
    _balance := 0;
  end if;

  if _balance < _base_cost then
    return jsonb_build_object('allowed', false, 'reason', 'insufficient_credits',
                              'charged', 0, 'new_balance', _balance);
  end if;

  update public.user_credits set balance = balance - _base_cost, updated_at = now()
   where user_id = _user_id returning balance into _balance;
  insert into public.credit_transactions (user_id, amount, reason, metadata)
  values (_user_id, -_base_cost, _reason, _metadata);

  return jsonb_build_object('allowed', true, 'reason', 'charged',
                            'charged', _base_cost, 'new_balance', _balance);
end; $$;

create or replace function public.grant_credits(
  _user_id uuid, _amount numeric, _reason text default 'grant', _metadata jsonb default '{}'::jsonb
) returns numeric language plpgsql security definer set search_path = public as $$
declare _balance numeric;
begin
  insert into public.user_credits (user_id, balance) values (_user_id, _amount)
  on conflict (user_id) do update
    set balance = public.user_credits.balance + _amount, updated_at = now()
  returning balance into _balance;
  insert into public.credit_transactions (user_id, amount, reason, metadata)
  values (_user_id, _amount, _reason, _metadata);
  return _balance;
end; $$;

-- Storage: two buckets, deliberately opposite policies.
--   exam-images  PUBLIC  — past papers are public documents, never paywalled.
--                Stable public URLs let the CDN cache across users; signed
--                URLs would defeat that (each token is its own cache key).
--   student-work PRIVATE — a student's handwriting, tied to their scores.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('exam-images',  'exam-images',  true,  10485760, array['image/jpeg','image/png','image/webp']),
  ('student-work', 'student-work', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

create policy "Exam images are publicly readable"
  on storage.objects for select to anon, authenticated using (bucket_id = 'exam-images');
create policy "Admins manage exam images"
  on storage.objects for all to authenticated
  using (bucket_id = 'exam-images' and public.has_role(auth.uid(), 'admin'))
  with check (bucket_id = 'exam-images' and public.has_role(auth.uid(), 'admin'));

-- Each student's folder is named for their user id — enforced here, not in
-- the client.
create policy "Users read own work images"
  on storage.objects for select to authenticated
  using (bucket_id = 'student-work' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users upload own work images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'student-work' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own work images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'student-work' and (storage.foldername(name))[1] = auth.uid()::text);
