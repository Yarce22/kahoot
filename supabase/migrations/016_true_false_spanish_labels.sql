-- ============================================================
-- Migration 016 — Spanish labels for existing true_false options
--
-- The questions route now writes true_false answer_options as
-- 'Verdadero' / 'Falso' (server/src/domain/trueFalse.js). Rows created
-- before that still read 'True' / 'False' and are shown verbatim as the
-- answer buttons, so they are renamed here. Grading only reads
-- is_correct, so the rename does not change any score. Scoped to
-- true_false questions so a closed question whose option happens to be
-- literally 'True' is left alone.
-- ============================================================

UPDATE answer_options
SET text = CASE text WHEN 'True' THEN 'Verdadero' ELSE 'Falso' END
WHERE text IN ('True', 'False')
  AND question_id IN (SELECT id FROM questions WHERE type = 'true_false');
