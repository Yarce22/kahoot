// getClientOrigin — single source of truth for the public origin of the
// browser app. Used for CORS (HTTP + socket.io) and for building absolute
// links that land in emails (e.g. the password reset URL).
//
// The localhost fallback keeps local dev zero-config; a production deploy
// that forgets CLIENT_ORIGIN would silently email reset links pointing at
// the user's own machine, so src/index.js warns loudly about that at boot.
export function getClientOrigin() {
  return process.env.CLIENT_ORIGIN || 'http://localhost:5173'
}
