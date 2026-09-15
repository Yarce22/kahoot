import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import { createServer } from 'http'
import { pathToFileURL } from 'url'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { initIO, getIO } from './lib/io.js'
import { registerSocketHandlers } from './sockets/index.js'
import { quizzesRouter } from './routes/quizzes.js'
import { questionsRouter } from './routes/questions.js'
import { sessionsRouter } from './routes/sessions.js'
import { authRouter } from './routes/auth.js'
import { adminsRouter } from './routes/admins.js'
import { userAuthRouter } from './routes/userAuth.js'
import { userQuizzesRouter } from './routes/userQuizzes.js'
import { usersRouter } from './routes/users.js'
import { assignmentsRouter } from './routes/assignments.js'
import { attemptsRouter } from './routes/attempts.js'
import { errorHandler } from './middleware/errorHandler.js'
import { resolveBootstrapAdminOwnerId } from './lib/bootstrapAdmin.js'
import { getClientOrigin } from './lib/clientOrigin.js'
import supabase from './lib/supabase.js'

export const app = express()
const httpServer = createServer(app)

export const io = initIO(httpServer, {
  cors: { origin: getClientOrigin(), methods: ['GET', 'POST'] }
})

export { getIO }

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

// USER_FLOW_PREFIX — the async (PIN-less) usuario namespace. Note the trailing
// slash: it keeps the ADMIN-facing '/api/users' out of the match.
const USER_FLOW_PREFIX = '/api/user/'

// USER_FLOW_MAX — a separate, much larger budget for /api/user/*, because the
// two namespaces have completely different legitimate request shapes.
//
// The global 100/15min below is sized for an admin's occasional API calls. The
// usuario flow is chatty BY DESIGN (design D7: answers are recorded
// incrementally, one POST per answer, so a browser crash loses nothing), so one
// full attempt costs roughly `question_count + 5` requests — start + one POST
// per answer + submit + result, plus the GET /quizzes that brackets it. A
// 30-question quiz is ~35, and an answer may legitimately be re-sent (the write
// is an upsert precisely so a usuario can change an answer before submitting).
//
// The default key is req.ip, and a punto de venta NATs its entire staff behind
// ONE public IP — so an IP-keyed budget here is a STORE-WIDE budget, not a
// per-user one. It must therefore cover a store's worth of simultaneous takers:
// 25 x 40 = 1000.
//
// Undersizing this is not degraded service, it is terminal: a 429 landing
// mid-attempt leaves the attempt in_progress with expires_at still running, and
// UNIQUE (assignment_id, cycle) blocks a fresh start — unrecoverable without an
// admin reactivation. Removing the limit instead is not an option either: these
// are write-heavy endpoints that still need abuse protection.
export const USER_FLOW_MAX = 25 * 40

// Exported so tests can call the documented `resetKey()` API between cases —
// same reason auth.js exports its two limiters.
export const userFlowLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: USER_FLOW_MAX,
  standardHeaders: true,
  legacyHeaders: false
})

export const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 100,
  // /api/user/* is metered by userFlowLimiter instead — without this skip the
  // global 100 would still be the binding constraint and the separate budget
  // above would be decorative. `originalUrl` (never rewritten by the router) is
  // used rather than `req.path`, which a mounted middleware sees stripped of
  // its mount prefix.
  skip: (req) => req.originalUrl.startsWith(USER_FLOW_PREFIX),
  standardHeaders: true,
  legacyHeaders: false
})

app.use(cors({ origin: getClientOrigin() }))
app.use(express.json())
app.use(USER_FLOW_PREFIX, userFlowLimiter)
app.use('/api', apiLimiter)

app.use('/api/auth', authRouter)
app.use('/api/admins', adminsRouter)
app.use('/api/quizzes', quizzesRouter)
app.use('/api', questionsRouter)
app.use('/api/sessions', sessionsRouter)

// Async (PIN-less) usuario flow — every one of these five routers requires
// AUTH_MODE=jwt outright (requireJwtMode, design D3) and has no legacy
// fallback identity; they are purely additive and touch none of the live-PIN
// wiring above (task 8.2 is the regression proof for that boundary).
app.use('/api/user', userAuthRouter)
app.use('/api/user', userQuizzesRouter)
app.use('/api/users', usersRouter)
app.use('/api/assignments', assignmentsRouter)
app.use('/api/attempts', attemptsRouter)

registerSocketHandlers(io)

// Error handler — must be last
app.use(errorHandler)

// validateLegacyBootstrapAdmin — startup guard for AUTH_MODE=legacy. Legacy
// quiz creation resolves owner_id via the bootstrap admin (see
// lib/bootstrapAdmin.js); if BOOTSTRAP_ADMIN_EMAIL is unset or doesn't
// resolve to a real admin row, every quiz creation would 500 at request
// time with an easy-to-miss error. Fail fast and loudly at boot instead.
async function validateLegacyBootstrapAdmin() {
  if (process.env.AUTH_MODE === 'jwt') return
  try {
    await resolveBootstrapAdminOwnerId()
  } catch (err) {
    console.error(`FATAL: AUTH_MODE=legacy requires BOOTSTRAP_ADMIN_EMAIL to be set and resolve to an existing admin. ${err.message}`)
    process.exit(1)
  }
}

// closeOrphanedSessions — activeGames is a fresh, empty Map on every process
// boot (module-level `new Map()`, never persisted), so at the instant the
// server starts, ANY game_sessions row still 'lobby'/'active' is by
// definition orphaned: there is no in-memory game backing it, full stop, no
// need to cross-reference activeGames. This is what reconciles hosts whose
// tab/socket died while the server itself was ALSO down — the complementary
// case (server stays up, only the host disconnects) is instead handled live
// by the hostDisconnectTimer grace period in sockets/index.js.
// Exported (and structured as an independently-callable function rather
// than inline top-level code) so tests can exercise it directly without
// booting the whole HTTP server. Must never block startup: same log-and
// continue spirit as routes/auth.js's forgot-password handler — errors are
// logged, not thrown.
export async function closeOrphanedSessions() {
  try {
    const { data, error } = await supabase
      .from('game_sessions')
      .update({ status: 'finished', ended_at: new Date().toISOString() })
      .in('status', ['lobby', 'active'])
      .select('id')

    if (error) {
      console.error('[startup] failed to close orphaned sessions', { error })
      return
    }

    console.log(`[startup] closed ${data?.length ?? 0} orphaned session(s)`)
  } catch (err) {
    console.error('[startup] failed to close orphaned sessions', { error: err })
  }
}

// warnMissingClientOrigin — a warning, not a hard failure: local dev
// legitimately runs on the localhost fallback. In production, though, the
// fallback silently poisons anything built from the origin — most visibly
// password reset links, which would point every recipient at their own
// machine instead of the deployed app.
function warnMissingClientOrigin() {
  if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_ORIGIN) {
    console.warn(`WARNING: CLIENT_ORIGIN is not set in production — falling back to ${getClientOrigin()}. CORS and password reset links will be wrong.`)
  }
}

// Only start listening when this module is the process entrypoint — lets
// tests `import { app } from '../src/index.js'` and drive it with
// supertest without binding a real port. Comparing resolved file URLs
// (instead of a fragile argv[1].endsWith('index.js') string check) is
// robust to being launched via process managers/wrappers that pass a
// different argv[1] shape.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const PORT = process.env.PORT || 3000
  warnMissingClientOrigin()
  validateLegacyBootstrapAdmin()
    .then(() => closeOrphanedSessions())
    .then(() => {
      httpServer.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`)
      })
    })
}

export { httpServer }
