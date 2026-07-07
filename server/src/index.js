import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { initIO, getIO } from './lib/io.js'
import { registerSocketHandlers } from './sockets/index.js'
import { quizzesRouter } from './routes/quizzes.js'
import { questionsRouter } from './routes/questions.js'
import { sessionsRouter } from './routes/sessions.js'
import { authRouter } from './routes/auth.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()
const httpServer = createServer(app)

export const io = initIO(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', methods: ['GET', 'POST'] }
})

export { getIO }

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
})

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())
app.use('/api', limiter)

app.use('/api/auth', authRouter)
app.use('/api/quizzes', quizzesRouter)
app.use('/api', questionsRouter)
app.use('/api/sessions', sessionsRouter)

registerSocketHandlers(io)

// Error handler — must be last
app.use(errorHandler)

const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
