# Feature: user-password-recovery

## Objective
Usuarios (exam takers) can recover their password by email, with the same flow and guarantees the admin recovery already has.

## Problem / why
Only admins have forgot/reset password (`server/src/routes/auth.js`). Usuarios depend on an admin manually setting a new password in UsersView.

## Scope
- Server: `POST /api/user/auth/forgot-password` and `POST /api/user/auth/reset-password` (mounted where `userAuthRouter` is mounted), same guarantees as the admin endpoints:
  - single generic 200 response on forgot-password regardless of account existence/state; email send fire-and-forget; send only after the token row is stored
  - 32-byte random token, only its sha256 stored, 30-minute TTL, single use, other outstanding tokens invalidated after a successful reset, opportunistic cleanup of used/expired rows
  - inactive usuario gets no email and cannot reset (same generic 400 as invalid/expired)
  - own rate limiters (5 / 15 min forgot, 10 / 15 min reset), min password length 8
  - reset link: `${getClientOrigin()}/user/reset-password?token=...`
- DB: migration `017_user_password_reset_tokens.sql` — new table `user_password_reset_tokens` (user_id FK users ON DELETE CASCADE), mirroring migration 007.
- Client: reuse `ForgotPasswordView.vue` / `ResetPasswordView.vue` for usuarios (no duplicated views); routes `/user/forgot-password` and `/user/reset-password`; "¿Olvidaste tu contraseña?" link on `UserLoginView.vue`; after a successful reset land on `/` with the same success notice the admin login shows.

## Constraints
- Admin recovery behavior must not change (existing tests must keep passing).
- UI copy in Spanish (neutral), code/comments in English, match surrounding style.
- No new dependencies.

## Acceptance criteria
- A usuario can request a reset from the user login screen, receives the link, sets a new password, and logs in with it.
- Unknown / inactive email gets the same response as a known one.
- Expired, used, or unknown token → same generic 400.

## TDD
- Mode: enabled (session config "Strict TDD Mode: enabled").
- Runners: server `npm test` (node --test) in `server/`; client `npx vitest run` in `client/`.

## Delivery
- Branch: `feat/user-password-recovery`. Strategy: ask-on-risk. Forecast ~400-600 authored lines (tests included).

## Tasks
- [x] T1 — Migration 017 + server forgot/reset endpoints for usuarios with tests (route: delegated writer — 2+ non-trivial files)
- [ ] T2 — Client: parametrize recovery views, user routes, login link, success notice, with tests (route: delegated writer — 2+ non-trivial files)

## Progress / evidence
- T1 (server): design = shared helper `server/src/lib/passwordRecovery.js` (factory parametrized by account table, token table, FK column, reset path, email normalizer) used by both auth.js and userAuth.js; admin tests unchanged and green.
  - RED: new files userAuth.forgotPassword.test.js / userAuth.resetPassword.test.js failed in beforeEach (limiters undefined, endpoints missing) before implementation.
  - GREEN: `cd server && npm test` => 487 tests, 487 pass, 0 fail (base was 469).
  - Deploy: run migration 017 in Supabase.
  - Commit: see git log (feat(server): add usuario password recovery endpoints).
- (T2 pending)

## Next step
T1.
