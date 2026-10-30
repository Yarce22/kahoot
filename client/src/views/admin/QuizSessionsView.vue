<template>
  <div class="quiz-sessions-view view-transition-enter">

    <!-- Header -->
    <div class="session-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 14px;">
          ← Mis quizzes
        </router-link>
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary);">
          Historial
        </h1>
      </div>
    </div>

    <!-- Exámenes asignados — the PRIMARY section: async attempts a usuario
         took on their own time via /user/quizzes, not a live PIN session.
         This is what most quizzes in this product are actually used for now
         (spec: nuevo-rol-usuario-punto-de-venta), so it goes first. -->
    <section style="margin-bottom: 36px;">
      <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 14px;">
        Exámenes asignados
      </h2>

      <p v-if="attemptsError" class="error-msg" role="alert">{{ attemptsError }}</p>

      <p v-if="loadingAttempts" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
        Cargando…
      </p>

      <p
        v-else-if="!attemptsError && !attempts.length"
        style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700; text-align: center; margin-top: 20px;"
      >
        Todavía nadie rindió este cuestionario como examen asignado.
      </p>

      <div v-else class="session-list">
        <button
          v-for="a in attempts"
          :key="a.id"
          class="card session-row"
          @click="openAttempt(a)"
        >
          <div class="session-row-main">
            <span class="session-row-date">{{ a.user?.fullName ?? 'Usuario desconocido' }}</span>
            <span class="session-row-meta">
              <span class="badge" :class="statusBadgeClass(a.status)" style="margin-right: 8px;">{{ statusLabel(a.status) }}</span>
              <template v-if="a.status !== 'in_progress'">{{ a.correctCount }}/{{ a.totalQuestions }} correctas · </template>
              {{ formatDate(a.submittedAt || a.startedAt) }}
            </span>
          </div>
          <span class="session-row-chevron" aria-hidden="true">▸</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAttemptsStore } from '../../stores/attempts.js'

const route = useRoute()
const router = useRouter()
const attemptsStore = useAttemptsStore()
const quizId = route.params.id

const attempts = ref([])
const loadingAttempts = ref(false)
const attemptsError = ref('')

const STATUS_LABELS = { in_progress: 'En curso', completed: 'Completado', expired: 'Vencido' }
const STATUS_BADGES = { in_progress: 'badge-blue', completed: 'badge-green', expired: 'badge-orange' }

function statusLabel(status) { return STATUS_LABELS[status] ?? status }
function statusBadgeClass(status) { return STATUS_BADGES[status] ?? 'badge-blue' }

// Live PIN sessions are hidden from the product for now (backend and routes
// remain); only assigned-exam attempts are listed.
// page_size 25 (the default): quiz-scoped history with no pagination UI yet —
// a quiz assigned to more than 25 usuarios in one cycle is a future concern.
onMounted(async () => {
  loadingAttempts.value = true
  try {
    attempts.value = (await attemptsStore.fetchAttempts({ quiz_id: quizId })).attempts
  } catch (e) {
    attemptsError.value = `Error cargando los exámenes: ${e.message}`
  } finally {
    loadingAttempts.value = false
  }
})

function openAttempt(attempt) {
  router.push(`/admin/quizzes/${quizId}/attempts/${attempt.id}`)
}

function formatDate(iso) {
  if (!iso) return 'Fecha desconocida'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Fecha desconocida'
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
</script>

<style scoped>
.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 16px 20px;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.session-row:hover {
  border-color: var(--accent-purple);
  transform: translateY(-1px);
}

.session-row-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-row-date {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 16px;
  color: var(--text-primary);
}

.session-row-meta {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
}

.session-row-chevron {
  font-size: 18px;
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>
