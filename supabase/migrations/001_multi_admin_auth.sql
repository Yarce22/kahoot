-- ============================================================
-- Migration 001 — Multi-Admin Auth (ADDITIVE ONLY)
-- Adds an `admins` table and links quizzes to their owning admin
-- via a NULLABLE `owner_id`, backfilled to the bootstrap admin.
--
-- This migration is intentionally additive: it does NOT drop the
-- legacy `admin_token` column and does NOT make `owner_id` NOT NULL,
-- because `server/src/routes/quizzes.js` still writes `admin_token`
-- and does not set `owner_id`. Those two destructive steps are
-- deferred to migration 002, which ships together with the
-- `quizzes.js` update (PR2/PR3) so schema and code move in lockstep.
--
-- OPERATOR ACTION REQUIRED before running this migration:
--   1. Replace 'REPLACE_WITH_BOOTSTRAP_ADMIN_EMAIL' below with the
--      real bootstrap admin email.
--   2. Replace 'REPLACE_WITH_BCRYPT_HASH' with a bcrypt hash
--      (cost factor 12) of the bootstrap admin's chosen password.
--      Generate it locally, e.g.:
--        node -e "console.log(require('bcryptjs').hashSync('your-password', 12))"
--   Do NOT commit real credentials — this file only ships placeholders.
-- ============================================================

-- 1. admins table
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Bootstrap admin insert — fill in the placeholders above before applying.
INSERT INTO admins (email, password_hash)
VALUES ('REPLACE_WITH_BOOTSTRAP_ADMIN_EMAIL', 'REPLACE_WITH_BCRYPT_HASH');

-- 3. Link quizzes to their owning admin (nullable until backfilled below)
ALTER TABLE quizzes ADD COLUMN owner_id UUID REFERENCES admins(id);

-- 4. Backfill existing quizzes to the bootstrap admin
UPDATE quizzes
SET owner_id = (SELECT id FROM admins WHERE email = 'REPLACE_WITH_BOOTSTRAP_ADMIN_EMAIL')
WHERE owner_id IS NULL;

-- 5. Index for ownership lookups
CREATE INDEX idx_quizzes_owner ON quizzes(owner_id);

-- ------------------------------------------------------------
-- DEFERRED to migration 002 (ships with the quizzes.js update):
--   ALTER TABLE quizzes ALTER COLUMN owner_id SET NOT NULL;
--   ALTER TABLE quizzes DROP COLUMN admin_token;
-- Applying those now would break POST /api/quizzes, which still
-- writes admin_token and does not set owner_id under AUTH_MODE=legacy.
-- ------------------------------------------------------------
