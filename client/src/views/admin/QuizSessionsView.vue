<template>
  <div class="quiz-sessions-view view-transition-enter">

    <!-- Header -->
    <div class="session-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 14px;">
          ← Mis quizzes
        </router-link>
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary);">
          Historial de sesiones
        </h1>
      </div>
    </div>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <!-- Loading list -->
    <p v-if="loadingList" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando…
    </p>

    <!-- Empty -->
    <p
      v-else-if="!sessions.length"
      style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700; text-align: center; margin-top: 40px;"
    >
      Este cuestionario todavía no tiene sesiones finalizadas.
    </p>

    <!-- Session list — each row opens its own results page -->
    <div v-else class="session-list">
      <button
        v-for="s in sessions"
        :key="s.id"
        class="card session-row"
        @click="openSession(s)"
      >
        <div class="session-row-main">
          <span class="session-row-date">{{ formatDate(s.endedAt || s.createdAt) }}</span>
          <span class="session-row-meta">PIN {{ s.pin }} · {{ s.playerCount }} jugador(es)</span>
        </div>
        <span class="session-row-chevron" aria-hidden="true">▸</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'

const route = useRoute()
const router = useRouter()
const store = useQuizStore()
const quizId = route.params.id

const sessions = ref([])
const loadingList = ref(false)
const errorMsg = ref('')

onMounted(async () => {
  loadingList.value = true
  try {
    sessions.value = await store.fetchQuizSessions(quizId)
  } catch (e) {
    errorMsg.value = `Error cargando el historial: ${e.message}`
  } finally {
    loadingList.value = false
  }
})

function openSession(session) {
  router.push(`/admin/quizzes/${quizId}/sessions/${session.pin}`)
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
}

.session-row-chevron {
  font-size: 18px;
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>
