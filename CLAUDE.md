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
- [x] **Phase 1 — Data model.** Schema, RLS, ledger, both buckets, generated
      types. Seeded from the hand-built question index: 9 topics, 72 subtopics,
      **347 questions, 582 parts, 441 subtopic links** across all 14 papers of
      the 2025 series. Questions land `is_published = false` until images are
      attached in Phase 2.
- [ ] **Phase 2 — Admin and ingestion.** Bulk image upload matched to the
      seeded rows by `(year, sitting, variant, question_number)`, then publish.
      Auto-tagging is **not needed** — the index already carries topics, marks,
      parts and diagram flags. OCR transcription stays optional.
- [ ] **Phase 3 — Practice, AI marking, metering.**
- [ ] **Phase 4 — Progress tracking.**
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

- **Question images.** All 347 rows exist but are unpublished and have no
  `question_image_path`. Nothing is visible to students until Phase 2.
- **Google OAuth** needs credentials in Supabase → Auth → Providers, with the
  redirect allowlist covering the Netlify domain, deploy previews and
  `localhost`.
- **Admin role.** Grant yourself one once you have signed in:
  `insert into user_roles (user_id, role) values ('<your-uuid>', 'admin');`
