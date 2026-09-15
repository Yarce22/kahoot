<template>
  <div class="quiz-list-view view-transition-enter">
    <!-- Header -->
    <div class="quiz-list-header">
      <h1 class="quiz-list-title nunito">{{ auth.isSuperadmin ? 'Todos los Cuestionarios' : 'Mis Cuestionarios' }}</h1>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <!-- Visible to every logged-in admin, unlike Administradores below —
             usuario management isn't superadmin-gated (it's store-scoped). -->
        <router-link to="/admin/users" class="btn btn-primary" style="font-size: 14px; padding: 8px 16px;">
          🧑‍🤝‍🧑 Usuarios
        </router-link>
        <router-link v-if="auth.isSuperadmin" to="/admin/admins" class="btn btn-primary" style="font-size: 14px; padding: 8px 16px;">
          👥 Administradores
        </router-link>
      </div>
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
          {{ quiz.questionCount ?? 0 }} pregunta(s)
          <span v-if="auth.isSuperadmin && quiz.owner"> · {{ quiz.owner.email }}</span>
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
          <button class="btn-icon btn-assign" @click="openAssign(quiz)">
            📌 Asignar
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

    <!-- Assign popup — inline markup, not a reusable component, same
         no-reusable-component precedent as AdminsView.vue's edit popup. -->
    <div v-if="assigningQuiz" class="assign-overlay" @click.self="closeAssign">
      <div class="card assign-popup">
        <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
          Asignar "{{ assigningQuiz.title }}"
        </h2>

        <!-- A quiz with no total_time_seconds would always 409 on assign —
             show guidance instead of a picker that can never succeed. No
             usuario fetch, no API call in this branch. -->
        <div v-if="!assigningQuiz.total_time_seconds">
          <p class="assign-guidance">
            Este cuestionario no tiene tiempo asíncrono configurado — abrí
            <router-link :to="`/admin/quizzes/${assigningQuiz.id}`" @click="closeAssign">Editar</router-link>
            para asignarle uno.
          </p>
          <div class="assign-actions">
            <button type="button" class="btn btn-ghost" @click="closeAssign">Cerrar</button>
          </div>
        </div>

        <template v-else>
          <select
            v-if="auth.isSuperadmin"
            id="assign-store-select"
            v-model="assignStoreFilter"
            class="input-sm"
            style="margin-bottom: 12px; width: 100%;"
            @change="loadAssignableUsers"
          >
            <option value="">Todos los puntos de venta</option>
            <option v-for="p in PUNTOS_DE_VENTA" :key="p" :value="p">{{ p }}</option>
          </select>

          <p v-if="usersStore.loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
            Cargando usuarios…
          </p>
          <p v-else-if="!usersStore.users.length" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
            No hay usuarios activos para asignar.
          </p>
          <div v-else class="assign-user-list">
            <label v-for="u in usersStore.users" :key="u.id" class="assign-user-row">
              <input type="checkbox" :value="u.id" v-model="selectedUserIds" />
              <span class="assign-user-name">{{ u.full_name }}</span>
              <span class="assign-user-email">{{ u.email }}</span>
            </label>
          </div>

          <p v-if="assignError" class="error-msg" role="alert">{{ assignError }}</p>
          <p v-if="assignResult" class="assign-result">
            {{ assignResult.created.length }} asignado(s){{ assignResult.skipped.length ? `, ${assignResult.skipped.length} ya estaba(n) asignado(s)` : '' }}.
          </p>

          <div class="assign-actions">
            <button type="button" class="btn btn-ghost" @click="closeAssign">Cerrar</button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="assigning || !selectedUserIds.length"
              @click="submitAssign"
            >
              {{ assigning ? 'Asignando…' : 'Asignar seleccionados' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'
import { useAuthStore } from '../../stores/auth.js'
import { useUsersStore } from '../../stores/users.js'
import { useAssignmentsStore } from '../../stores/assignments.js'
import { PUNTOS_DE_VENTA } from '../../lib/puntosDeVenta.js'

const router = useRouter()
const store = useQuizStore()
const auth = useAuthStore()
const usersStore = useUsersStore()
const assignmentsStore = useAssignmentsStore()

const startingId = ref(null)
const startError = ref('')

const assigningQuiz = ref(null)
const assignStoreFilter = ref('')
const selectedUserIds = ref([])
const assignResult = ref(null)
const assignError = ref('')
const assigning = ref(false)

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

// openAssign — no pre-fetch of existing assignments (design decision): the
// picker just shows active, store-scoped usuarios; POST /api/assignments'
// { created, skipped } response tells the admin what actually happened.
// A quiz with no total_time_seconds would always 409, so that case shows
// guidance only — no usuario fetch, no API call.
function openAssign(quiz) {
  assigningQuiz.value = quiz
  assignStoreFilter.value = ''
  selectedUserIds.value = []
  assignResult.value = null
  assignError.value = ''
  if (quiz.total_time_seconds) loadAssignableUsers()
}

function closeAssign() {
  assigningQuiz.value = null
}

function loadAssignableUsers() {
  // page_size: 100 — matches both GET /api/users' MAX_PAGE_SIZE and
  // POST /api/assignments' own user_ids cap, so the picker can show every
  // usuario a single assignment request could ever cover, not just the
  // default first-25 page with no way to reach the rest.
  const params = { is_active: true, page_size: 100 }
  if (auth.isSuperadmin && assignStoreFilter.value) params.punto_de_venta = assignStoreFilter.value
  usersStore.fetchUsers(params)
}

async function submitAssign() {
  if (!assigningQuiz.value || !selectedUserIds.value.length) return
  assigning.value = true
  assignError.value = ''
  try {
    assignResult.value = await assignmentsStore.createAssignments({
      quiz_id: assigningQuiz.value.id,
      user_ids: selectedUserIds.value
    })
    // Leave the popup open (design decision) so the admin can read the
    // created/skipped result before closing it manually.
  } catch (e) {
    assignError.value = e.message
  } finally {
    assigning.value = false
  }
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
.btn-assign { background: rgba(70, 217, 138, 0.15);  color: var(--accent-green);  border: 1px solid rgba(70, 217, 138, 0.25); }
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

/* Assign popup */
.assign-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  padding: 20px;
}

.assign-popup {
  width: 100%;
  max-width: 460px;
  padding: 24px;
  max-height: 80vh;
  overflow-y: auto;
}

.assign-guidance {
  color: var(--text-secondary);
  font-family: 'Nunito', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.assign-user-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.assign-user-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-elevated);
  cursor: pointer;
  font-family: 'Nunito', sans-serif;
}

.assign-user-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary);
}

.assign-user-email {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-secondary);
}

.assign-result {
  color: var(--accent-green);
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 14px;
  margin: 8px 0;
}

.assign-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
