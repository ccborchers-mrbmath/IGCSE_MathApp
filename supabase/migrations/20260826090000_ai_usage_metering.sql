-- Per-call AI cost metering.
--
-- The credit ledger records what the *student* was charged. It deliberately
-- says nothing about what the call *cost*, and it skips admins entirely
-- (deduct_credits returns admin_bypass without writing a row). Since the
-- business model is a markup on API calls, cost per call has to be recorded
-- on its own axis, for every call, whatever the billing outcome.
--
-- Two facts this table is built to expose that the ledger cannot:
--   * a refusal or an unreadable response still burns tokens, and the student
--     is refunded — that is pure margin loss, and it must be visible;
--   * admin testing costs real money while charging nobody.

create table public.ai_model_pricing (
  model                text        not null,
  effective_from       timestamptz not null default now(),
  input_per_mtok       numeric(10, 4) not null,
  output_per_mtok      numeric(10, 4) not null,
  cache_write_per_mtok numeric(10, 4) not null,
  cache_read_per_mtok  numeric(10, 4) not null,
  primary key (model, effective_from)
);

comment on table public.ai_model_pricing is
  'USD per million tokens, versioned by effective_from. Rates change; historical
   cost must not. ai_usage.cost_usd is computed at write time and frozen.';

-- Anthropic list price, Claude Opus 5. Cache writes bill at 1.25x input,
-- cache reads at 0.1x input.
insert into public.ai_model_pricing
  (model, effective_from, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok)
values
  ('claude-opus-5', '2026-01-01 00:00:00+00', 5.0000, 25.0000, 6.2500, 0.5000);

create table public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  function_name      text not null,
  model              text not null,
  question_id        uuid references public.questions (id) on delete set null,
  attempt_id         uuid references public.student_attempts (id) on delete set null,

  input_tokens       integer not null default 0 check (input_tokens       >= 0),
  output_tokens      integer not null default 0 check (output_tokens      >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens  >= 0),

  -- Frozen at write time from the rate row in force, so re-pricing later
  -- never rewrites history.
  cost_usd        numeric(12, 6) not null default 0 check (cost_usd >= 0),
  credits_charged numeric(10, 2) not null default 0,

  billing text not null check (billing in ('charged', 'admin_bypass', 'refunded')),
  outcome text not null check (outcome in ('ok', 'refusal', 'unreadable', 'error')),

  duration_ms integer check (duration_ms >= 0),
  created_at  timestamptz not null default now()
);

create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);
create index ai_usage_created_idx      on public.ai_usage (created_at desc);

alter table public.ai_model_pricing enable row level security;
alter table public.ai_usage         enable row level security;

-- Rates are commercially sensitive: admins only, and only the service role
-- writes them.
create policy "Admins read pricing"
  on public.ai_model_pricing for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- A student may see what their own calls cost; admins see everything. There
-- is deliberately no insert/update/delete policy on either table — only the
-- service role, which bypasses RLS, may write. Usage rows are evidence, and
-- the subject of the evidence must not be able to author them.
create policy "Users read their own AI usage"
  on public.ai_usage for select to authenticated
  using (user_id = auth.uid());
create policy "Admins read all AI usage"
  on public.ai_usage for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Cost arithmetic lives here rather than in the edge function so that every
-- caller prices identically and a rate change is a single insert.
create function public.record_ai_usage(
  p_user_id       uuid,
  p_function_name text,
  p_model         text,
  p_billing       text,
  p_outcome       text,
  p_input_tokens       integer default 0,
  p_output_tokens      integer default 0,
  p_cache_write_tokens integer default 0,
  p_cache_read_tokens  integer default 0,
  p_credits_charged numeric default 0,
  p_question_id     uuid    default null,
  p_attempt_id      uuid    default null,
  p_duration_ms     integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rate public.ai_model_pricing%rowtype;
  v_cost numeric(12, 6) := 0;
  v_id   uuid;
begin
  select * into v_rate
  from public.ai_model_pricing
  where model = p_model and effective_from <= now()
  order by effective_from desc
  limit 1;

  -- An unpriced model must not silently record as free: leave cost at zero
  -- but let the row land, so the gap is visible as tokens without cost
  -- rather than as a missing call.
  if found then
    v_cost := (
        coalesce(p_input_tokens,       0)::numeric * v_rate.input_per_mtok
      + coalesce(p_output_tokens,      0)::numeric * v_rate.output_per_mtok
      + coalesce(p_cache_write_tokens, 0)::numeric * v_rate.cache_write_per_mtok
      + coalesce(p_cache_read_tokens,  0)::numeric * v_rate.cache_read_per_mtok
    ) / 1000000;
  end if;

  insert into public.ai_usage (
    user_id, function_name, model, question_id, attempt_id,
    input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
    cost_usd, credits_charged, billing, outcome, duration_ms
  ) values (
    p_user_id, p_function_name, p_model, p_question_id, p_attempt_id,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_cache_write_tokens, 0), coalesce(p_cache_read_tokens, 0),
    v_cost, coalesce(p_credits_charged, 0), p_billing, p_outcome, p_duration_ms
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Same lesson as the ledger functions: Postgres grants EXECUTE to PUBLIC by
-- default, so revoke from PUBLIC — revoking from anon/authenticated alone
-- leaves it reachable over /rest/v1/rpc/.
revoke execute on function public.record_ai_usage(
  uuid, text, text, text, text, integer, integer, integer, integer,
  numeric, uuid, uuid, integer
) from public, anon, authenticated;
