# IGCSE MathApp

Cambridge IGCSE **0580 Extended** past-paper revision app. Standalone — no
dependency on Lovable Cloud at runtime. Ported from `cambridge-math-quest`
(the AS/A-Level 9709 app), which remains a separate product.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React 18 + TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query |
| Backend | Supabase (project ref `vbotzafrmgkvncdsdfut`, region `eu-west-1`) |
| AI | Anthropic Claude, called **directly** from edge functions |
| Hosting | Netlify — `npm run build` → `dist`, SPA redirect in `netlify.toml` |
| UI editing | Lovable connects late, as a visual editor on `src/` only |

## Commands

```sh
npm run dev        # vite dev server on :8080
npm run build      # production build
npm run lint       # eslint — keep this at 0 errors
npm run typecheck  # tsc -b --noEmit
```

## Domain model

- **Syllabus 0580, Extended tier only.** Papers `21 22 23` are non-calculator,
  `41 42 43` are calculator. The second digit is the regional variant.
- **Only 2025-onward papers.** One syllabus version, so no version field on
  subtopics.
- Questions are keyed by `(tier, year, sitting, variant, question_number)` with a
  unique constraint. `paper` and `calculator` are generated columns derived
  from `variant`, so the three can never disagree.
- **Topics are relational**, not comma-separated strings. This is a deliberate
  fix to a Cambridge design flaw — do not reintroduce string parsing.
- `student_attempts` links to questions by `question_id` foreign key, not by
  copying the paper coordinates.

### Bulk upload filename convention

Admin bulk upload derives all metadata from Cambridge's official naming:

```
0580_m25_qp_22_q07.jpg     question
0580_m25_ms_22_q07.jpg     mark scheme (paired automatically)
```

`m`=Feb/Mar, `s`=May/Jun, `w`=Oct/Nov. Files that don't match are skipped.

## Access model

Content is free; the gate is anything that costs an API call.

| Capability | Anonymous | Free account | Paid |
|---|---|---|---|
| View questions + mark schemes, browse, search | yes | yes | yes |
| Manual progress checkboxes | yes (localStorage) | yes (synced) | yes |
| AI hints, AI marking, storing work photos, Test Maker | no | no | yes |

Revenue is a markup on AI calls, so **every AI call must go through the credit
ledger** (`deduct_credits`). Metering ships before checkout does.

## Conventions

- **Never** commit `.env`. Both `VITE_` values are browser-safe, but the
  service-role key belongs only in edge-function secrets.
- RLS on every table from its first migration. Public read on published
  content; owner-only on anything user-scoped; admin override via the
  `has_role` security-definer function.
- **Two storage buckets, opposite policies:** `exam-images` is public and
  CDN-cacheable (past papers are public documents, never paywalled);
  `student-work` is private and owner-scoped.
- Do **not** reintroduce signed URLs for exam images. Cambridge re-mints them
  on every boot and auth change, which defeats CDN caching entirely and makes
  every view uncached egress.
- **Never filter a client query by a list of every row's id.** Parts and
  subtopic links were once fetched with `.in("question_id", <347 uuids>)`,
  which put 13 kB in a GET query string and forced a second round trip. RLS
  already scopes both tables to published questions, so the filter was pure
  cost. Let RLS do the filtering.
- **Page every list query.** PostgREST truncates at the project's max-rows
  setting (1,000) and reports it nowhere the client can see. `question_parts`
  passes that with one more exam series.
- **No `@import` for fonts or any external asset in CSS.** The preload scanner
  cannot see it, so it cannot start until the CSS bundle is parsed. Link it
  from `index.html` with `preconnect`.
- Keep routes lazily loaded and vendor chunks split. Students must never
  download the admin bundle, and `/assets/*` is fingerprinted so it is cached
  `immutable` while `index.html` must revalidate.
- Edge functions call the Anthropic API directly. Use structured outputs for
  anything parsed (mark breakdowns, metadata suggestions) and prompt caching
  for the syllabus tree.
- Lovable edits `src/` only. `supabase/` stays under version control here.

## Phase status

- [x] **Phase 0 — Foundations.** Scaffold, shadcn layer, native Supabase auth,
      Netlify config. Build and lint green.
- [x] **Phase 1 — Data model.** Schema, RLS, ledger, both buckets, generated
      types. Seeded from the hand-built question index: 9 topics, 72 subtopics,
      **347 questions, 582 parts, 441 subtopic links** across all 14 papers of
      the 2025 series. Questions land `is_published = false` until images are
      attached in Phase 2.
- [x] **Phase 2 — Admin and ingestion.** Bulk uploader parses Cambridge
      filenames, matches to seeded rows, uploads to `exam-images`, publishes a
      question once both its images are present. Admin coverage dashboard shows
      progress per paper. **The full 2025 set is in: 694 images, 347/347
      questions published, every DB path resolving to a stored object and no
      orphans. 58 MB total, 86 kB average.**
      Auto-tagging is **not needed** — the index already carries topics, marks,
      parts and diagram flags. OCR transcription stays optional.
- [x] **Phase 3 — Practice, AI marking, metering.** Practice browser, question
      view with mark-scheme reveal, self-assessment (localStorage for anonymous,
      migrating on sign-in). `mark-work` edge function live: Claude Opus 5,
      adaptive thinking, structured output for the mark breakdown, the marking
      rubric held in a cached prompt prefix. Charges the ledger before the model
      call and refunds on failure. Verified end to end against a real
      submission: part-level breakdown, a specific diagnosed error rather than
      a vague label, and the attempt row written.
      **Metering shipped.** `ai_usage` records one row per call that reached
      the model — token counts, cost frozen at write time from the versioned
      `ai_model_pricing` table, who paid, and the outcome. Deliberately a
      separate axis from the credit ledger, which is silent for admins and is
      erased by a refund. Refusals and unreadable responses are recorded as
      `refunded` + real cost, because they are billed by Anthropic and earn
      nothing. Admin dashboard shows cost per marking, refunded-but-billed
      spend, cache hit rate and median duration.
      Remaining: `generate-hint` must call `record_ai_usage` too when built.
- [~] **Phase 4 — Progress tracking.** `/progress` renders the whole Extended
      syllabus as a grid: 9 sections, 72 subtopics, banded secure / nearly
      there / needs work / not attempted / no questions yet. Opening a subtopic
      shows every question carrying that code, with a NEXT marker on the
      suggested one (first unattempted, else weakest).
      **A subtopic is banded on its *attempted* marks, never on coverage** —
      judging it on all available marks would show red to a student who
      answered one question perfectly. Coverage is a separate `qDone/qTotal`.
      **Mark attribution: a question tagged with several codes splits its marks
      evenly between them.** `question_subtopics` links whole questions, not
      parts, so nothing finer is available; the even split keeps attributed
      marks summing back to the paper totals (1,400), where crediting each code
      the full marks would double-count.
      Remaining: the grid is built from AI-marked attempts only, so a free user
      who has only ticked the manual self-assessment boxes sees an all-grey
      grid. `manual_completions` is not yet folded in.
- [ ] **Phase 5 — Polish, Lovable handoff, launch.**

Deferred: Paddle checkout, Test Maker, 0580 Core, coaching.

## Data provenance

The question bank comes from a hand-built index of the 2025 series, not from
AI tagging. It reconciles exactly: every paper totals 100 marks, every
question's parts sum to its total, all 441 syllabus references resolve. 67 of
the 72 Extended subtopics were examined in 2025 — E1.3, E3.6, E5.5, E9.1 and
E9.2 were not, so progress views need a "not yet examined" state rather than
showing them as 0% coverage.

## Not yet wired

- **Google OAuth** needs credentials in Supabase → Auth → Providers, with the
  redirect allowlist covering the Netlify domain, deploy previews and
  `localhost`.
- **Admin role.** Granted. Admins bypass the credit ledger entirely
  (`deduct_credits` returns `admin_bypass`), so marking is free while testing.
- **Credits for non-admins.** No checkout yet. Grant manually:
  `select grant_credits('<uuid>', 20, 'manual');` Price the credit off
  `ai_usage`, not off a guess — cost per successful marking is on the admin
  dashboard.
- **Leaked-password protection** is off. One toggle in Supabase → Auth →
  Providers, flagged by the security advisor.
- **`generate-hint`** is not built yet — marking is the only AI call so far.
