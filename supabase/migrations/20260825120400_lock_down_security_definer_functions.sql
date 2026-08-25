-- Postgres grants EXECUTE on new functions to PUBLIC by default, and anon /
-- authenticated inherit that. Revoking from those two roles alone leaves the
-- PUBLIC grant in place, so the functions stay callable over /rest/v1/rpc/.
-- Revoke from PUBLIC to actually close it.

-- Ledger functions: edge functions call these with the service-role key only.
-- A client that could call them directly could grant itself unlimited credit.
revoke execute on function public.deduct_credits(uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke execute on function public.grant_credits(uuid, numeric, text, jsonb)  from public, anon, authenticated;

-- Trigger function: fired by the trigger on auth.users, never called directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- has_role is different: RLS policy expressions are evaluated as the querying
-- user, so `authenticated` MUST retain EXECUTE or every admin policy fails
-- closed. Anonymous visitors never hit a has_role policy, so revoke it there.
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
grant  execute on function public.has_role(uuid, public.app_role) to authenticated;
