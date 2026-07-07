# Server tests

No live Supabase/Postgres test database exists in this repo. These tests
mock the Supabase client (`server/src/lib/supabase.js`) directly via
`test/helpers/mockSupabase.js`, which reassigns the client's `.from`
method to a scripted, ordered response queue.

This validates route/middleware/socket wiring and control flow (auth
gating, ownership checks, request/response shapes), but it does NOT
validate real SQL, RLS policies, or constraints (e.g. the migration 002
`owner_id NOT NULL` / unique-violation behavior on `admins.email`). Those
still require integration testing against a real (or local) Supabase
instance — out of scope for PR2.

Run with:

```
cd server
npm install   # installs supertest + socket.io-client devDependencies
npm test
```
