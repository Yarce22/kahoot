<template>
  <div class="user-quizzes-view view-transition-enter">

    <!-- Header -->
    <div class="quiz-list-header">
      <h1 class="nunito quiz-list-title">Mis exámenes</h1>
      <button class="btn btn-ghost" style="font-size: 14px; padding: 8px 16px;" @click="logout">
        Cerrar sesión
      </button>
    </div>

    <p v-if="store.error" class="error-msg" role="alert">{{ store.error }}</p>

    <p v-if="store.loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando…
    </p>

    <div v-else class="quiz-grid">
      <div v-for="q in store.quizzes" :key="q.assignmentId" class="card quiz-card">
        <h2 class="quiz-card-title">{{ q.title }}</h2>
        <p v-if="q.description" class="quiz-card-meta">{{ q.description }}</p>

        <p v-if="q.attempt && q.attempt.status === 'completed'" class="quiz-score">
          {{ q.attempt.correctCount }}/{{ q.attempt.totalQuestions }} correctas ({{ q.attempt.scorePercent }}%)
        </p>

        <!-- 'expired': the cycle is over — only an admin reactivation creates
             a new attempt, so no action button, just a status badge. -->
        <span v-if="q.attempt && q.attempt.status === 'expired'" class="badge badge-orange">
          Vencido
        </span>
        <button v-else class="btn btn-primary" @click="go(q)">
          {{ actionLabel(q) }}
        </button>
      </div>
    </div>

    <p
      v-if="!store.loading && !store.quizzes.length"
      style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700; text-align: center; margin-top: 40px;"
    >
      No tenés exámenes asignados.
    </p>

    <!-- Pagination -->
    <div class="pagination">
      <button class="btn btn-ghost" :disabled="store.page <= 1" @click="goToPage(store.page - 1)">
        Anterior
      </button>
      <span class="pagination-info">Página {{ store.page }} de {{ totalPages }}</span>
      <button class="btn btn-ghost" :disabled="store.page * store.pageSize >= store.total" @click="goToPage(store.page + 1)">
        Siguiente
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserQuizzesStore } from '../../stores/userQuizzes.js'
import { useUserAuthStore } from '../../stores/userAuth.js'

const store = useUserQuizzesStore()
const auth = useUserAuthStore()
const router = useRouter()

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

onMounted(() => store.fetchQuizzes())

function goToPage(page) {
  store.fetchQuizzes({ page })
}

// actionLabel/go — the button's label and destination depend entirely on
// `attempt` (design decision): no attempt yet starts one, in_progress
// resumes it (same route either way — the start-attempt endpoint is
// idempotent), completed goes straight to the result. 'expired' never
// reaches here — the template shows a badge instead.
function actionLabel(q) {
  if (!q.attempt) return 'Comenzar'
  if (q.attempt.status === 'in_progress') return 'Continuar'
  if (q.attempt.status === 'completed') return 'Ver resultado'
  return 'Comenzar'
}

function go(q) {
  if (q.attempt && q.attempt.status === 'completed') {
    router.push(`/user/attempts/${q.attempt.id}/result`)
    return
  }
  router.push(`/user/quizzes/${q.assignmentId}/attempt`)
}

function logout() {
  auth.logout()
  router.push('/user/login')
}
</script>

<style scoped>
.user-quizzes-view {
  min-height: 100vh;
  padding: 32px 24px 40px;
  position: relative;
  z-index: 1;
}

.quiz-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
  flex-wrap: wrap;
  gap: 14px;
}

.quiz-list-title {
  font-weight: 900;
  font-size: 28px;
  color: var(--text-primary);
}

.quiz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
}

.quiz-card {
  padding: 24px;
}

.quiz-card-title {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 18px;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.quiz-card-meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.quiz-score {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: var(--accent-green);
  margin-bottom: 16px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
}

.pagination-info {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
