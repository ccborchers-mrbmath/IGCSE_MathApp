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
- Questions are keyed by `(tier, year, sitting, paper_number, question_number)`
  with a unique constraint, so bulk upload is an idempotent upsert.
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
- Edge functions call the Anthropic API directly. Use structured outputs for
  anything parsed (mark breakdowns, metadata suggestions) and prompt caching
  for the syllabus tree.
- Lovable edits `src/` only. `supabase/` stays under version control here.

## Phase status

- [x] **Phase 0 — Foundations.** Scaffold, shadcn layer, native Supabase auth,
      Netlify config. Build and lint green.
- [ ] **Phase 1 — Data model.** Migrations, RLS, seed the 0580 topic tree,
      create both buckets, generate `src/integrations/supabase/types.ts`.
- [ ] **Phase 2 — Admin and ingestion.** Bulk upload, OCR, auto-tagging,
      review queue. Measure real token costs before any batch run.
- [ ] **Phase 3 — Practice, AI marking, metering.**
- [ ] **Phase 4 — Progress tracking.**
- [ ] **Phase 5 — Polish, Lovable handoff, launch.**

Deferred: Paddle checkout, Test Maker, 0580 Core, coaching.

## Not yet wired

- `src/integrations/supabase/types.ts` — generated in Phase 1. Until then the
  Supabase client is untyped and `user_roles` queries fail gracefully to
  `student`.
- Google OAuth needs credentials in Supabase → Auth → Providers, with the
  redirect allowlist covering the Netlify domain, deploy previews and
  `localhost`.
