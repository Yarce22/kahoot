// Display helpers shared by the admin and usuario progress dashboards.

// statusLabel — the current-cycle state of one assignment. An attempt in a
// non-final state (expired / in progress) is more informative than the
// assignment's own "pending". A quiz past its dueAt that was not completed is
// Vencido regardless of attempt state; completed work keeps "Completado".
export function statusLabel({ status, attemptStatus, dueAt }, now = Date.now()) {
  if (status === 'completed') return 'Completado'
  if (dueAt && now > Date.parse(dueAt)) return 'Vencido'
  if (attemptStatus === 'expired') return 'Vencido'
  if (attemptStatus === 'in_progress') return 'En progreso'
  return 'Pendiente'
}

// pct — "80%", or an em dash when there is no value (null/undefined).
export function pct(n) {
  return typeof n === 'number' ? `${n}%` : '—'
}

// summarize — mirrors the server's per-usuario aggregation (server/src/domain/progress.js)
// so charts over any subset of rows agree with the server's numbers.
export function summarize(rows) {
  const assigned = rows.length
  const completed = rows.filter((r) => r.status === 'completed').length
  const scores = rows
    .filter((r) => r.attemptStatus === 'completed' && typeof r.scorePercent === 'number')
    .map((r) => r.scorePercent)
  return {
    assigned,
    completed,
    completionPercent: assigned ? Math.round((completed / assigned) * 100) : 0,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  }
}

// statusCounts — rows per statusLabel; all four keys always present.
export function statusCounts(rows) {
  const counts = { Completado: 0, 'En progreso': 0, Vencido: 0, Pendiente: 0 }
  for (const r of rows) counts[statusLabel(r)]++
  return counts
}

function group(items, keyOf) {
  const map = new Map()
  for (const [key, row, extra] of items.map(keyOf)) {
    if (!map.has(key)) map.set(key, { extra, rows: [] })
    map.get(key).rows.push(row)
  }
  return map
}

const byPercentThen = (name) => (a, b) =>
  b.completionPercent - a.completionPercent || (a[name] ?? '').localeCompare(b[name] ?? '')

export function byQuiz(users) {
  const rows = users.flatMap((u) => u.quizzes)
  return [...group(rows, (r) => [r.quizId, r, r.quizTitle])]
    .map(([quizId, { extra, rows: rs }]) => ({ quizId, quizTitle: extra, ...summarize(rs) }))
    .sort(byPercentThen('quizTitle'))
}

export function byPunto(users) {
  const rows = users.flatMap((u) => u.quizzes.map((q) => ({ ...q, punto: u.puntoDeVenta ?? 'Sin punto' })))
  return [...group(rows, (r) => [r.punto, r])]
    .map(([puntoDeVenta, { rows: rs }]) => ({ puntoDeVenta, ...summarize(rs) }))
    .sort(byPercentThen('puntoDeVenta'))
}
