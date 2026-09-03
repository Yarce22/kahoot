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
import { errorHandler } from './middleware/errorHandler.js'
import { resolveBootstrapAdminOwnerId } from './lib/bootstrapAdmin.js'
import { getClientOrigin } from './lib/clientOrigin.js'

export const app = express()
const httpServer = createServer(app)

export const io = initIO(httpServer, {
  cors: { origin: getClientOrigin(), methods: ['GET', 'POST'] }
})

export { getIO }

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
})

app.use(cors({ origin: getClientOrigin() }))
app.use(express.json())
app.use('/api', limiter)

app.use('/api/auth', authRouter)
app.use('/api/admins', adminsRouter)
app.use('/api/quizzes', quizzesRouter)
app.use('/api', questionsRouter)
app.use('/api/sessions', sessionsRouter)

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
  validateLegacyBootstrapAdmin().then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  })
}

export { httpServer }
