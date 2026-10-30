<template>
  <div class="dash-view view-transition-enter">
    <div class="dash-header">
      <div>
        <h1 class="nunito dash-title">Dashboard</h1>
        <p class="dash-sub">{{ scopeLabel }} · datos al {{ fullDate(now.toISOString()) }}</p>
      </div>
      <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 16px;">
        ← Volver
      </router-link>
    </div>

    <!-- Plain admins are pinned to their own store server-side; only a
         superadmin can choose one. Usuario/Examen/Estado narrow the loaded data
         client-side. -->
    <section class="card dash-filters" aria-labelledby="filters-title">
      <div class="dash-filters-head">
        <h2 id="filters-title" class="dash-filters-title">
          Filtros
          <span v-if="activeCount" class="dash-filters-count" data-testid="filter-count">{{ activeCount }}</span>
        </h2>
        <button v-if="activeCount" type="button" class="dash-clear" data-testid="clear-filters" @click="clearFilters">
          Limpiar filtros
        </button>
      </div>
      <div class="dash-filters-grid">
        <div v-if="auth.isSuperadmin" class="dash-filter">
          <label for="filter-punto">Punto de venta</label>
          <select id="filter-punto" v-model="puntoDeVenta" :class="{ 'is-active': puntoDeVenta }" data-testid="filter-punto" @change="onPuntoChange">
            <option value="">Todos</option>
            <option v-for="p in PUNTOS_DE_VENTA" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="dash-filter">
          <label for="filter-user">Usuario</label>
          <select id="filter-user" v-model="userId" :class="{ 'is-active': userId }" data-testid="filter-user">
            <option value="">Todos</option>
            <option v-for="u in userOptions" :key="u.userId" :value="u.userId">{{ u.fullName || '(sin nombre)' }}</option>
          </select>
        </div>
        <div class="dash-filter">
          <label for="filter-quiz">Examen</label>
          <select id="filter-quiz" v-model="quizId" :class="{ 'is-active': quizId }" data-testid="filter-quiz">
            <option value="">Todos</option>
            <option v-for="q in quizOptions" :key="q.quizId" :value="q.quizId">{{ q.quizTitle }}</option>
          </select>
        </div>
        <div class="dash-filter">
          <label for="filter-status">Estado</label>
          <select id="filter-status" v-model="estado" :class="{ 'is-active': estado }" data-testid="filter-status">
            <option value="">Todos</option>
            <option v-for="s in STATUS_ORDER" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
    </section>

    <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

    <p v-if="loading" class="dash-muted">Cargando…</p>

    <template v-else-if="users">
      <p v-if="!totals.assigned" class="dash-muted dash-empty">
        {{ activeCount ? 'Ningún resultado con estos filtros.' : 'No hay exámenes asignados.' }}
      </p>

      <template v-else>
        <div class="dash-kpis">
          <div v-for="k in kpis" :key="k.label" :class="['card', 'kpi', k.alert && 'kpi-alert']">
            <span class="kpi-label">{{ k.label }}</span>
            <strong class="kpi-value" :data-testid="k.testid">{{ k.value }}</strong>
            <div v-if="k.bar != null" class="track kpi-bar"><div class="fill" :style="{ width: k.bar + '%' }"></div></div>
            <span v-else-if="k.delta != null" class="kpi-sub">
              <b :class="k.delta >= 0 ? 'up' : 'down'">{{ k.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(k.delta) }}</b> vs. semana anterior
            </span>
            <span v-else class="kpi-sub">{{ k.sub }}</span>
          </div>
        </div>

        <div class="dash-charts">
          <section class="card chart-card">
            <h2 class="chart-title">Estado de los exámenes</h2>
            <StackBar :counts="counts" :height="18" />
            <StatusLegend :counts="counts" />
          </section>
          <section class="card chart-card">
            <div class="chart-head">
              <h2 class="chart-title">Distribución de puntajes</h2>
              <span class="chart-note">{{ scores.length }} exámenes calificados</span>
            </div>
            <ScoreHistogram :scores="scores" />
          </section>

          <section class="card chart-card chart-wide">
            <div class="chart-head">
              <h2 class="chart-title">Actividad</h2>
              <div class="seg-ctrl" role="group" aria-label="Rango de días">
                <button v-for="n in [7, 14, 21]" :key="n" type="button" :class="{ on: range === n }" :aria-pressed="range === n" @click="range = n">{{ n }} días</button>
              </div>
            </div>
            <div class="activity">
              <div>
                <div class="act-chart">
                  <div v-for="x in days" :key="x.d" class="act-col" :title="`${x.date.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}: ${x.n} completados`">
                    <span class="act-n">{{ x.n || '' }}</span>
                    <div class="act-track"><div class="act-bar" :style="{ height: (x.n / dayMax) * 100 + '%' }"></div></div>
                    <span class="act-l">{{ x.d === 0 ? 'Hoy' : x.date.getDate() }}</span>
                  </div>
                </div>
                <p class="chart-note" style="margin-top: 10px">Exámenes completados por día · {{ days.reduce((n, x) => n + x.n, 0) }} en total</p>
              </div>
              <div class="recent">
                <h3 class="mini-title">Últimos completados</h3>
                <p v-if="!recent.length" class="dash-muted">Sin entregas todavía.</p>
                <ul v-else>
                  <li v-for="r in recent" :key="r.assignmentId">
                    <div class="recent-main"><strong>{{ r.user.fullName }}</strong><span>{{ r.quizTitle }}</span></div>
                    <ScorePill :value="r.scorePercent" />
                    <span class="recent-when">{{ relDate(r.submittedAt, now) }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section class="card chart-card chart-wide">
            <h2 class="chart-title">Avance por examen</h2>
            <div class="gtable">
              <div class="grow ghead"><span>Examen</span><span>Estado</span><span>Avance</span><span>Promedio</span><span class="hide-sm">Usuarios</span></div>
              <div v-for="g in quizGroups" :key="g.key" class="grow" :data-testid="'quiz-row-' + g.key">
                <strong class="g-name">{{ g.label }}</strong>
                <div class="g-stack">
                  <StackBar :counts="g.counts" :height="10" />
                  <span class="caption">{{ g.completed }}/{{ g.assigned }} completados · {{ g.counts.Vencido }} vencidos</span>
                </div>
                <span class="u-num">{{ g.completionPercent }}%</span>
                <span><ScorePill :value="g.averageScore" /></span>
                <span class="u-num hide-sm">{{ g.people }}</span>
              </div>
            </div>
          </section>

          <section v-if="puntoGroups.length > 1" class="card chart-card">
            <h2 class="chart-title">Avance por punto de venta</h2>
            <ul class="punto-list">
              <li v-for="(g, i) in puntoGroups" :key="g.key">
                <span class="punto-rank">{{ i + 1 }}</span>
                <div class="punto-main">
                  <div class="punto-head"><strong>{{ g.label }}</strong><span>{{ g.completionPercent }}%</span></div>
                  <div class="track" role="progressbar" :aria-label="'Avance de ' + g.label" :aria-valuenow="g.completionPercent" aria-valuemin="0" aria-valuemax="100">
                    <div class="fill" :style="{ width: g.completionPercent + '%' }"></div>
                  </div>
                  <span class="caption">{{ g.completed }}/{{ g.assigned }} · {{ g.people }} usuarios · prom. {{ pct(g.averageScore) }}</span>
                </div>
              </li>
            </ul>
          </section>

          <section :class="['card', 'chart-card', puntoGroups.length > 1 ? '' : 'chart-wide']">
            <div class="chart-head">
              <h2 class="chart-title">Requieren atención</h2>
              <span class="chart-note">{{ attention.length ? `${attention.length} usuarios` : '' }}</span>
            </div>
            <p v-if="!attention.length" class="dash-muted">Nadie con vencidos, promedio bajo ni inactividad.</p>
            <ul v-else class="attn">
              <li v-for="a in attention" :key="a.u.userId" :data-testid="'attn-' + a.u.userId">
                <div class="attn-main"><strong>{{ a.u.fullName }}</strong><span>{{ a.u.puntoDeVenta }} · {{ a.u.completed }}/{{ a.u.assigned }}</span></div>
                <div class="attn-tags"><span v-for="r in a.reasons" :key="r" class="tag">{{ r }}</span></div>
              </li>
            </ul>
            <p v-if="bestUser" class="attn-best">Mejor promedio: <strong>{{ bestUser.fullName }}</strong> · {{ bestUser.averageScore }}%</p>
          </section>
        </div>

        <div class="chart-head" style="margin-bottom: 12px">
          <h2 class="chart-title">Usuarios</h2>
          <span class="chart-note">{{ filteredUsers.length }} usuarios · clic en una columna para ordenar</span>
        </div>
        <div class="card utable">
          <div class="urow uhead">
            <button v-for="h in sortHeads.slice(0, 1)" :key="h.k" type="button" :class="['th', sort.key === h.k && 'is-sorted']" @click="sortBy(h.k)">{{ h.label }}<span class="th-arrow">{{ arrow(h.k) }}</span></button>
            <span class="th">Estado de exámenes</span>
            <button v-for="h in sortHeads.slice(1)" :key="h.k" type="button" :class="['th', h.cls, sort.key === h.k && 'is-sorted']" @click="sortBy(h.k)">{{ h.label }}<span class="th-arrow">{{ arrow(h.k) }}</span></button>
            <span></span>
          </div>
          <div v-for="u in sortedUsers" :key="u.userId" :class="['ublock', 'dash-user', isOpen(u.userId) && 'is-open']">
            <div class="urow" @click="toggle(u.userId)">
              <div class="u-name"><strong>{{ u.fullName }}</strong><span>{{ u.puntoDeVenta }}<template v-if="u.email"> · {{ u.email }}</template></span></div>
              <div class="u-stack">
                <StackBar :counts="statusCounts(u.quizzes)" :height="10" />
                <span class="caption">{{ u.completed }}/{{ u.assigned }} completados</span>
              </div>
              <span class="u-num" role="progressbar" :aria-label="'Avance de ' + u.fullName" :aria-valuenow="u.completionPercent" aria-valuemin="0" aria-valuemax="100" :data-testid="'completion-' + u.userId">{{ u.completionPercent }}%</span>
              <span :data-testid="'average-' + u.userId"><span :data-testid="'avg-' + u.userId"><ScorePill :value="u.averageScore" /></span></span>
              <span :class="['u-num', 'hide-sm', statusCounts(u.quizzes).Vencido ? 'is-alert' : 'is-zero']">{{ statusCounts(u.quizzes).Vencido }}</span>
              <span class="u-last hide-sm">{{ relDate(lastActivity(u), now) }}</span>
              <button
                type="button"
                class="u-toggle"
                :data-testid="'toggle-' + u.userId"
                :aria-expanded="isOpen(u.userId)"
                @click.stop="toggle(u.userId)"
              >
                {{ isOpen(u.userId) ? 'Ocultar' : 'Ver exámenes' }}
              </button>
            </div>
            <ul v-if="isOpen(u.userId)" class="uquizzes">
              <li v-for="q in u.quizzes" :key="q.assignmentId">
                <span class="uq-title">{{ q.quizTitle }}<span v-if="q.cycle > 1" class="cycle">ciclo {{ q.cycle }}</span></span>
                <StatusBadge :label="statusLabel(q)" />
                <span :data-testid="'score-' + q.assignmentId"><ScorePill :value="q.scorePercent" /></span>
                <span class="uq-date">{{ q.submittedAt ? fullDate(q.submittedAt) : '—' }}</span>
                <router-link
                  v-if="q.attemptStatus === 'completed' && q.attemptId"
                  class="uq-link"
                  :to="`/admin/quizzes/${q.quizId}/attempts/${q.attemptId}`"
                >Ver intento →</router-link>
                <span v-else class="uq-link"></span>
              </li>
            </ul>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAssignmentsStore } from '../../stores/assignments.js'
import { useAuthStore } from '../../stores/auth.js'
import { PUNTOS_DE_VENTA } from '../../lib/puntosDeVenta.js'
import {
  STATUS_ORDER, attentionReasons, daysAgo, fullDate, lastActivity, pct, relDate, statusCounts, statusLabel, summarize
} from '../../lib/progress.js'
import StackBar from '../../components/dashboard/StackBar.vue'
import StatusLegend from '../../components/dashboard/StatusLegend.vue'
import StatusBadge from '../../components/dashboard/StatusBadge.vue'
import ScorePill from '../../components/dashboard/ScorePill.vue'
import ScoreHistogram from '../../components/dashboard/ScoreHistogram.vue'
import '../../components/dashboard/dashboard.css'

const store = useAssignmentsStore()
const auth = useAuthStore()
const now = new Date()
const DAY = 864e5

const users = ref(null)
const loading = ref(true)
const error = ref(null)
const puntoDeVenta = ref('')
const userId = ref('')
const quizId = ref('')
const estado = ref('')
const open = ref(new Set())
const range = ref(14)
const sort = ref({ key: 'completionPercent', dir: 'asc' })

const scopeLabel = computed(() => {
  if (auth.isSuperadmin) return puntoDeVenta.value || 'Todos los puntos de venta'
  const punto = users.value?.[0]?.puntoDeVenta
  return punto ? `Punto de venta: ${punto}` : 'Tu punto de venta'
})

const activeCount = computed(() => [puntoDeVenta.value, userId.value, quizId.value, estado.value].filter(Boolean).length)
function clearFilters() {
  userId.value = ''
  quizId.value = ''
  estado.value = ''
  // Punto is a server-side filter: clearing it needs a refetch.
  if (puntoDeVenta.value) {
    puntoDeVenta.value = ''
    load()
  }
}
function onPuntoChange() {
  load()
}

const userOptions = computed(() =>
  [...(users.value ?? [])].sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''))
)
const quizOptions = computed(() => {
  const map = new Map()
  for (const u of users.value ?? []) for (const q of u.quizzes) map.set(q.quizId, q.quizTitle)
  return [...map].map(([id, quizTitle]) => ({ quizId: id, quizTitle })).sort((a, b) => (a.quizTitle ?? '').localeCompare(b.quizTitle ?? ''))
})

// Usuario narrows the list; Examen/Estado narrow each usuario's quizzes and
// recompute their metrics, dropping usuarios left with none. Without those
// filters the server's per-usuario metrics are kept as-is.
const filteredUsers = computed(() => {
  let list = users.value ?? []
  if (userId.value) list = list.filter((u) => u.userId === userId.value)
  if (!quizId.value && !estado.value) return list
  return list
    .map((u) => {
      const quizzes = u.quizzes.filter((q) => (!quizId.value || q.quizId === quizId.value) && (!estado.value || statusLabel(q) === estado.value))
      return { ...u, quizzes, ...summarize(quizzes) }
    })
    .filter((u) => u.quizzes.length)
})

const rows = computed(() => filteredUsers.value.flatMap((u) => u.quizzes.map((q) => ({ ...q, user: u }))))
const counts = computed(() => statusCounts(rows.value))
const totals = computed(() => {
  const assigned = filteredUsers.value.reduce((n, u) => n + u.assigned, 0)
  const completed = filteredUsers.value.reduce((n, u) => n + u.completed, 0)
  return { assigned, completed, completionPercent: assigned ? Math.round((completed / assigned) * 100) : 0, averageScore: summarize(rows.value).averageScore }
})
const scores = computed(() => rows.value.filter((r) => r.attemptStatus === 'completed' && typeof r.scorePercent === 'number').map((r) => r.scorePercent))
const done = computed(() => rows.value.filter((r) => r.submittedAt))

function group(keyFn, labelFn) {
  const m = new Map()
  for (const r of rows.value) {
    const k = keyFn(r)
    if (!m.has(k)) m.set(k, { key: k, label: labelFn(r), rows: [] })
    m.get(k).rows.push(r)
  }
  return [...m.values()]
    .map((g) => ({ ...g, ...summarize(g.rows), counts: statusCounts(g.rows), people: new Set(g.rows.map((r) => r.user.userId)).size }))
    .sort((a, b) => b.completionPercent - a.completionPercent || (a.label ?? '').localeCompare(b.label ?? ''))
}
const quizGroups = computed(() => group((r) => r.quizId, (r) => r.quizTitle))
const puntoGroups = computed(() => group((r) => r.user.puntoDeVenta ?? 'Sin punto', (r) => r.user.puntoDeVenta ?? 'Sin punto'))

const kpis = computed(() => {
  const c = counts.value
  const last7 = done.value.filter((r) => daysAgo(r.submittedAt, now) < 7).length
  const prev7 = done.value.filter((r) => { const d = daysAgo(r.submittedAt, now); return d >= 7 && d < 14 }).length
  const fullyDone = filteredUsers.value.filter((u) => u.assigned && u.completed === u.assigned).length
  const expiredUsers = new Set(rows.value.filter((r) => statusLabel(r) === 'Vencido').map((r) => r.user.userId)).size
  const s = scores.value
  return [
    { label: 'Usuarios', testid: 'total-users', value: filteredUsers.value.length, sub: `${fullyDone} con todo completado` },
    { label: 'Asignados', testid: 'kpi-assigned', value: totals.value.assigned, sub: `${quizGroups.value.length} exámenes distintos` },
    { label: 'Completados', testid: 'overall', value: `${totals.value.completed}/${totals.value.assigned}`, delta: last7 - prev7 },
    { label: 'Avance', testid: 'kpi-completion', value: pct(totals.value.completionPercent), bar: totals.value.completionPercent },
    { label: 'Promedio', testid: 'kpi-average', value: pct(totals.value.averageScore), sub: s.length ? `rango ${Math.min(...s)}–${Math.max(...s)}%` : 'sin puntajes' },
    { label: 'Vencidos', value: c.Vencido, sub: `en ${expiredUsers} usuario${expiredUsers === 1 ? '' : 's'}`, alert: c.Vencido > 0 }
  ]
})

const days = computed(() =>
  Array.from({ length: range.value }, (_, i) => {
    const d = range.value - 1 - i
    return { d, n: done.value.filter((r) => daysAgo(r.submittedAt, now) === d).length, date: new Date(now - d * DAY) }
  })
)
const dayMax = computed(() => Math.max(1, ...days.value.map((x) => x.n)))
const recent = computed(() => [...done.value].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 5))

// Most urgent first: expired quizzes weigh most, then a failing average and no activity.
const attention = computed(() =>
  filteredUsers.value
    .map((u) => ({
      u,
      reasons: attentionReasons(u, now),
      weight: statusCounts(u.quizzes).Vencido * 3 + (u.averageScore != null && u.averageScore < 60 ? 2 : 0) + (lastActivity(u) ? 0 : 2)
    }))
    .filter((a) => a.reasons.length)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
)
const bestUser = computed(() => [...filteredUsers.value].filter((u) => u.averageScore != null).sort((a, b) => b.averageScore - a.averageScore)[0])

const sortHeads = [
  { k: 'fullName', label: 'Usuario' },
  { k: 'completionPercent', label: 'Avance' },
  { k: 'averageScore', label: 'Promedio' },
  { k: 'expired', label: 'Vencidos', cls: 'hide-sm' },
  { k: 'last', label: 'Última actividad', cls: 'hide-sm' }
]
const sortValue = (u, k) => (k === 'last' ? lastActivity(u) ?? '' : k === 'expired' ? statusCounts(u.quizzes).Vencido : u[k] ?? (k === 'fullName' ? '' : -1))
const sortedUsers = computed(() => {
  const { key, dir } = sort.value
  return [...filteredUsers.value].sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key)
    const r = typeof va === 'string' ? va.localeCompare(vb) : va - vb
    return dir === 'asc' ? r : -r
  })
})
function sortBy(key) {
  sort.value = { key, dir: sort.value.key === key && sort.value.dir === 'desc' ? 'asc' : 'desc' }
}
const arrow = (k) => (sort.value.key === k ? (sort.value.dir === 'asc' ? '↑' : '↓') : '')

const isOpen = (id) => open.value.has(id)
function toggle(id) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}

// Only the latest request may write state: a slower earlier response must not
// overwrite the newer filter's result.
let latestRequest = 0

async function load() {
  const id = ++latestRequest
  loading.value = true
  error.value = null
  try {
    const res = await store.fetchProgress({ punto_de_venta: puntoDeVenta.value })
    if (id !== latestRequest) return
    users.value = res.users
    // Drop selections that no longer exist in the reloaded data.
    if (!res.users.some((u) => u.userId === userId.value)) userId.value = ''
    if (!quizOptions.value.some((q) => q.quizId === quizId.value)) quizId.value = ''
  } catch (e) {
    if (id !== latestRequest) return
    users.value = null
    error.value = e.message
  } finally {
    if (id === latestRequest) loading.value = false
  }
}

onMounted(load)
</script>
