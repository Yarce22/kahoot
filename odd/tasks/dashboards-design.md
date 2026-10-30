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
- Branch `feat/dashboards-design` from main `98ef000`. Strategy ask-on-risk; forecast likely > 400 lines.

## Tasks
- [ ] T1 — Admin dashboard per design. Route: delegated (writer trigger: multiple non-trivial files + design reading).
- [ ] T2 — Usuario dashboard per design. Route: delegated (same writer).
- [ ] T3 — Browser validation desktop + 375px against the test DB. Route: inline.

## Progress / evidence

## Next step
T1.
