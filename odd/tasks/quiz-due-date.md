# Quiz due date (fecha límite)

## Objective
Optional per-quiz deadline set when creating/editing an exam. After it, usuarios cannot start, resume, answer or submit the exam, and any not-completed assignment shows as "Vencido". User request 2026-10-30; the user chose "optional" (empty = never expires).

## Constraints
- DB: new column `quizzes.due_at timestamptz NULL`. Migration `supabase/migrations/018_quiz_due_at.sql` (idempotent, ends with `NOTIFY pgrst, 'reload schema';`) + `supabase/schema.sql`. Migrations are applied manually to Supabase — applying to the test DB needs the user's go-ahead.
- Completed attempts stay "Completado" and keep "Ver resultado" after the deadline.
- Server is the trust boundary: the deadline is enforced server-side, client only reflects it.
- Do not touch live PIN session code; keep `time_limit_seconds` untouched.

## TDD
- Mode: strict. Server: `cd server && npm test` (node --test, supertest + `test/helpers/mockSupabase.js`). Client: `cd client && npm test` (vitest), build `npm run build`.

## Delivery
- Branch `feat/quiz-due-date`, stacked on `feat/hide-live-sessions` (both edit QuizEditorView). Strategy ask-on-risk.

## Tasks
- [ ] T1 — Migration 018 + schema.sql. Route: delegated writer (writer trigger: 2+ non-trivial files across server/client).
- [ ] T2 — Server: validate `due_at` (null or ISO date) on quiz POST/PUT and return it in admin selects; block start/resume after due (409 `QUIZ_PAST_DUE`), clamp new attempts' `expires_at` to `due_at` so answer/submit are covered; expose `dueAt` in `/api/user/quizzes`, `/api/user/progress`, `/api/dashboard/progress` (toProgressRow) and the admin assignments list. Route: same writer.
- [ ] T3 — Client: datetime-local "Fecha límite" in the editor (empty → null); `statusLabel` returns "Vencido" when `dueAt` passed and not completed; UserQuizzesView hides start/continue past due; UserAttemptView message for `QUIZ_PAST_DUE`. Route: same writer.
- [ ] T4 — Browser validation against the test DB (needs migration 018 applied). Route: inline.

## Progress / evidence

## Next step
T1–T3 via one writer.
