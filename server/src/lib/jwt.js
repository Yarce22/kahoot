import jwt from 'jsonwebtoken'

const EXPIRES_IN = '8h'

export function signToken({ sub, email }) {
  return jwt.sign({ sub, email }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: EXPIRES_IN
  })
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
}
