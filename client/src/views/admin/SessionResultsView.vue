<template>
  <div class="session-results-view view-transition-enter">

    <!-- Header -->
    <div class="results-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <router-link :to="`/admin/quizzes/${quizId}/sessions`" class="btn btn-ghost" style="font-size: 14px; padding: 8px 14px;">
          ← Volver al historial
        </router-link>
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary);">
          Resultados · PIN {{ pin }}
        </h1>
      </div>
    </div>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <p v-if="loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando resultados…
    </p>

    <template v-else-if="!errorMsg">
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
            <span class="player-name">{{ entry.nickname }}:</span>
            <span class="player-score"> {{ entry.score }} pts</span>
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
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'
import { groupResultsByPlayer } from '../../lib/groupResults.js'

const route = useRoute()
const store = useQuizStore()
const quizId = route.params.id
const pin = route.params.pin

const loading = ref(false)
const leaderboard = ref([])
const groupedResults = ref([])
const errorMsg = ref('')

onMounted(async () => {
  loading.value = true
  try {
    const data = await store.fetchSessionResults(pin)
    leaderboard.value = data.leaderboard ?? []
    groupedResults.value = groupResultsByPlayer(data.results ?? [])
  } catch (e) {
    errorMsg.value = `Error cargando resultados: ${e.message}`
  } finally {
    loading.value = false
  }
})

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
.session-results-view {
  min-height: 100vh;
  padding: 32px 24px 40px;
  position: relative;
  z-index: 1;
}

.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}
</style>
