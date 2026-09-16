<template>
  <div class="attempt-result-view view-transition-enter">

    <!-- Header -->
    <div class="results-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <router-link :to="`/admin/quizzes/${quizId}/sessions`" class="btn btn-ghost" style="font-size: 14px; padding: 8px 14px;">
          ← Volver al historial
        </router-link>
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary);">
          Examen asignado
        </h1>
      </div>
    </div>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <p v-if="loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando…
    </p>

    <template v-else-if="!errorMsg && attempt">
      <div class="card" style="padding: 24px; margin-bottom: 20px;">
        <p class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 4px;">
          {{ attempt.user?.fullName ?? 'Usuario desconocido' }}
        </p>
        <p style="font-family: 'Nunito', sans-serif; font-weight: 600; font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
          {{ attempt.user?.email }} · {{ attempt.user?.puntoDeVenta }}
        </p>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <span class="badge" :class="statusBadgeClass">{{ statusLabel }}</span>
          <span v-if="attempt.status !== 'in_progress'" class="score-line">
            {{ attempt.correctCount }}/{{ attempt.totalQuestions }} correctas ({{ attempt.scorePercent }}%)
          </span>
        </div>
        <p v-if="attempt.submittedAt" class="submitted-line">
          Entregado el {{ formatDate(attempt.submittedAt) }}
        </p>
      </div>

      <!-- Answers — includes the correct-answer text, unlike the usuario's
           own result view (design D5: admins may see it, same contract as
           GET /api/sessions/:pin/results). -->
      <div class="card" style="padding: 24px;">
        <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
          Respuestas
        </h2>
        <div v-if="attempt.answers.length" style="display: flex; flex-direction: column; gap: 8px;">
          <div
            v-for="ans in attempt.answers"
            :key="ans.questionId"
            :style="{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: ans.isCorrect ? 'rgba(70,217,138,0.1)' : ans.isCorrect === false ? 'rgba(255,90,90,0.1)' : 'var(--bg-elevated)',
              border: '1px solid ' + (ans.isCorrect ? 'rgba(70,217,138,0.3)' : ans.isCorrect === false ? 'rgba(255,90,90,0.3)' : 'var(--border)')
            }"
          >
            <span style="font-size: 16px; flex-shrink: 0;">{{ ans.isCorrect ? '✅' : ans.isCorrect === false ? '❌' : '—' }}</span>
            <div style="flex: 1;">
              <p class="answer-question">{{ ans.questionText }}</p>
              <p class="answer-text">{{ ans.answerText || '(sin respuesta)' }}</p>
              <p v-if="ans.isCorrect === false && ans.correctAnswer" class="answer-correct">
                Correcta: {{ ans.correctAnswer }}
              </p>
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
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAttemptsStore } from '../../stores/attempts.js'

const route = useRoute()
const store = useAttemptsStore()
const quizId = route.params.id
const attemptId = route.params.attemptId

const loading = ref(false)
const attempt = ref(null)
const errorMsg = ref('')

const STATUS_LABELS = { in_progress: 'En curso', completed: 'Completado', expired: 'Vencido' }
const STATUS_BADGES = { in_progress: 'badge-blue', completed: 'badge-green', expired: 'badge-orange' }

const statusLabel = computed(() => STATUS_LABELS[attempt.value?.status] ?? attempt.value?.status)
const statusBadgeClass = computed(() => STATUS_BADGES[attempt.value?.status] ?? 'badge-blue')

onMounted(async () => {
  loading.value = true
  try {
    attempt.value = await store.fetchAttempt(attemptId)
  } catch (e) {
    errorMsg.value = `Error cargando el examen: ${e.message}`
  } finally {
    loading.value = false
  }
})

function formatDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Fecha desconocida'
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
</script>

<style scoped>
.attempt-result-view {
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

.score-line {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 14px;
  color: var(--accent-green);
}

.submitted-line {
  font-family: 'Nunito', sans-serif;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 10px;
}

.answer-question {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.answer-text {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary);
}

.answer-correct {
  font-family: 'Nunito', sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: var(--accent-green);
  margin-top: 4px;
}
</style>
