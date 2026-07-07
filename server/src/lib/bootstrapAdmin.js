import supabase from './supabase.js'
import { httpError } from './httpError.js'

// resolveBootstrapAdminOwnerId — used ONLY under AUTH_MODE=legacy.
//
// After migration 002, quizzes.owner_id is NOT NULL, but legacy mode has
// no req.admin (no JWT identity) to assign as the owner. We fall back to
// the single bootstrap admin (identified by BOOTSTRAP_ADMIN_EMAIL, the
// same admin backfilled in migration 001) so quiz creation keeps working
// under legacy without violating the NOT NULL constraint.
//
// Cached in-process since the bootstrap admin's id never changes at runtime.
let cachedId = null

export async function resolveBootstrapAdminOwnerId() {
  if (cachedId) return cachedId

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL
  if (!email) {
    throw httpError(500, 'BOOTSTRAP_ADMIN_EMAIL is not configured (required under AUTH_MODE=legacy)')
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id')
    .eq('email', email)
    .single()

  if (error || !admin) {
    throw httpError(500, 'Bootstrap admin not found — check BOOTSTRAP_ADMIN_EMAIL')
  }

  cachedId = admin.id
  return cachedId
}

// Exposed for tests only — clears the in-process cache.
export function _resetBootstrapAdminCache() {
  cachedId = null
}
