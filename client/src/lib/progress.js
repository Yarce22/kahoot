// Display helpers shared by the admin and usuario progress dashboards.

// statusLabel — the current-cycle state of one assignment. An attempt in a
// non-final state (expired / in progress) is more informative than the
// assignment's own "pending".
export function statusLabel({ status, attemptStatus }) {
  if (status === 'completed') return 'Completado'
  if (attemptStatus === 'expired') return 'Vencido'
  if (attemptStatus === 'in_progress') return 'En progreso'
  return 'Pendiente'
}

// pct — "80%", or an em dash when there is no value (null/undefined).
export function pct(n) {
  return typeof n === 'number' ? `${n}%` : '—'
}
