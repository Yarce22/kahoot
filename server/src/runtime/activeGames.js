/**
 * In-memory store for active game sessions.
 *
 * @typedef {Object} GameState
 * @property {string} sessionId
 * @property {string} quizId
 * @property {Array}  questions        - loaded from Supabase at session start, with nested options
 * @property {number} currentQuestionIndex - -1 = lobby, 0+ = active question
 * @property {ReturnType<typeof setInterval>|null} tickHandle    - interval for timer ticks
 * @property {ReturnType<typeof setTimeout>|null}  timeoutHandle - fires when time limit reached
 * @property {number|null} questionStartedAt  - Date.now() when current question started
 * @property {Map<string, {playerId: string, nickname: string, score: number, totalTimeMs: number}>} players - keyed by socketId
 * @property {Set<string>} answersReceived     - set of playerIds who answered current question
 */

/** @type {Map<string, GameState>} */
export const activeGames = new Map()
