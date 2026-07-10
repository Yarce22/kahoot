-- ============================================================
-- Migration 006 — Multiple-choice questions with several correct answers
--
-- Adds a new question type 'multiple': a multiple-choice question where more
-- than one option can be correct and the player must pick the exact set to
-- score (all-or-nothing). The answer_options table already supports several
-- is_correct = true rows per question, so no column change is needed there —
-- only the questions.type CHECK has to allow the new value.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
  CHECK (type IN ('open', 'closed', 'true_false', 'multiple'));
