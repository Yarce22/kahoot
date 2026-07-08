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

    <!-- Session list -->
    <div v-else class="session-list">
      <button
        v-for="s in sessions"
        :key="s.id"
        class="card session-row"
        :class="{ 'session-row-active': selectedPin === s.pin }"
        @click="openSession(s)"
      >
        <div class="session-row-main">
          <span class="session-row-date">{{ formatDate(s.endedAt || s.createdAt) }}</span>
          <span class="session-row-meta">PIN {{ s.pin }} · {{ s.playerCount }} jugador(es)</span>
        </div>
        <span class="session-row-chevron" aria-hidden="true">▸</span>
      </button>
    </div>

    <!-- Selected session results -->
    <div v-if="selectedPin" class="session-detail">
      <p v-if="loadingResults" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
        Cargando resultados…
      </p>

      <template v-else>
        <!-- Leaderboard -->
        <div v-if="leaderboard.length" class="card" style="padding: 24px; margin-bottom: 20px;">
          <h2 class="nunito" style="font-weight: 900; font-size: 20px; color: var(--text-primary); margin-bottom: 16px;">
            🏆 Clasificación
          </h2>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div
              v-for="(entry, i) in leaderboard"
              :key="entry.nickname"
              :class="['leaderboard-item', rankClass(i)]"
            >
              <div class="rank-badge">{{ rankLabel(i) }}</div>
              <span class="player-name">{{ entry.nickname }}</span>
              <span class="player-score">{{ entry.score }} pts</span>
            </div>
          </div>
        </div>

        <!-- Answers by player -->
        <div class="card" style="padding: 24px;">
          <h2 class="nunito" style="font-weight: 900; font-size: 20px; color: var(--text-primary); margin-bottom: 16px;">
            📋 Respuestas por jugador
          </h2>

          <div v-if="groupedResults.length" style="display: flex; flex-direction: column; gap: 20px;">
            <div
              v-for="player in groupedResults"
              :key="player.nickname"
              style="background: var(--bg-elevated); border-radius: var(--radius-lg); padding: 16px;"
            >
              <p class="nunito" style="font-weight: 800; font-size: 16px; color: var(--text-primary); margin-bottom: 10px;">
                {{ player.nickname }}
              </p>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div
                  v-for="ans in player.answers"
                  :key="ans.questionText"
                  :style="{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: ans.is_correct ? 'rgba(70,217,138,0.1)' : ans.is_correct === false ? 'rgba(255,90,90,0.1)' : 'var(--bg-card)',
                    border: '1px solid ' + (ans.is_correct ? 'rgba(70,217,138,0.3)' : ans.is_correct === false ? 'rgba(255,90,90,0.3)' : 'var(--border)')
                  }"
                >
                  <span style="font-size: 16px; flex-shrink: 0;">{{ ans.is_correct ? '✅' : ans.is_correct === false ? '❌' : '—' }}</span>
                  <div style="flex: 1;">
                    <p style="font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 13px; color: var(--text-secondary); margin-bottom: 2px;">{{ ans.questionText }}</p>
                    <p style="font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 14px; color: var(--text-primary);">
                      {{ ans.answer || '(sin respuesta)' }}
                    </p>
                  </div>
                  <span v-if="formatTime(ans.timeTakenMs)" style="font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0;">
                    {{ formatTime(ans.timeTakenMs) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p v-else style="color: var(--text-muted); font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 14px; text-align: center; padding: 20px 0;">
            No hay respuestas registradas.
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'
import { groupResultsByPlayer } from '../../lib/groupResults.js'

const route = useRoute()
const store = useQuizStore()
const quizId = route.params.id

const sessions = ref([])
const loadingList = ref(false)
const selectedPin = ref(null)
const loadingResults = ref(false)
const leaderboard = ref([])
const groupedResults = ref([])
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

async function openSession(session) {
  // Toggle off if the same session is clicked again.
  if (selectedPin.value === session.pin) {
    selectedPin.value = null
    return
  }
  selectedPin.value = session.pin
  loadingResults.value = true
  leaderboard.value = []
  groupedResults.value = []
  try {
    const data = await store.fetchSessionResults(session.pin)
    leaderboard.value = data.leaderboard ?? []
    groupedResults.value = groupResultsByPlayer(data.results ?? [])
  } catch (e) {
    errorMsg.value = `Error cargando resultados: ${e.message}`
    selectedPin.value = null
  } finally {
    loadingResults.value = false
  }
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

function formatTime(ms) {
  if (ms == null) return null
  return (ms / 1000).toFixed(1) + 's'
}

function rankClass(i) {
  if (i === 0) return 'rank-1'
  if (i === 1) return 'rank-2'
  if (i === 2) return 'rank-3'
  return 'rank-default'
}

function rankLabel(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`
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

.session-row-active {
  border-color: var(--accent-purple);
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

.session-detail {
  margin-top: 24px;
}
</style>
