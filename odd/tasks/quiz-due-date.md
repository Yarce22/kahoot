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
- [x] T1 — Migration 018 + schema.sql. Route: delegated writer (writer trigger: 2+ non-trivial files across server/client).
- [x] T2 — Server: validate `due_at` (null or ISO date) on quiz POST/PUT and return it in admin selects; block start/resume after due (409 `QUIZ_PAST_DUE`), clamp new attempts' `expires_at` to `due_at` so answer/submit are covered; expose `dueAt` in `/api/user/quizzes`, `/api/user/progress`, `/api/dashboard/progress` (toProgressRow) and the admin assignments list. Route: same writer.
- [x] T3 — Client: datetime-local "Fecha límite" in the editor (empty → null); `statusLabel` returns "Vencido" when `dueAt` passed and not completed; UserQuizzesView hides start/continue past due; UserAttemptView message for `QUIZ_PAST_DUE`. Route: same writer.
- [~] T4 — Browser validation against the test DB. Route: inline. Migration 018 applied to kahoot-bianco by the orchestrator (user-authorized), column verified. Checked: editor saves due_at (18:00 local -> 23:00 UTC) and reloads it; with a past due_at, completed assignments stay Completado (dashboard Vencido 0) and the usuario keeps "Ver resultado"; due_at restored to NULL afterwards. NOT browser-checked: the past-due block on a pending/in-progress assignment (no pending assignments in the test DB; covered by server+client tests).

## Progress / evidence
- T1 d96b453 feat(db): add quizzes.due_at. Migration 018 matches the statement the orchestrator applied to the test DB (no CHECK); schema.sql updated.
- T2 23872a8 feat(server): enforce and expose quiz due dates. RED: quizDueAt.test.js (PUT invalid due_at 500!==400, PUT/GET selects lacked due_at), quizDueDateEnforcement.test.js (QUIZ_PAST_DUE new/resume, expires_at clamp, dueAt in user quizzes/progress/dashboard/assignments), progress.test.js dueAt. GREEN: npm test 527 pass / 0 fail.
- T3 1688acd feat(client): set and show quiz due dates. RED: 8 tests (statusLabel Vencido, UserQuizzesView badge/"Vence el", UserAttemptView QUIZ_PAST_DUE, editor due_at load/save). GREEN: vitest 246 pass; npm run build OK.
- Changed existing assertions (new field only): toProgressRow/userProgress/dashboard/userQuizzes deepEquals gained dueAt.
- Shortcut: an in-progress attempt keeps the deadline it started with if due_at is later changed (comment in userQuizzes.js).
- Route: delegated writer (writer trigger).

## Next step
Push/PR when the user asks; optional full past-due browser check by reactivating an assignment.
