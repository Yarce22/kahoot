-- ============================================================
-- Migration 004 — Admin roles + soft-delete (RBAC)
--
-- Introduces two roles ('admin' | 'superadmin') and a soft-delete flag on
-- admins. A superadmin can see and manage every admin's content; a plain
-- admin only sees its own. Deactivating an admin (is_active = false) blocks
-- login without breaking quizzes.owner_id (which is NOT NULL and references
-- admins) — a hard delete would violate that foreign key.
--
-- Additive and idempotent — safe to re-run.
-- ============================================================

-- 1. Role column. Defaults to the least-privileged role so existing rows
--    stay plain admins.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_role_check') THEN
    ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('admin', 'superadmin'));
  END IF;
END $$;

-- 2. Soft-delete flag. Existing admins stay active.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 3. Promote the very first admin (the bootstrap admin, created in migration
--    001) to superadmin — but only if no superadmin exists yet, so re-running
--    this migration never changes an intentional role assignment. If you want
--    a different admin to be the first superadmin, adjust the subquery.
UPDATE admins
SET role = 'superadmin'
WHERE id = (SELECT id FROM admins ORDER BY created_at ASC, id ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM admins WHERE role = 'superadmin');
