-- ============================================================
-- Migration 011 — fold punto_de_venta into update_admin_role_status
--
-- PATCH /api/admins/:id accepts role, is_active and punto_de_venta. It used to
-- apply them as TWO writes: the advisory-locked update_admin_role_status RPC
-- (migration 005) followed by a plain UPDATE for punto_de_venta. A combined
-- PATCH whose second write failed therefore left the role/status change already
-- durably committed while the caller was told the whole request had failed — a
-- silent partial mutation.
--
-- Adding new_punto_de_venta to the function lets every field land inside the one
-- serialized transaction, so the request either fully applies or fully rolls
-- back. NULL still means "leave unchanged" (COALESCE), exactly like new_role and
-- new_active: the column is NOT NULL as of migration 010, so the function can
-- never be used to blank it.
--
-- The 3-argument version is DROPped first: CREATE OR REPLACE with an extra
-- parameter would create an OVERLOAD instead of replacing it, and PostgREST
-- cannot disambiguate two candidates of the same name.
--
-- Idempotent — safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS update_admin_role_status(uuid, text, boolean);

CREATE OR REPLACE FUNCTION update_admin_role_status(
  target_id uuid,
  new_role text DEFAULT NULL,
  new_active boolean DEFAULT NULL,
  new_punto_de_venta text DEFAULT NULL
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
         is_active = COALESCE(new_active, is_active),
         punto_de_venta = COALESCE(new_punto_de_venta, punto_de_venta)
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
