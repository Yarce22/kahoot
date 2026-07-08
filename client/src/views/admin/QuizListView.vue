<template>
  <div class="quiz-list-view view-transition-enter">
    <!-- Header -->
    <div class="quiz-list-header">
      <h1 class="quiz-list-title nunito">Mis Cuestionarios</h1>
    </div>

    <!-- Loading -->
    <p v-if="store.loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando…
    </p>

    <!-- Error -->
    <p v-if="store.error" class="error-msg">{{ store.error }}</p>
    <p v-if="startError" class="error-msg" role="alert">{{ startError }}</p>

    <!-- Quiz grid -->
    <div v-if="store.quizzes.length" class="quiz-grid">
      <div
        v-for="(quiz, idx) in store.quizzes"
        :key="quiz.id"
        class="card quiz-card"
        :style="{ animationDelay: (idx * 0.06) + 's' }"
      >
        <!-- Thumbnail -->
        <div
          class="quiz-card-thumb"
          :style="{ background: thumbGradient(idx) }"
        >
          <span style="font-size: 36px;">{{ thumbEmoji(idx) }}</span>
        </div>

        <h2 class="quiz-card-title">{{ quiz.title }}</h2>
        <p class="quiz-card-meta">
          {{ quiz.questions?.length ?? 0 }} pregunta(s)
        </p>

        <!-- Actions -->
        <div class="quiz-card-actions">
          <button class="btn-icon btn-host" @click="start(quiz)" :disabled="startingId === quiz.id">
            {{ startingId === quiz.id ? 'Iniciando…' : '▶ Iniciar' }}
          </button>
          <button class="btn-icon btn-edit" @click="router.push(`/admin/quizzes/${quiz.id}`)">
            ✏ Editar
          </button>
          <button class="btn-icon btn-history" @click="router.push(`/admin/quizzes/${quiz.id}/sessions`)">
            📊 Historial
          </button>
          <button class="btn-icon btn-delete" @click="remove(quiz.id)">
            🗑 Eliminar
          </button>
        </div>
      </div>
    </div>

    <p
      v-else-if="!store.loading"
      style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700; text-align: center; margin-top: 40px;"
    >
      Aún no hay cuestionarios. ¡Creá el primero!
    </p>

    <!-- FAB: New quiz -->
    <button
      class="fab"
      aria-label="Crear nuevo cuestionario"
      @click="router.push('/admin/quizzes/new')"
    >
      +
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'

const router = useRouter()
const store = useQuizStore()

const startingId = ref(null)
const startError = ref('')

onMounted(() => store.fetchQuizzes())

// start — create a live session for the quiz and go straight to the host
// panel (the lobby where players join by PIN), instead of the editor.
async function start(quiz) {
  if (startingId.value) return
  startingId.value = quiz.id
  startError.value = ''
  try {
    const { pin } = await store.createSession(quiz.id)
    router.push(`/admin/sessions/${pin}`)
  } catch (e) {
    startError.value = `No se pudo iniciar "${quiz.title}": ${e.message}`
  } finally {
    startingId.value = null
  }
}

async function remove(id) {
  if (!confirm('¿Eliminar este cuestionario?')) return
  await store.deleteQuiz(id)
}

const GRADIENTS = [
  'linear-gradient(135deg, #9b72f5, #6c3fd4)',
  'linear-gradient(135deg, #46d98a, #2bc47a)',
  'linear-gradient(135deg, #f5c842, #e8a000)',
  'linear-gradient(135deg, #f4634a, #e84a2f)',
  'linear-gradient(135deg, #3dcfcf, #1ab8b8)',
]
const EMOJIS = ['📝', '🌱', '📐', '📚', '🌍', '🧪', '🎨', '🚀']

function thumbGradient(idx) { return GRADIENTS[idx % GRADIENTS.length] }
function thumbEmoji(idx)    { return EMOJIS[idx % EMOJIS.length] }
</script>

<style scoped>
.quiz-list-view {
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

/* Quiz grid */
.quiz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
}

.quiz-card {
  padding: 24px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  animation: fadeSlideUp 0.4s ease both;
}

.quiz-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}

.quiz-card-thumb {
  height: 90px;
  border-radius: 14px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  position: relative;
  overflow: hidden;
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

.quiz-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  transition: all 0.15s;
}
.btn-icon:hover { filter: brightness(1.15); transform: translateY(-1px); }

.btn-host   { background: rgba(155, 114, 245, 0.2); color: var(--accent-purple); border: 1px solid rgba(155, 114, 245, 0.3); }
.btn-edit   { background: rgba(61, 207, 207, 0.15);  color: var(--accent-cyan);   border: 1px solid rgba(61, 207, 207, 0.25); }
.btn-history{ background: rgba(245, 200, 66, 0.15);  color: var(--accent-yellow); border: 1px solid rgba(245, 200, 66, 0.25); }
.btn-delete { background: rgba(244, 99, 74, 0.15);   color: var(--accent-coral);  border: 1px solid rgba(244, 99, 74, 0.25); }

/* Floating Action Button */
.fab {
  position: fixed;
  bottom: 28px;
  right: 28px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-purple), #7c50e8);
  border: none;
  cursor: pointer;
  font-size: 26px;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 20px rgba(155, 114, 245, 0.5);
  transition: transform 0.2s, box-shadow 0.2s;
  z-index: 50;
}
.fab:hover {
  transform: scale(1.12) rotate(15deg);
  box-shadow: 0 8px 28px rgba(155, 114, 245, 0.6);
}
</style>
