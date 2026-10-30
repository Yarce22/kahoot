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

// Design palette: status colors (validated against the card surface) and the
// score bands shared by pills, histogram and charts.
export const STATUS_ORDER = ['Completado', 'En progreso', 'Vencido', 'Pendiente']
export const STATUS_COLORS = { Completado: '#56633f', 'En progreso': '#d67f48', Vencido: '#8c491a', Pendiente: '#a69d8e' }
export const scoreColor = (s) => (s == null ? '#a69d8e' : s >= 80 ? '#56633f' : s >= 60 ? '#7a8a5e' : s >= 40 ? '#d67f48' : '#8c491a')

const DAY = 864e5
export const daysAgo = (iso, now = new Date()) => Math.floor((now - new Date(iso)) / DAY)

export function relDate(iso, now = new Date()) {
  if (!iso) return '—'
  const d = daysAgo(iso, now)
  if (d === 0) return 'Hoy'
  if (d === 1) return 'Ayer'
  if (d < 7) return `Hace ${d} días`
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

export const fullDate = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

export function scoreBuckets(scores) {
  return [[0, 39, '0–39'], [40, 59, '40–59'], [60, 79, '60–79'], [80, 89, '80–89'], [90, 100, '90–100']]
    .map(([a, b, label]) => ({ label, n: scores.filter((s) => s >= a && s <= b).length, color: scoreColor(a) }))
}

export const lastActivity = (u) => u.quizzes.map((q) => q.submittedAt).filter(Boolean).sort().pop() ?? null

// attentionReasons — why a usuario needs follow-up: expired quizzes, a failing
// average, or no recent activity while quizzes are still open.
export function attentionReasons(u, now = new Date()) {
  const expired = statusCounts(u.quizzes).Vencido
  const last = lastActivity(u)
  const reasons = []
  if (expired) reasons.push(`${expired} vencido${expired > 1 ? 's' : ''}`)
  if (u.averageScore != null && u.averageScore < 60) reasons.push(`promedio ${u.averageScore}%`)
  if (!last && u.assigned) reasons.push('sin actividad')
  else if (last && daysAgo(last, now) > 10 && u.completed < u.assigned) reasons.push(`inactivo ${daysAgo(last, now)} días`)
  return reasons
}
