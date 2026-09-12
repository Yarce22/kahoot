-- ============================================================
-- Migration 010 — enforce admins.punto_de_venta NOT NULL
--
-- Run ONLY after every existing admin row has been manually assigned its
-- real store. Migration 009 deliberately left the column nullable: there is
-- no safe default, and defaulting would silently mis-scope every
-- store-filtered query for that admin. This migration therefore REFUSES to
-- run while any row is still NULL instead of guessing.
--
-- Idempotent — safe to re-run once the backfill is complete.
-- ============================================================

DO $$
DECLARE
  missing INT;
BEGIN
  SELECT count(*) INTO missing FROM admins WHERE punto_de_venta IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'admins_punto_de_venta_backfill_required: % admin row(s) still have punto_de_venta = NULL. Assign each one its real store before running migration 010.', missing;
  END IF;
END $$;

ALTER TABLE admins ALTER COLUMN punto_de_venta SET NOT NULL;

ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_punto_de_venta_check;
ALTER TABLE admins ADD CONSTRAINT admins_punto_de_venta_check
  CHECK (punto_de_venta IN ('Cerritos', 'Campestre', 'Centenario', 'Circunvalar', 'Laureles'));
