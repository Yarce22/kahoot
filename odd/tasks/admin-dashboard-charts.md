# Admin dashboard: charts and filters

## Objective
Redesign the admin progress dashboard (`/admin/dashboard`) with KPI tiles, charts, and filters by punto de venta, usuario, and exam.

## Problem / why
The dashboard is a flat list of usuarios: no overview, no way to see progress per exam, and only superadmins can filter (by store). User request 2026-10-30.

## Decisions
- No new dependency: charts are plain HTML/CSS bars (the data is small; a chart library is not worth it).
- No server change: `GET /api/dashboard/progress` already returns every usuario with per-quiz rows (`quizId`, `quizTitle`, `status`, `attemptStatus`, `scorePercent`). Usuario and exam filters run client-side on that payload; punto de venta stays server-side (superadmin only, plain admins are pinned to their store).
- Status colors (validated with the dataviz validator on surface `#ebddc5`): Completado `#56633f`, En progreso `#d67f48`, Vencido `#8c491a`, Pendiente `#a69d8e`. CVD + normal-vision separation PASS; chroma floor fails because the brand is muted and contrast WARNs, so every segment carries a visible label + count (no color-only identity).

## Scope
- `client/src/lib/progress.js`: pure helpers `summarize`, `statusCounts`, `byQuiz`, `byPunto`.
- New presentational components under `client/src/components/dashboard/`.
- `client/src/views/admin/AdminDashboardView.vue`: filters row, KPI tiles, charts, filtered usuario list.
- Tests in `client/test/`.

## TDD
- Mode: strict (source: orchestrator config "Strict TDD Mode: enabled").
- Runner: `cd client && npm test` (vitest); build `cd client && npm run build`.

## Delivery
- Branch: `feat/admin-dashboard-charts`. Strategy: ask-on-risk; forecast ~450 authored lines (about half tests).

## Tasks
- [x] T1 — Pure aggregation helpers in `lib/progress.js` with unit tests. Route: delegated (writer trigger: helpers + components + view + tests). Commit `ccf62f8`.
- [x] T2 — Chart components + redesigned view with usuario/exam/punto filters, with view tests. Route: delegated (same writer). Commit `bcb84af`; null-name fix `7724a74`; polish `2d74ec5`.
- [x] T3 — Browser validation (desktop + 375px) against the test Supabase DB. Route: inline.

## Acceptance criteria
- Filters in one row above the charts: Punto de venta (superadmin only), Usuario, Examen. Changing Usuario/Examen does not refetch.
- KPI tiles (usuarios, asignados, completados, avance %, promedio) reflect the active filters.
- Status distribution chart (stacked bar with legend + counts) and "Avance por examen" bars reflect the active filters; "Avance por punto de venta" shows when more than one store is in the data.
- Exam filter narrows each usuario's quiz list and recomputes their metrics; usuarios with no matching quiz are hidden.
- Existing behavior kept: latest-request-wins on punto change, error clears rows, expand/collapse, test ids.
- All client tests pass; build OK.

## Progress / evidence
- T1: RED 9 failed (helpers not exported) → GREEN 9 passed.
- T2: RED (missing component import; 8/18 view tests failing) → GREEN. Two existing assertions updated: plain admin now has Usuario/Examen selects (checks `filter-punto` absence instead of no `select`), and the summary progressbar lookup is scoped to `.dash-user`.
- Without an exam filter the view keeps the server's per-usuario `assigned`/`completed`; with one it recomputes via `summarize` and hides usuarios with no matching quiz.
- Parent review found `userOptions` crashing on a null `fullName` → `7724a74` (RED: new view test failed; GREEN). Shared sort in `progress.js` and `quizOptions` made null-safe too.
- Browser check found unlabelled tiny native selects, truncated exam labels, and an orphan KPI tile at 375px → `2d74ec5` (RED: label-association test failed; GREEN).
- Parent spot check: `cd client && npm test` 228 passed; `npm run build` OK (writer).
- T3 (2026-10-30, test Supabase DB, superadmin account): KPIs, status bar, per-exam and per-punto charts render with matching numbers; exam filter (1 usuario, 1/1, prom. 6%) and usuario filter (1/1, prom. 80%) recompute; "Limpiar filtros" shows; labels associated; 375px has no horizontal scroll; no runtime console errors (only Vite HMR reload errors while files were mid-edit).

- RDD: f1d92d0..d7d2b19 → medium, 622 lines, review_due (slice_budget_reached). Review granted → approved, acknowledged (lineage review-f8be2fe8184e9794). Reviewed boundary: d7d2b19.
- Advisory (open, non-blocking): a quiz with a null title renders an empty label in "Avance por examen" (SUGGESTION, AdminDashboardView.vue:187); resetting a vanished exam selection after a punto reload has no test (WARNING, AdminDashboardView.vue:214).

## Next step
Push + PR (user decision).
