import { timingSafeEqual } from 'crypto'

export function requireAdmin(req, res, next) {
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
