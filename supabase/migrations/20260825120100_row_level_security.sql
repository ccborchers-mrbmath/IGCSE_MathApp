-- RLS on every table. Past papers are public documents and are never
-- paywalled, so anonymous visitors read published content; everything
-- user-scoped is owner-only with an admin override via has_role().

alter table public.profiles            enable row level security;
alter table public.user_roles          enable row level security;
alter table public.topics              enable row level security;
alter table public.subtopics           enable row level security;
alter table public.questions           enable row level security;
alter table public.question_parts      enable row level security;
alter table public.question_subtopics  enable row level security;
alter table public.student_attempts    enable row level security;
alter table public.manual_completions  enable row level security;
alter table public.user_credits        enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.feedback            enable row level security;

-- content ------------------------------------------------------------------
create policy "Syllabus topics are public"
  on public.topics for select to anon, authenticated using (true);
create policy "Admins manage topics"
  on public.topics for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "Syllabus subtopics are public"
  on public.subtopics for select to anon, authenticated using (true);
create policy "Admins manage subtopics"
  on public.subtopics for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "Published questions are public"
  on public.questions for select to anon, authenticated using (is_published);
create policy "Admins read all questions"
  on public.questions for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins manage questions"
  on public.questions for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "Parts of published questions are public"
  on public.question_parts for select to anon, authenticated
  using (exists (select 1 from public.questions q where q.id = question_id and q.is_published));
create policy "Admins manage question parts"
  on public.question_parts for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "Subtopic links of published questions are public"
  on public.question_subtopics for select to anon, authenticated
  using (exists (select 1 from public.questions q where q.id = question_id and q.is_published));
create policy "Admins manage question subtopics"
  on public.question_subtopics for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- identity -----------------------------------------------------------------
create policy "Users read own profile"
  on public.profiles for select to authenticated using (auth.uid() = user_id);
create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Admins read all profiles"
  on public.profiles for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "Users read own roles"
  on public.user_roles for select to authenticated using (auth.uid() = user_id);
create policy "Admins manage roles"
  on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- student data — a student must never read another student's work ----------
create policy "Users manage own attempts"
  on public.student_attempts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Admins read all attempts"
  on public.student_attempts for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "Users manage own completions"
  on public.manual_completions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ai metering — readable by owner, writable only by the ledger functions ----
create policy "Users read own credit balance"
  on public.user_credits for select to authenticated using (auth.uid() = user_id);
create policy "Admins read all credit balances"
  on public.user_credits for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Users read own credit transactions"
  on public.credit_transactions for select to authenticated using (auth.uid() = user_id);
create policy "Admins read all credit transactions"
  on public.credit_transactions for select to authenticated using (public.has_role(auth.uid(), 'admin'));

revoke insert, update, delete on public.user_credits        from anon, authenticated;
revoke insert, update, delete on public.credit_transactions from anon, authenticated;

-- feedback -----------------------------------------------------------------
create policy "Anyone may leave feedback"
  on public.feedback for insert to anon, authenticated with check (true);
create policy "Admins read feedback"
  on public.feedback for select to authenticated using (public.has_role(auth.uid(), 'admin'));
