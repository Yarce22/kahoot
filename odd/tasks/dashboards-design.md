# Dashboards: implement the Claude Design mockups

## Objective
Implement the admin and usuario dashboards exactly as designed in the Claude Design project `019df05d-8d54-79a8-a8ea-732b21f4e802` (`Dashboards.html`, `dash-admin.jsx`, `dash-user.jsx`, `dash-shared.jsx`, `dash-data.js`, `tweaks-panel.jsx`). User request 2026-10-30: "Implementa todo el diseño de los dashboard tal cual esta aqui mostrado".

## Constraints
- Vue 3 `<script setup>` port of the JSX design (the app is Vue, not React); real data from `GET /api/dashboard/progress` and `GET /api/user/progress`, not `dash-data.js` mock data.
- No new dependencies unless the design genuinely cannot be built without one.
- Keep existing behavior: store scoping, latest-request-wins, error handling, filters, null-safe names, the "Ver resultado" link, existing test ids where the design keeps the element.
- `tweaks-panel.jsx` is a design-tool control panel; port only what is part of the product UI.
- Design data the API does not provide is reported as a gap, not invented.

## TDD
- Mode: strict (orchestrator config). Runner: `cd client && npm test` (vitest); build `cd client && npm run build`.

## Delivery
- Branch `feat/dashboards-design` from main `98ef000`. Strategy ask-on-risk; actual 918+/389- (incl. removed chart components and their tests).

## Tasks
- [x] T1 — Admin dashboard per design. Route: inline (planned delegated; the writer subagent had no DesignSync access and transcribing the design to disk would double the cost). Commits `57a4d1a` (helpers + components), `8f74dbe` (view).
- [x] T2 — Usuario dashboard per design. Route: inline (same reason). Commit `9321e3b`.
- [x] T3 — Browser validation. Admin desktop: all sections render with real data, console clean. Usuario desktop + 375px: renders with real data, no horizontal scroll (scrollWidth 375). Found and fixed: relDate counted 24h blocks, showing "Hoy" for an exam submitted the previous evening; now calendar days (RED→GREEN). Admin at 375px not browser-checked.

## Progress / evidence
- `progressDesign.test.js`: RED observed (5 failed) → GREEN.
- View tests were extended after the implementation (not RED-first); several assertions adapted to the new markup (e.g. 'Avance 25%' → '25%', '2/2 · prom. 70%' → '2/2 completados · 0 vencidos', open quizzes no longer show a score).
- Final: vitest 28 files / 234 tests pass; `npm run build` OK.
- Skipped: `tweaks-panel.jsx` (design-tool switcher, not product UI). Removed `StatusStackBar.vue`, `HBarChart.vue` and their test (superseded).

## Next step
Push and PR when the user asks.
