-- ============================================================
-- Migration 012 — reactivate never touches a deactivated usuario
--
-- POST /api/assignments refuses to assign a quiz to a usuario with
-- is_active = false: that usuario can never log in (routes/userAuth.js rejects
-- !is_active), so the assignment is a row that can never be completed and
-- permanently skews every completion metric.
--
-- reactivate_quiz_assignments (migration 009) re-opens EXACTLY that kind of
-- row — status back to 'pending', completed_at cleared, cycle bumped to the new
-- high-water mark — with no such rule, so reactivating a quiz recreated the
-- problem the create path closes.
--
-- The rule belongs HERE and not in the route: when the caller omits user_ids
-- ("reactivate everyone on this quiz") the route names no users at all, so
-- there is nothing for a route-level check to filter. This UPDATE's own
-- predicate is the only place that sees the rows it is about to touch, and it
-- therefore binds both the whole-quiz case and an explicit user_ids subset that
-- happens to include a deactivated id.
--
-- The users join already exists (it is what scope_punto_de_venta filters on),
-- so the guard is one more predicate on the SAME alias — no extra join, no
-- extra round trip. is_active is NOT NULL with a default, so a plain
-- `AND u.is_active` cannot silently drop rows to a NULL.
--
-- Deliberately NOT retroactive: assignments created before this migration that
-- belong to a deactivated usuario keep their current status. Reactivate is a
-- forward-looking operation, and rewriting history is not its job.
--
-- CREATE OR REPLACE, not DROP + CREATE: the signature is unchanged, so there is
-- no overload to disambiguate and PostgREST's cached signature stays valid
-- (contrast migration 011, which added a parameter).
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION reactivate_quiz_assignments(
  target_quiz_id uuid,
  target_user_ids uuid[] DEFAULT NULL,
  scope_punto_de_venta text DEFAULT NULL
)
RETURNS TABLE (assignment_id uuid, new_cycle int)
LANGUAGE plpgsql
AS $$
DECLARE
  next_cycle INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('quiz_assignment_cycle:' || target_quiz_id::text));

  UPDATE quizzes
     SET assignment_cycle = assignment_cycle + 1
   WHERE id = target_quiz_id
  RETURNING assignment_cycle INTO next_cycle;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quiz_not_found';
  END IF;

  -- In-progress attempts are intentionally NOT force-expired: they keep
  -- their old cycle, finish normally, and stay queryable as history.
  RETURN QUERY
  UPDATE quiz_assignments a
     SET cycle = next_cycle,
         status = 'pending',
         completed_at = NULL
    FROM users u
   WHERE a.user_id = u.id
     AND a.quiz_id = target_quiz_id
     AND (target_user_ids IS NULL OR a.user_id = ANY(target_user_ids))
     AND (scope_punto_de_venta IS NULL OR u.punto_de_venta = scope_punto_de_venta)
     -- is_active = false is this table's soft-delete. A deactivated usuario
     -- cannot log in, so re-opening their assignment creates a row that can
     -- never be completed — the same reason POST /api/assignments refuses to
     -- create one. Not a scoping rule, so it binds a superadmin too.
     AND u.is_active
  RETURNING a.id, a.cycle;
END;
$$;

-- PostgREST caches the schema. The signature is unchanged here, so an existing
-- cache stays correct, but asking for a reload keeps this migration consistent
-- with 011 and is a no-op where the DDL event trigger already did it.
NOTIFY pgrst, 'reload schema';
