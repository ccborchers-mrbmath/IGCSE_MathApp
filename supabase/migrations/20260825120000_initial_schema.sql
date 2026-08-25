-- ============================================================================
-- IGCSE 0580 Extended — initial schema
--
-- Single squashed migration. Deliberate departures from cambridge-math-quest:
--   * topics/subtopics are relational, never comma-separated strings
--   * student_attempts links to questions by FK, not by copying paper coords
--   * questions carry a unique key so bulk upload is an idempotent upsert
--   * paper/calculator are generated from variant, so they cannot disagree
-- ============================================================================

create type public.app_role            as enum ('admin', 'student');
create type public.tier                as enum ('core', 'extended');
create type public.exam_sitting        as enum ('Feb-March', 'May-June', 'Oct-Nov');
create type public.question_dependency as enum ('single', 'linked', 'independent');
create type public.self_confidence     as enum ('easy', 'ok', 'struggled');

-- ---------------------------------------------------------------- identity --

create table public.profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- SECURITY DEFINER so RLS policies can check roles without recursing into
-- user_roles' own policies.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Mirror new auth users into profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- syllabus --

create table public.topics (
  id             uuid primary key default gen_random_uuid(),
  tier           public.tier not null default 'extended',
  section_number int  not null,
  name           text not null,
  unique (tier, section_number)
);

create table public.subtopics (
  id       uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  code     text not null unique,          -- 'E1.4'
  title    text not null,                 -- 'Fractions, decimals and percentages'
  position int  not null
);

create index subtopics_topic_id_idx on public.subtopics (topic_id);

-- --------------------------------------------------------------- questions --

create table public.questions (
  id              uuid primary key default gen_random_uuid(),
  tier            public.tier not null default 'extended',
  year            int  not null check (year >= 2025),
  sitting         public.exam_sitting not null,
  -- Cambridge paper code: 21/22/23 (non-calculator) or 41/42/43 (calculator).
  -- paper and calculator are derived so the three can never disagree.
  variant         int  not null check (variant in (21, 22, 23, 41, 42, 43)),
  paper           int  generated always as (variant / 10) stored,
  calculator      boolean generated always as (variant >= 40) stored,
  question_number int  not null check (question_number > 0),
  marks           int  not null check (marks > 0),
  summary         text,
  has_diagram     boolean not null default false,
  dependency      public.question_dependency not null default 'single',
  primary_topic_id uuid references public.topics(id) on delete set null,
  source_file     text,                   -- provenance from the question index
  question_image_path   text,
  markscheme_image_path text,
  question_text         text,             -- LaTeX transcription (Phase 2)
  markscheme_text       text,
  is_published    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tier, year, sitting, variant, question_number)
);

create index questions_published_idx  on public.questions (is_published) where is_published;
create index questions_topic_idx      on public.questions (primary_topic_id);
create index questions_paper_idx      on public.questions (year, sitting, variant);

create table public.question_parts (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label       text,                       -- 'a', 'b(ii)', 'a,b'; null when single-part
  description text not null,
  marks       int  not null check (marks > 0),
  position    int  not null,
  unique (question_id, position)
);

create index question_parts_question_idx on public.question_parts (question_id);

create table public.question_subtopics (
  question_id uuid not null references public.questions(id)  on delete cascade,
  subtopic_id uuid not null references public.subtopics(id)  on delete cascade,
  is_primary  boolean not null default false,
  primary key (question_id, subtopic_id)
);

create index question_subtopics_subtopic_idx on public.question_subtopics (subtopic_id);

-- ------------------------------------------------------------ student data --

create table public.student_attempts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  question_id         uuid not null references public.questions(id) on delete cascade,
  attempted           boolean not null default true,
  percentage_attained numeric(5,2) check (percentage_attained between 0 and 100),
  marks_awarded       numeric(5,2),
  mark_breakdown      jsonb,
  ai_feedback         text,
  nature_of_errors    text,
  work_image_paths    text[],             -- private student-work bucket
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index student_attempts_user_idx     on public.student_attempts (user_id);
create index student_attempts_question_idx on public.student_attempts (question_id);

create table public.manual_completions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  confidence  public.self_confidence not null default 'ok',
  completed_at timestamptz not null default now(),
  unique (user_id, question_id)
);

create index manual_completions_user_idx on public.manual_completions (user_id);

-- ------------------------------------------------------------- ai metering --
-- Revenue is a markup on AI calls, so every AI call is metered from day one.
-- Checkout arrives later; the ledger does not.

create table public.user_credits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table public.credit_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     numeric(12,2) not null,      -- negative = spend, positive = grant
  reason     text not null,               -- 'ai_marking' | 'ai_hint' | 'grant' | ...
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index credit_transactions_user_idx on public.credit_transactions (user_id, created_at desc);

create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  message    text not null,
  page       text,
  created_at timestamptz not null default now()
);
