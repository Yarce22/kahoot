import { timingSafeEqual } from 'crypto'

export function hostAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.adminToken
  if (!token) return next(new Error('UNAUTHORIZED'))
  const expected = process.env.ADMIN_TOKEN
  if (!expected) return next(new Error('UNAUTHORIZED'))
  try {
    const a = Buffer.from(token)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return next(new Error('UNAUTHORIZED'))
  } catch {
    return next(new Error('UNAUTHORIZED'))
  }
  socket.isHost = true
  next()
}
