// resetRateLimits — clears the per-IP hit counters of the auth limiters.
//
// Both limiters are module-level singletons created at import time, so their
// state survives for the whole test process. Without this, every request a
// test makes would spend a budget shared with every other test in the file:
// assertions would depend on test ORDER and on the exact number of requests
// earlier tests happened to make, and adding one new case anywhere in the
// file would start returning surprise 429s. Call this in a `beforeEach` so
// each test starts from a full, predictable budget.
//
// `resetKey` is express-rate-limit's public API but needs the key, which the
// default keyGenerator derives from `req.ip` — under supertest that's
// loopback, whose exact spelling depends on whether Node bound IPv4 or
// IPv6-mapped IPv4, and on the IPv6 subnet normalisation the library applies.
// Resetting all loopback spellings is cheap (unknown keys are a no-op) and
// avoids depending on which one it turns out to be.
const LOOPBACK_KEYS = ['127.0.0.1', '::ffff:127.0.0.1', '::1', '::/56']

export function resetRateLimits(...limiters) {
  for (const limiter of limiters) {
    for (const key of LOOPBACK_KEYS) limiter.resetKey(key)
  }
}
