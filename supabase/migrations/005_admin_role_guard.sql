-- ============================================================
-- Migration 005 — Race-safe admin role/status updates
--
-- The "never leave the system with zero active superadmins" invariant was
-- enforced only in application code (routes/admins.js) as a non-atomic
-- read-then-update: count active superadmins, then update. Two concurrent
-- PATCHes demoting/deactivating different superadmins could both read
-- count=2, both pass, and both commit — leaving zero.
--
-- This function does the check + update together, serialized by a
-- transaction-scoped advisory lock so concurrent role/status changes run one
-- at a time and the invariant cannot be raced. It raises 'admin_not_found'
-- or 'last_active_superadmin' which the API maps to 404 / 409.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION update_admin_role_status(
  target_id uuid,
  new_role text DEFAULT NULL,
  new_active boolean DEFAULT NULL
)
RETURNS admins
LANGUAGE plpgsql
AS $$
DECLARE
  result admins;
BEGIN
  -- Serialize every admin role/status change against each other so the
  -- invariant below cannot be observed stale by a concurrent update.
  PERFORM pg_advisory_xact_lock(hashtext('admins_role_guard'));

  UPDATE admins
     SET role = COALESCE(new_role, role),
         is_active = COALESCE(new_active, is_active)
   WHERE id = target_id
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM admins WHERE role = 'superadmin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'last_active_superadmin';
  END IF;

  RETURN result;
END;
$$;
