import jwt from 'jsonwebtoken'

const EXPIRES_IN = '8h'

// signToken — defaults aud to 'admin' so every pre-existing call site keeps
// issuing admin tokens without changes. Usuario login passes aud:'usuario'
// explicitly. Uses jwt.sign's native `audience` option (not a hand-rolled
// payload field) so verifyToken's { audience } check below is
// library-verified, not app-verified.
export function signToken({ sub, email, aud = 'admin' }) {
  return jwt.sign({ sub, email }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: EXPIRES_IN,
    audience: aud
  })
}

// verifyToken — `options.audience` is passed straight through to jwt.verify.
// When provided, the native check REJECTS a token with a mismatched OR
// missing aud claim — this is what lets requireUserAuth refuse legacy
// pre-deploy tokens for free (see server/src/middleware/requireUserAuth.js).
// When omitted (requireAuth's transitional case), no audience check runs at
// all and the caller inspects payload.aud manually.
//
// Omitting the option and passing a BROKEN one are deliberately different:
// a falsy/non-string audience used to silently degrade into "no audience
// constraint", so an empty string or a typo'd option name turned a checked
// verification into an unchecked one with no signal. That now throws.
export function verifyToken(token, options = {}) {
  const hasAudience = Object.prototype.hasOwnProperty.call(options, 'audience')

  if (hasAudience && (typeof options.audience !== 'string' || options.audience === '')) {
    throw new TypeError('verifyToken: options.audience must be a non-empty string when provided')
  }

  return jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    ...(hasAudience ? { audience: options.audience } : {})
  })
}
