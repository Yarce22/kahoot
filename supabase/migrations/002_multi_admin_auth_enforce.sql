-- ============================================================
-- Migration 002 — Multi-Admin Auth (ENFORCE)
-- Deferred destructive steps from migration 001.
--
-- This migration MUST ship alongside the `server/src/routes/quizzes.js`
-- update (PR2) so schema and code move in lockstep: quizzes.js now always
-- sets `owner_id` on create (resolving it via the bootstrap admin under
-- AUTH_MODE=legacy, or via req.admin.id under AUTH_MODE=jwt) and no longer
-- generates or inserts `admin_token`.
--
-- PREREQUISITE: migration 001 must already be applied (the `admins` table
-- must exist and every existing quiz row must already have `owner_id` set).
-- Applying this migration before 001, or before backfilling owner_id on all
-- rows, will fail the NOT NULL constraint below.
-- ============================================================

-- 0. Defensive pre-check — fail fast and explicitly if any quiz still has
--    a NULL owner_id (e.g. migration 001's backfill wasn't applied, or a
--    quiz was inserted between 001 and 002 during a rolling deploy). A raw
--    NOT NULL constraint violation is opaque; this gives an actionable
--    error before the destructive step below runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM quizzes WHERE owner_id IS NULL) THEN
    RAISE EXCEPTION 'Migration 002 aborted: one or more quizzes.owner_id are NULL. Backfill owner_id (see migration 001) before applying this migration.';
  END IF;
END $$;

-- 1. owner_id is now mandatory — every quiz must belong to an admin.
ALTER TABLE quizzes ALTER COLUMN owner_id SET NOT NULL;

-- 2. Drop the legacy per-quiz admin token column — ownership is now
--    enforced via owner_id + the admins table.
ALTER TABLE quizzes DROP COLUMN admin_token;
