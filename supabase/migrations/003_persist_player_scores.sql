-- ============================================================
-- Migration 003 — Persist per-player final score and total time
--
-- Scores and cumulative answer time were computed in memory during a game
-- and lost when the in-memory game state was discarded at endGame. Persist
-- them on the players table so a finished session's leaderboard can be
-- reconstructed from the database.
--
-- Additive and idempotent — safe to re-run.
-- ============================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS total_time_ms INT NOT NULL DEFAULT 0;
