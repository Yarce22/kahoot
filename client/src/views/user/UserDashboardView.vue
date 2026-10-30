<template>
  <div class="user-dashboard-view view-transition-enter">
    <div class="dash-header">
      <h1 class="nunito dash-title">Mi avance</h1>
      <router-link to="/user/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 16px;">
        ← Volver a mis exámenes
      </router-link>
    </div>

    <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

    <p v-if="loading" class="dash-muted">Cargando…</p>

    <template v-else-if="progress">
      <div class="card dash-summary">
        <p class="dash-big">
          <span data-testid="completed">{{ progress.completed }}/{{ progress.assigned }}</span>
          <span class="dash-muted"> completados</span>
        </p>
        <div
          class="bar"
          role="progressbar"
          aria-label="Avance"
          :aria-valuenow="progress.completionPercent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="bar-fill" :style="{ width: progress.completionPercent + '%' }"></div>
        </div>
        <p class="dash-muted">
          Avance: <strong data-testid="percent">{{ pct(progress.completionPercent) }}</strong>
          · Promedio: <strong data-testid="average">{{ pct(progress.averageScore) }}</strong>
        </p>
      </div>

      <p v-if="!progress.quizzes.length" class="dash-muted dash-empty">No tenés exámenes asignados.</p>

      <ul v-else class="dash-list">
        <li v-for="q in progress.quizzes" :key="q.assignmentId" class="card dash-row">
          <span class="dash-row-title">{{ q.title }}</span>
          <span class="badge">{{ statusLabel(q) }}</span>
          <span :data-testid="'score-' + q.assignmentId" class="dash-score">{{ pct(q.scorePercent) }}</span>
          <router-link
            v-if="q.attemptStatus === 'completed' && q.attemptId"
            :to="`/user/attempts/${q.attemptId}/result`"
            class="btn btn-ghost"
            style="font-size: 13px; padding: 6px 12px;"
          >
            Ver resultado
          </router-link>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useUserQuizzesStore } from '../../stores/userQuizzes.js'
import { pct, statusLabel } from '../../lib/progress.js'

const store = useUserQuizzesStore()
const progress = ref(null)
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    progress.value = await store.fetchProgress()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.user-dashboard-view { min-height: 100vh; padding: 32px 24px 40px; position: relative; z-index: 1; }
.dash-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 14px; }
.dash-title { font-weight: 900; font-size: 28px; color: var(--text-primary); }
.dash-muted { color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700; }
.dash-empty { text-align: center; margin-top: 40px; }
.dash-summary { padding: 24px; margin-bottom: 24px; }
.dash-big { font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 28px; color: var(--text-primary); margin-bottom: 12px; }
.bar { height: 12px; border-radius: var(--radius-md); background: var(--bg-elevated); overflow: hidden; margin-bottom: 12px; }
.bar-fill { height: 100%; background: var(--accent-green); }
.dash-list { list-style: none; padding: 0; display: grid; gap: 12px; }
.dash-row { display: flex; align-items: center; gap: 14px; padding: 16px 20px; flex-wrap: wrap; }
.dash-row-title { flex: 1; min-width: 160px; font-family: 'Nunito', sans-serif; font-weight: 800; color: var(--text-primary); }
.dash-score { font-family: 'Nunito', sans-serif; font-weight: 700; color: var(--accent-green); min-width: 48px; text-align: right; }
</style>
