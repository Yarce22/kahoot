<template>
  <div class="dash-view view-transition-enter">
    <div class="dash-header">
      <div>
        <h1 class="nunito dash-title">Mi avance</h1>
        <p v-if="profile" class="dash-sub">{{ profile.fullName }}<template v-if="profile.puntoDeVenta"> · {{ profile.puntoDeVenta }}</template></p>
      </div>
      <router-link to="/user/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 16px;">
        ← Volver a mis exámenes
      </router-link>
    </div>

    <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

    <p v-if="loading" class="dash-muted">Cargando…</p>

    <template v-else-if="progress">
      <p v-if="!quizzes.length" class="dash-muted dash-empty">No tenés exámenes asignados.</p>

      <template v-else>
        <section class="card hero">
          <ProgressRing :value="progress.completionPercent" label="Tu avance">
            <strong data-testid="percent">{{ progress.completionPercent }}%</strong><span>avance</span>
          </ProgressRing>
          <div class="hero-main">
            <p class="hero-big">
              <span data-testid="completed">{{ progress.completed }}/{{ progress.assigned }}</span> exámenes completados
            </p>
            <p class="hero-msg">{{ heroMsg }}</p>
            <div class="hero-stats">
              <div>
                <span>Promedio</span>
                <strong data-testid="average" :style="{ color: scoreColor(progress.averageScore) }">{{ pct(progress.averageScore) }}</strong>
              </div>
              <div>
                <span>Mejor puntaje</span>
                <strong>{{ best ? best.scorePercent + '%' : '—' }}</strong>
                <em v-if="best">{{ best.title }}</em>
              </div>
              <div>
                <span>Último completado</span>
                <strong>{{ last ? relDate(last.submittedAt) : '—' }}</strong>
                <em v-if="last">{{ last.title }}</em>
              </div>
            </div>
          </div>
        </section>

        <div class="status-tiles">
          <div v-for="k in STATUS_ORDER" :key="k" class="card stile" :style="{ '--c': STATUS_COLORS[k] }">
            <span class="stile-dot"></span><strong>{{ counts[k] }}</strong><span>{{ k }}</span>
          </div>
        </div>

        <div class="dash-charts">
          <section class="card chart-card">
            <div class="chart-head">
              <h2 class="chart-title">Por hacer</h2>
              <span class="chart-note">{{ todo.length }} pendientes</span>
            </div>
            <p v-if="!todo.length" class="dash-muted">No tenés exámenes pendientes.</p>
            <ul v-else class="todo">
              <li v-for="q in todo" :key="q.assignmentId">
                <div class="todo-main"><strong>{{ q.title }}</strong><StatusBadge :label="statusLabel(q)" /></div>
                <span v-if="statusLabel(q) === 'Vencido'" class="todo-note">Pedile a tu admin que lo reactive</span>
                <router-link v-else :to="`/user/quizzes/${q.assignmentId}/attempt`" class="btn btn-primary btn-xs">
                  {{ statusLabel(q) === 'En progreso' ? 'Continuar' : 'Comenzar' }}
                </router-link>
              </li>
            </ul>
          </section>

          <section class="card chart-card">
            <div class="chart-head">
              <h2 class="chart-title">Puntaje por examen</h2>
              <span v-if="progress.averageScore != null" class="chart-note">línea = tu promedio</span>
            </div>
            <p v-if="!completed.length" class="dash-muted">Todavía no completaste ningún examen.</p>
            <div v-else class="sbars">
              <div v-for="q in completed" :key="q.assignmentId" class="sbar-row">
                <span class="sbar-l" :title="q.title">{{ q.title }}</span>
                <div class="sbar-track" role="progressbar" :aria-label="'Puntaje de ' + q.title" :aria-valuenow="q.scorePercent" aria-valuemin="0" aria-valuemax="100">
                  <div class="sbar-fill" :style="{ width: q.scorePercent + '%', background: scoreColor(q.scorePercent) }"></div>
                  <div v-if="progress.averageScore != null" class="sbar-avg" :style="{ left: progress.averageScore + '%' }"></div>
                </div>
                <span class="sbar-v">{{ q.scorePercent }}%</span>
              </div>
            </div>
          </section>

          <section v-if="linePoints.length > 1" class="card chart-card chart-wide">
            <div class="chart-head">
              <h2 class="chart-title">Evolución de puntajes</h2>
              <span class="chart-note">por fecha de entrega</span>
            </div>
            <ScoreLine :points="linePoints" />
          </section>
        </div>

        <template v-if="history.length">
          <h2 class="chart-title" style="margin-bottom: 12px">Historial</h2>
          <div class="card utable">
            <div v-for="q in history" :key="q.assignmentId" class="hrow">
              <div class="u-name">
                <strong>{{ q.title }}</strong>
                <span>{{ q.submittedAt ? 'Entregado el ' + fullDate(q.submittedAt) : 'Completado' }}{{ q.cycle > 1 ? ` · ciclo ${q.cycle}` : '' }}</span>
              </div>
              <span :data-testid="'score-' + q.assignmentId"><ScorePill :value="q.scorePercent" /></span>
              <router-link
                v-if="q.attemptId"
                :to="`/user/attempts/${q.attemptId}/result`"
                class="btn btn-ghost"
                style="font-size: 13px; padding: 6px 12px;"
              >Ver resultado</router-link>
              <span v-else></span>
            </div>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useUserQuizzesStore } from '../../stores/userQuizzes.js'
import { useUserAuthStore } from '../../stores/userAuth.js'
import { STATUS_COLORS, STATUS_ORDER, fullDate, pct, relDate, scoreColor, statusCounts, statusLabel } from '../../lib/progress.js'
import ProgressRing from '../../components/dashboard/ProgressRing.vue'
import StatusBadge from '../../components/dashboard/StatusBadge.vue'
import ScorePill from '../../components/dashboard/ScorePill.vue'
import ScoreLine from '../../components/dashboard/ScoreLine.vue'
import '../../components/dashboard/dashboard.css'

const store = useUserQuizzesStore()
const profile = computed(() => useUserAuthStore().user)

const progress = ref(null)
const loading = ref(true)
const error = ref(null)

const quizzes = computed(() => progress.value?.quizzes ?? [])
const counts = computed(() => statusCounts(quizzes.value))
// Completed with a score, oldest first (drives the bars, the line and "último").
const completed = computed(() =>
  quizzes.value
    .filter((q) => q.attemptStatus === 'completed' && typeof q.scorePercent === 'number')
    .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
)
const best = computed(() => completed.value.reduce((a, b) => (!a || b.scorePercent > a.scorePercent ? b : a), null))
const last = computed(() => [...completed.value].reverse().find((q) => q.submittedAt) ?? null)
const todo = computed(() =>
  quizzes.value
    .filter((q) => q.status !== 'completed')
    .sort((a, b) => STATUS_ORDER.indexOf(statusLabel(a)) - STATUS_ORDER.indexOf(statusLabel(b)))
)
const history = computed(() =>
  quizzes.value
    .filter((q) => q.attemptStatus === 'completed' || q.status === 'completed')
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
)
const linePoints = computed(() =>
  completed.value.filter((q) => q.submittedAt).map((q) => ({ x: new Date(q.submittedAt), y: q.scorePercent, label: q.title }))
)
const heroMsg = computed(() => {
  const remaining = progress.value.assigned - progress.value.completed
  if (remaining <= 0) return 'Completaste todos tus exámenes asignados.'
  const expired = counts.value.Vencido
  return `Te ${remaining === 1 ? 'falta 1 examen' : `faltan ${remaining} exámenes`}${expired ? `, ${expired} vencido${expired > 1 ? 's' : ''}` : ''}.`
})

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
