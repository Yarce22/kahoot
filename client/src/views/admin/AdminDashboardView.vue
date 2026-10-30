<template>
  <div class="admin-dashboard-view view-transition-enter">
    <div class="dash-header">
      <h1 class="nunito dash-title">Dashboard</h1>
      <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 16px;">
        ← Volver
      </router-link>
    </div>

    <!-- Plain admins are pinned to their own store server-side; only a
         superadmin can choose one. -->
    <label v-if="auth.isSuperadmin" class="dash-filter">
      Punto de venta
      <select v-model="puntoDeVenta" @change="load">
        <option value="">Todos</option>
        <option v-for="p in PUNTOS_DE_VENTA" :key="p" :value="p">{{ p }}</option>
      </select>
    </label>

    <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

    <p v-if="loading" class="dash-muted">Cargando…</p>

    <template v-else-if="users">
      <div class="card dash-summary">
        <span>Usuarios: <strong data-testid="total-users">{{ users.length }}</strong></span>
        <span>Completados: <strong data-testid="overall">{{ totals.completed }}/{{ totals.assigned }}</strong></span>
      </div>

      <p v-if="!totals.assigned" class="dash-muted dash-empty">No hay exámenes asignados.</p>

      <ul v-else class="dash-list">
        <li v-for="u in users" :key="u.userId" class="card dash-user">
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
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAssignmentsStore } from '../../stores/assignments.js'
import { useAuthStore } from '../../stores/auth.js'
import { PUNTOS_DE_VENTA } from '../../lib/puntosDeVenta.js'
import { pct, statusLabel } from '../../lib/progress.js'

const store = useAssignmentsStore()
const auth = useAuthStore()

const users = ref(null)
const loading = ref(true)
const error = ref(null)
const puntoDeVenta = ref('')
const open = ref(new Set())

const totals = computed(() => {
  const list = users.value ?? []
  return {
    assigned: list.reduce((n, u) => n + u.assigned, 0),
    completed: list.reduce((n, u) => n + u.completed, 0)
  }
})

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
.dash-filter { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; font-family: 'Nunito', sans-serif; font-weight: 700; color: var(--text-primary); }
.dash-summary { display: flex; gap: 28px; flex-wrap: wrap; padding: 18px 24px; margin-bottom: 24px; font-family: 'Nunito', sans-serif; color: var(--text-primary); }
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
