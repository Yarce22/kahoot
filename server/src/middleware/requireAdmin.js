import { timingSafeEqual } from 'crypto'

// requireAdmin — legacy global-token guard.
// Stays active whenever AUTH_MODE !== 'jwt' (the default in PR1, so no
// behavior change yet). PR2/PR3 will switch routes to the jwt-based
// requireAuth/requireQuizOwner middlewares once AUTH_MODE=jwt is enabled.
export function requireAdmin(req, res, next) {
  if (process.env.AUTH_MODE === 'jwt') return next()

  const token = req.headers['x-admin-token']
  if (!token) return res.status(401).json({ error: 'Missing admin token' })

  const expected = process.env.ADMIN_TOKEN
  if (!expected) return res.status(500).json({ error: 'Server misconfiguration' })

  try {
    const tokenBuf = Buffer.from(token)
    const expectedBuf = Buffer.from(expected)
    if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Invalid admin token' })
    }
  } catch {
    return res.status(401).json({ error: 'Invalid admin token' })
  }
  next()
}
