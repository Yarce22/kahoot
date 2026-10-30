# Progress dashboards

## Objective
Add a progress dashboard to the admin panel (each usuario's progress against the quizzes assigned to them) and to the usuario panel (the usuario's own progress across their quizzes).

## Problem / why
Admins have no overview of who has completed which assigned exams; usuarios have no summary of their own progress. Today the data exists only as paged lists (`GET /api/assignments`, `GET /api/attempts`, `GET /api/user/quizzes`).

## Decisions
- "Progress" = completed / assigned (count + %) plus average score and per-quiz score (user choice, 2026-10-29). No pass/fail concept (none exists in the schema), no due dates.
- Only the current cycle counts: assignment.status and the attempt whose cycle = assignment.cycle. An `expired` attempt does not complete the assignment.
- Admin dashboard respects store scope (`requireStoreScope` / `resolveStoreFilter`): plain admin sees only their punto_de_venta; superadmin sees all or filters by store.
- Aggregation is done server-side in new read-only endpoints (avoid client paging loops).
- No chart library: plain CSS progress bars.
- Login landing routes stay unchanged; dashboards are reached by a nav link.

## Scope
- Server: `GET /api/dashboard/progress` (admin), `GET /api/user/progress` (usuario).
- Client: `AdminDashboardView` at `/admin/dashboard`, `UserDashboardView` at `/user/dashboard`, router entries, nav links in `QuizListView.vue` header and `UserQuizzesView.vue` header.

## Constraints
- Usuario endpoint must never leak correct answers (see `server/src/lib/userSerializer.js`, `userNoLeak.test.js`).
- Match existing router/middleware/test conventions.

## TDD
- Mode: strict (source: orchestrator config "Strict TDD Mode: enabled").
- Runners: server `cd server && npm test` (node --test); client `cd client && npm test` (vitest).

## Delivery
- Branch: `feat/progress-dashboards`. Strategy: ask-on-risk; forecast ~700 authored lines → chain strategy `feature-branch-chain` (user choice, 2026-10-29). Slices: PR1 = T1+T2 (server), PR2 = T3+T4 (client), chained on the feature branch.
- Pre-existing commit on branch: `61ca91a fix(client): show answer placeholder only for open questions` (prior reviewed work, not part of this feature).

## Tasks
- [x] T1 — Server admin endpoint `GET /api/dashboard/progress` (store-scoped, per-usuario aggregate + per-quiz rows) with tests. Route: delegated (writer trigger: router + mount + tests). Commit `bfed3ca`. New router `server/src/routes/dashboard.js`, helper `server/src/domain/progress.js`.
- [x] T2 — Server usuario endpoint `GET /api/user/progress` with tests, no-leak. Route: delegated. Commit `f074189`.
- [x] T3 — Client admin dashboard view + store action + route + nav link, with tests. Route: delegated. Commit `c897e3e`.
- [x] T4 — Client usuario dashboard view + store action + route + nav link, with tests. Route: delegated. Commit `d046369`.
- [x] T5 — Admin dashboard filter: ignore out-of-order responses and clear stale rows on refetch error, with tests. Route: delegated (with T6). (User request 2026-10-29.) Commit `9194294`.
- [x] T6 — Add attemptId to progress rows and link completed quizzes to `/user/attempts/:id/result` in the usuario dashboard, with tests. Route: delegated. (User request 2026-10-29.) Commit `9ab4e3e`. Link shown when `attemptStatus === 'completed' && attemptId` (mirrors UserQuizzesView).
- [x] T7 — Validate both dashboards in a real browser. Route: inline (/browse). Admin side 2026-10-29 against the test Supabase DB (superadmin account): API 200 + store filter OK; UI renders, expand/collapse, filter, empty state, nav link, mobile 375 OK, no console errors. Usuario side 2026-10-29 (test usuario account): login → /user/quizzes, "Mi avance" link → /user/dashboard shows 1/1, 100%, promedio 80%, "Ver resultado" → /user/attempts/<id>/result with matching attempt id; result page shows no "(sin respuesta)"; mobile 375 OK; no console errors. First API loads take a few seconds (remote Supabase latency), not a hang. Visual notes (admin): average % is unlabeled next to completion %; bars don't align across rows.

## Acceptance criteria
- Admin sees, per usuario in scope: name, punto de venta, completed/assigned, % completed, average score of completed quizzes, and per-quiz status + score.
- Usuario sees completed/assigned, %, average score, and per-quiz status + score.
- Plain admin cannot see other stores; usuario sees only their own data.
- All server and client tests pass.

## Progress / evidence
- T1/T2: RED observed (ERR_MODULE_NOT_FOUND for progress.js/dashboard.js; userProgress 4/6 failing), then GREEN. `cd server && npm test`: 510 pass, 0 fail (writer + parent spot check).
- Known limit: admin query capped at 5000 rows (`shortcut:` comment); embedded `attempts:quiz_attempts(...)` select verified only against mocks, not a live PostgREST.
- RDD: assess on 61ca91a..f074189 → medium, 537 lines, review_due (slice_budget_reached). Review granted → approved, acknowledged (lineage review-259eaacacb7f3079). Reviewed boundary: acd8ab6.
- Advisory findings: null full_name crashed sort (500) and capped read had no order → fixed in `bb93910` (RED: TypeError localeCompare; GREEN 511/511; mock now records `.order`). Not addressed (SUGGESTION): completed count uses assignment.status while averageScore uses current-cycle attempt status — can disagree if data is inconsistent.
- bb93910 assess → medium, 36 lines, under_budget (pending in next slice).
- T3/T4: RED observed (fetchProgress not a function, view imports missing, nav/route-guard tests failing), then GREEN. `cd client && npm test`: 26 files / 199 tests pass (writer + parent spot check); `npm run build` OK (writer); server 511/511 (writer). UI not checked in a browser.
- RDD: acd8ab6..d046369 → medium, 613 lines, slice_budget_reached. Review granted → approved, acknowledged (lineage review-1fabf04bf7132c79). Reviewed boundary: d046369.
- Advisory (open): admin store filter can race on quick changes and keeps stale rows after a failed refetch; `assigned_at` order has no unique tiebreaker (column verified to exist, schema.sql:216).
- Gap: `/api/user/progress` rows carry no attempt id, so completed quizzes don't link to the result view.

- T5/T6: RED observed (stale response overwrote newer data; old rows stayed beside error; attemptId deepEqual failed; no link rendered), then GREEN. Parent spot check: client 202/202, server 511/511; build OK (writer).
- RDD: d046369..9ab4e3e → medium, 103 lines, under_budget (pending in next slice).
- T8 (user request 2026-10-29): admin dashboard metrics labelled ("Avance", "Promedio") and aligned with a fixed-column grid → `8ec92a5`. RED: label test failed; GREEN: client 203/203, build OK; browser-checked desktop + mobile 375, no console errors.
- RDD (user-requested): d046369..8ec92a5 → medium, 146 lines. Review granted → approved with no findings, acknowledged (lineage review-b01d9dde620f4b76). Reviewed boundary: 8ec92a5. Every code commit on the branch is now reviewed.

## Next step
Push + PRs (PR1 server, PR2 client, feature-branch-chain) — user decision.
