-- ============================================================
-- Migration 015 — add admins.name, folded into update_admin_role_status
--
-- name is nullable and optional everywhere: unlike punto_de_venta (migration
-- 010's NOT NULL backfill saga) nothing requires every admin to have one, so
-- this is a plain additive column with no backfill window. The length check
-- mirrors quizzes.title's.
--
-- The edit popup in AdminsView.vue changes role + punto_de_venta + name
-- together in one submit. Migration 011 already established why a combined
-- role/status + punto_de_venta PATCH must be ONE advisory-locked write rather
-- than a role/status write followed by a separate column update: a failure of
-- the second write left the first already committed while the caller saw a
-- total failure. Bolting name on as its own follow-up query would reintroduce
-- exactly that bug for the new field, so it rides through the SAME RPC
-- instead.
--
-- The 4-argument version is DROPped first: CREATE OR REPLACE with an extra
-- parameter would create an OVERLOAD instead of replacing it, and PostgREST
-- cannot disambiguate two candidates of the same name.
--
-- new_name alone can't tell "leave unchanged" apart from "clear it" the way
-- new_role/new_active/new_punto_de_venta's COALESCE does, because unlike
-- those three, blanking name IS a legitimate operation (it's nullable, and
-- the edit popup lets an operator remove a name they typo'd in earlier). A
-- bare COALESCE(new_name, name) would silently keep the OLD name every time
-- the popup submits role + punto_de_venta + an emptied name together — the
-- exact combined-write shape this RPC exists to handle. clear_name is the
-- explicit "yes, I mean null" signal that disambiguates it.
--
-- Idempotent — safe to re-run (ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE admins ADD COLUMN IF NOT EXISTS name TEXT
  CHECK (name IS NULL OR char_length(name) <= 200);

DROP FUNCTION IF EXISTS update_admin_role_status(uuid, text, boolean, text);

CREATE OR REPLACE FUNCTION update_admin_role_status(
  target_id uuid,
  new_role text DEFAULT NULL,
  new_active boolean DEFAULT NULL,
  new_punto_de_venta text DEFAULT NULL,
  new_name text DEFAULT NULL,
  clear_name boolean DEFAULT false
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
         punto_de_venta = COALESCE(new_punto_de_venta, punto_de_venta),
         name = CASE WHEN clear_name THEN NULL ELSE COALESCE(new_name, name) END
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

-- PostgREST caches the schema, including function signatures. Hosted Supabase
-- reloads it automatically via its DDL event trigger, but a self-hosted or CI
-- instance keeps advertising the dropped 4-argument signature until it is
-- reloaded — so every 5-argument RPC call from the API fails with PGRST202
-- indefinitely. Ask for the reload explicitly; it is a no-op where the trigger
-- already did it.
NOTIFY pgrst, 'reload schema';
