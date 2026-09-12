import { httpError } from '../lib/httpError.js'

// requireStoreScope.js — store-scoping helper module (design D4). Ownership
// scoping (requireQuizOwner) can be a pure middleware because it resolves
// from a URL param; store scoping can't — the write-side check needs the
// request BODY plus a DB lookup of the TARGET row's store, and the read-side
// check needs to reconcile the caller's own store against an OPTIONAL
// query-string filter. So this module exports one guard middleware plus
// three pure helpers used directly inside route handlers.

// requireStoreScope — runs AFTER requireAuth (needs req.admin). A
// superadmin is unrestricted by definition — see anywhere. A non-superadmin
// admin whose own punto_de_venta is still null (the 009->010 backfill
// window, before migration 010 enforces NOT NULL) is rejected rather than
// treated as "no filter" — the fail-closed default, since an unscoped
// non-superadmin would see every store's data.
export function requireStoreScope(req, res, next) {
  if (!req.admin) return next(httpError(401, 'Authentication required'))

  if (req.admin.role !== 'superadmin' && req.admin.punto_de_venta === null) {
    return next(httpError(403, 'Your account has no assigned punto de venta yet'))
  }

  next()
}

// resolveStoreFilter — READ side. Returns the effective store to filter by:
//   - superadmin: `requested` as-is (or null = every store, unrestricted)
//   - non-superadmin: always their own store; if `requested` is explicitly
//     provided and differs from their own, THROW 403 rather than silently
//     narrowing to their store (spec: Conflicting explicit filter rejected —
//     a caller who names another store must be told no, not get quietly
//     redirected to their own).
export function resolveStoreFilter(req, requested) {
  const admin = req.admin

  if (admin.role === 'superadmin') return requested ?? null

  if (requested !== undefined && requested !== null && requested !== admin.punto_de_venta) {
    throw httpError(403, 'You may only filter by your own punto de venta')
  }

  return admin.punto_de_venta
}

// applyStoreFilter — appends `.eq(column, effectiveStore)` to a supabase
// query builder ONLY when effectiveStore is set; a null effectiveStore
// (superadmin, unrestricted) leaves the query untouched.
export function applyStoreFilter(query, effectiveStore, column = 'punto_de_venta') {
  if (effectiveStore === null || effectiveStore === undefined) return query
  return query.eq(column, effectiveStore)
}

// assertSameStore — WRITE side. Throws 403 unless the caller is a
// superadmin or `targetStore` matches their own punto_de_venta. Used to
// block cross-store writes (e.g. creating a usuario or an assignment
// outside the caller's own store).
export function assertSameStore(req, targetStore) {
  const admin = req.admin
  if (admin.role === 'superadmin') return
  if (targetStore !== admin.punto_de_venta) {
    throw httpError(403, 'This action is restricted to your own punto de venta')
  }
}
