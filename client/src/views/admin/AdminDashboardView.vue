<template>
  <div class="admin-dashboard-view view-transition-enter">
    <div class="dash-header">
      <h1 class="nunito dash-title">Dashboard</h1>
      <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 16px;">
        ← Volver
      </router-link>
    </div>

    <!-- Plain admins are pinned to their own store server-side; only a
         superadmin can choose one. Usuario/Examen narrow the loaded data
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
          <select id="filter-punto" v-model="puntoDeVenta" :class="{ 'is-active': puntoDeVenta }" data-testid="filter-punto" @change="load">
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
      </div>
    </section>

    <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

    <p v-if="loading" class="dash-muted">Cargando…</p>

    <template v-else-if="users">
      <div class="dash-kpis">
        <div class="card kpi"><strong class="kpi-value" data-testid="total-users">{{ filteredUsers.length }}</strong><span class="kpi-label">Usuarios</span></div>
        <div class="card kpi"><strong class="kpi-value" data-testid="kpi-assigned">{{ totals.assigned }}</strong><span class="kpi-label">Asignados</span></div>
        <div class="card kpi"><strong class="kpi-value" data-testid="overall">{{ totals.completed }}/{{ totals.assigned }}</strong><span class="kpi-label">Completados</span></div>
        <div class="card kpi"><strong class="kpi-value" data-testid="kpi-completion">{{ pct(totals.completionPercent) }}</strong><span class="kpi-label">Avance</span></div>
        <div class="card kpi"><strong class="kpi-value" data-testid="kpi-average">{{ pct(totals.averageScore) }}</strong><span class="kpi-label">Promedio</span></div>
      </div>

      <p v-if="!totals.assigned" class="dash-muted dash-empty">
        {{ filtersActive ? 'Ningún resultado con estos filtros.' : 'No hay exámenes asignados.' }}
      </p>

      <template v-else>
        <div class="dash-charts">
          <section class="card chart-card">
            <h2 class="nunito chart-title">Estado de los exámenes</h2>
            <StatusStackBar :counts="counts" />
          </section>
          <section class="card chart-card">
            <h2 class="nunito chart-title">Avance por examen</h2>
            <HBarChart title="Avance por examen" :items="quizItems" />
          </section>
          <section v-if="puntoItems.length > 1" class="card chart-card chart-wide">
            <h2 class="nunito chart-title">Avance por punto de venta</h2>
            <HBarChart title="Avance por punto de venta" :items="puntoItems" />
          </section>
        </div>

        <h2 class="nunito chart-title dash-section">Usuarios</h2>
      <ul class="dash-list">
        <li v-for="u in filteredUsers" :key="u.userId" class="card dash-user">
          <div class="dash-user-head">
            <div class="dash-user-name">
              <strong>{{ u.fullName }}</strong>
              <span class="dash-muted">{{ u.puntoDeVenta }}</span>
            </div>
            <span class="dash-count">{{ u.completed }}/{{ u.assigned }}</span>
            <div
              class="bar"
              role="progressbar"
              :aria-label="'Avance de ' + u.fullName"
              :aria-valuenow="u.completionPercent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div class="bar-fill" :style="{ width: u.completionPercent + '%' }"></div>
            </div>
            <span class="dash-metric" :data-testid="'completion-' + u.userId">
              <span class="dash-metric-label">Avance</span> {{ pct(u.completionPercent) }}
            </span>
            <span class="dash-metric" :data-testid="'average-' + u.userId">
              <span class="dash-metric-label">Promedio</span> <span :data-testid="'avg-' + u.userId">{{ pct(u.averageScore) }}</span>
            </span>
            <button
              class="btn btn-ghost dash-toggle"
              style="font-size: 13px; padding: 6px 12px;"
              :data-testid="'toggle-' + u.userId"
              :aria-expanded="isOpen(u.userId)"
              @click="toggle(u.userId)"
            >
              {{ isOpen(u.userId) ? 'Ocultar' : 'Ver exámenes' }}
            </button>
          </div>
          <ul v-if="isOpen(u.userId)" class="dash-quizzes">
            <li v-for="q in u.quizzes" :key="q.assignmentId" class="dash-quiz">
              <span class="dash-quiz-title">{{ q.quizTitle }}</span>
              <span class="badge">{{ statusLabel(q) }}</span>
              <span :data-testid="'score-' + q.assignmentId">{{ pct(q.scorePercent) }}</span>
            </li>
          </ul>
        </li>
      </ul>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAssignmentsStore } from '../../stores/assignments.js'
import { useAuthStore } from '../../stores/auth.js'
import { PUNTOS_DE_VENTA } from '../../lib/puntosDeVenta.js'
import { byPunto, byQuiz, pct, statusCounts, statusLabel, summarize } from '../../lib/progress.js'
import StatusStackBar from '../../components/dashboard/StatusStackBar.vue'
import HBarChart from '../../components/dashboard/HBarChart.vue'

const store = useAssignmentsStore()
const auth = useAuthStore()

const users = ref(null)
const loading = ref(true)
const error = ref(null)
const puntoDeVenta = ref('')
const open = ref(new Set())

const userId = ref('')
const quizId = ref('')

const activeCount = computed(() => [puntoDeVenta.value, userId.value, quizId.value].filter(Boolean).length)
const filtersActive = computed(() => activeCount.value > 0)
function clearFilters() {
  userId.value = ''
  quizId.value = ''
  // Punto is a server-side filter: clearing it needs a refetch.
  if (puntoDeVenta.value) {
    puntoDeVenta.value = ''
    load()
  }
}

const userOptions = computed(() =>
  [...(users.value ?? [])].sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''))
)
const quizOptions = computed(() => {
  const map = new Map()
  for (const u of users.value ?? []) for (const q of u.quizzes) map.set(q.quizId, q.quizTitle)
  return [...map].map(([id, quizTitle]) => ({ quizId: id, quizTitle })).sort((a, b) => (a.quizTitle ?? '').localeCompare(b.quizTitle ?? ''))
})

// Usuario narrows the list; Examen narrows each usuario's quizzes and
// recomputes their metrics, dropping usuarios left with none. Without an exam
// filter the server's per-usuario metrics are kept as-is.
const filteredUsers = computed(() => {
  let list = users.value ?? []
  if (userId.value) list = list.filter((u) => u.userId === userId.value)
  if (!quizId.value) return list
  return list
    .map((u) => {
      const quizzes = u.quizzes.filter((q) => q.quizId === quizId.value)
      return { ...u, quizzes, ...summarize(quizzes) }
    })
    .filter((u) => u.quizzes.length)
})

const rows = computed(() => filteredUsers.value.flatMap((u) => u.quizzes))
const counts = computed(() => statusCounts(rows.value))
const totals = computed(() => {
  const assigned = filteredUsers.value.reduce((n, u) => n + u.assigned, 0)
  const completed = filteredUsers.value.reduce((n, u) => n + u.completed, 0)
  return {
    assigned,
    completed,
    completionPercent: assigned ? Math.round((completed / assigned) * 100) : 0,
    averageScore: summarize(rows.value).averageScore
  }
})
const caption = (r) => `${r.completed}/${r.assigned} · prom. ${pct(r.averageScore)}`
const quizItems = computed(() =>
  byQuiz(filteredUsers.value).map((q) => ({ key: q.quizId, label: q.quizTitle, value: q.completionPercent, caption: caption(q) }))
)
const puntoItems = computed(() =>
  byPunto(filteredUsers.value).map((p) => ({ key: p.puntoDeVenta, label: p.puntoDeVenta, value: p.completionPercent, caption: caption(p) }))
)

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

<style scoped>
.admin-dashboard-view { min-height: 100vh; padding: 32px 24px 40px; position: relative; z-index: 1; }
.dash-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 14px; }
.dash-title { font-weight: 900; font-size: 28px; color: var(--text-primary); }
.dash-muted { color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700; }
.dash-empty { text-align: center; margin-top: 40px; }
.dash-filters { padding: 16px 20px 18px; margin-bottom: 20px; font-family: 'Nunito', sans-serif; }
.dash-filters-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; margin-bottom: 12px; }
.dash-filters-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 800; color: var(--text-primary); }
.dash-filters-count { min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; background: var(--salvia-700); color: #fff; font-size: 12px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.dash-clear { border: none; background: none; padding: 4px 6px; border-radius: var(--radius-md); color: var(--terracota-700); font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
.dash-clear:hover { text-decoration: underline; }
.dash-clear:focus-visible { outline: 2px solid var(--terracota-700); outline-offset: 2px; }
.dash-filters-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px 16px; }
.dash-filter { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dash-filter label { font-weight: 800; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); }
/* Native select with the arrow redrawn, so it matches the card palette. */
.dash-filter select {
  appearance: none; width: 100%; padding: 10px 38px 10px 14px; cursor: pointer;
  border: 1.5px solid var(--neutral-300); border-radius: var(--radius-md);
  background: var(--neutral-100) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%2356633f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 14px center;
  color: var(--text-primary); font-family: inherit; font-weight: 700; font-size: 14px; text-overflow: ellipsis;
  transition: border-color .15s, box-shadow .15s, background-color .15s;
}
.dash-filter select:hover { border-color: var(--salvia-500); }
.dash-filter select:focus-visible { outline: none; border-color: var(--salvia-700); box-shadow: 0 0 0 3px var(--salvia-200); }
.dash-filter select.is-active { border-color: var(--salvia-700); background-color: var(--salvia-100); }
.dash-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 20px; }
.kpi { display: flex; flex-direction: column; gap: 2px; padding: 16px 18px; font-family: 'Nunito', sans-serif; }
.kpi-value { font-size: 28px; font-weight: 900; color: var(--text-primary); }
.kpi-label { font-size: 13px; font-weight: 700; color: var(--text-secondary); }
.dash-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 28px; }
.chart-card { padding: 18px 20px; min-width: 0; }
.chart-wide { grid-column: 1 / -1; }
.chart-title { font-weight: 800; font-size: 16px; color: var(--text-primary); margin-bottom: 14px; }
.dash-section { margin-bottom: 12px; }
@media (max-width: 720px) {
  .admin-dashboard-view { padding: 24px 16px 32px; }
  .dash-charts { grid-template-columns: minmax(0, 1fr); }
  .dash-filters-grid { grid-template-columns: minmax(0, 1fr); }
  .dash-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpi:last-child:nth-child(odd) { grid-column: 1 / -1; }
}
.dash-list { list-style: none; padding: 0; display: grid; gap: 12px; }
.dash-user { padding: 16px 20px; font-family: 'Nunito', sans-serif; color: var(--text-primary); }
/* Fixed metric columns keep the bars aligned across rows, whatever the name or
   button text length. */
.dash-user-head { display: grid; grid-template-columns: minmax(160px, 1fr) 48px 140px 110px 130px 120px; align-items: center; gap: 14px; }
.dash-user-name { display: flex; flex-direction: column; min-width: 0; }
.dash-count { text-align: right; }
.dash-metric { white-space: nowrap; }
.dash-metric-label { color: var(--text-secondary); font-size: 13px; font-weight: 700; }
.dash-toggle { justify-self: end; }
@media (max-width: 720px) {
  .dash-user-head { grid-template-columns: 1fr auto; }
  .dash-user-head .bar { width: 100%; }
  .dash-count { text-align: left; }
}
.bar { width: 140px; height: 10px; border-radius: var(--radius-md); background: var(--bg-elevated); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent-green); }
.dash-quizzes { list-style: none; padding: 12px 0 0; display: grid; gap: 8px; }
.dash-quiz { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.dash-quiz-title { flex: 1; min-width: 160px; }
</style>
