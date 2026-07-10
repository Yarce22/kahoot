<template>
  <div class="quiz-editor-view view-transition-enter">

    <!-- Header -->
    <div class="editor-header">
      <button class="btn btn-ghost btn-sm" @click="router.back()">← Volver</button>
      <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary); flex: 1;">
        {{ isNew ? 'Nuevo Cuestionario' : 'Editar Cuestionario' }}
      </h1>
    </div>

    <!-- Quiz metadata -->
    <div class="card quiz-meta-panel">
      <form @submit.prevent="saveQuiz" class="meta-fields">
        <div class="field-group">
          <label class="field-label-sm" for="quiz-title">Título</label>
          <input
            id="quiz-title"
            v-model="form.title"
            class="input-sm"
            required
            placeholder="Título del cuestionario"
          />
        </div>
        <div class="field-group">
          <label class="field-label-sm" for="quiz-desc">Descripción</label>
          <input
            id="quiz-desc"
            v-model="form.description"
            class="input-sm"
            placeholder="Descripción opcional"
          />
        </div>
        <div style="grid-column: 1 / -1; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button type="submit" class="btn btn-primary btn-sm" :disabled="saving">
            {{ saving ? 'Guardando…' : 'Guardar cuestionario' }}
          </button>
          <p v-if="quizError" class="error-msg" style="margin: 0;">{{ quizError }}</p>
        </div>
      </form>
    </div>

    <template v-if="quizId">
      <!-- Questions list -->
      <h2 class="nunito" style="font-size: 20px; font-weight: 800; color: var(--text-primary); margin-bottom: 12px;">
        Preguntas
      </h2>
      <p v-if="store.loading" style="color: var(--text-secondary);">Cargando…</p>

      <div class="question-cards">
        <div
          v-for="(q, qi) in questions"
          :key="q.id"
          class="card q-card"
        >
          <template v-if="editingQuestionId !== q.id">
            <div class="q-index">{{ qi + 1 }}</div>
            <div class="q-content">
              <p class="q-text">{{ q.text }}</p>
              <div class="q-actions">
                <span :class="['badge', typeBadgeClass(q.type)]">{{ typeLabel(q.type) }}</span>
                <span class="badge badge-orange">{{ q.time_limit_seconds }}s</span>
              </div>

              <!-- Options for closed / multiple questions -->
              <ul v-if="q.type === 'closed' || q.type === 'multiple'" class="options-list">
                <li v-for="opt in (q.options || [])" :key="opt.id" class="option-row">
                  <input
                    type="checkbox"
                    :checked="opt.is_correct"
                    @change="toggleOption(opt, q.id)"
                  />
                  <span :style="opt.is_correct ? 'color: var(--accent-green); font-weight: 700;' : ''">{{ opt.text }}</span>
                  <button class="btn-icon btn-delete" style="padding: 4px 8px; font-size: 12px;" @click="removeOption(opt.id, q.id)">✕</button>
                </li>
                <li>
                  <form @submit.prevent="addOption(q)" style="display: flex; gap: 8px; margin-top: 8px;">
                    <input v-model="newOptionText[q.id]" class="input-sm" style="flex: 1;" placeholder="Nueva opción" />
                    <button type="submit" class="btn-icon btn-edit">+ Agregar</button>
                  </form>
                </li>
              </ul>

              <p v-else-if="q.type === 'true_false'" class="correct-answer-note">
                Correcto: <strong>{{ (q.options || []).find(o => o.is_correct)?.text ?? '—' }}</strong>
              </p>
              <p v-else-if="q.type === 'open'" class="correct-answer-note">
                Palabras clave: <strong>{{ (q.options || []).find(o => o.is_correct)?.text ?? '—' }}</strong>
              </p>

              <!-- Question actions -->
              <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button class="btn-icon btn-edit" @click="startEditQuestion(q)">✏ Editar</button>
                <button class="btn-icon btn-delete" @click="removeQuestion(q.id)">🗑 Eliminar</button>
              </div>
            </div>
          </template>

          <!-- Inline edit form -->
          <template v-else>
            <form @submit.prevent="saveQuestion(q.id)" style="width: 100%;">
              <div class="meta-fields" style="margin-bottom: 12px;">
                <div class="field-group">
                  <label class="field-label-sm">Texto de la pregunta</label>
                  <input v-model="editQuestionForm.text" class="input-sm" placeholder="Texto de la pregunta" required />
                </div>
                <div class="field-group">
                  <label class="field-label-sm">Tipo</label>
                  <select v-model="editQuestionForm.type" class="input-sm">
                    <option value="closed">Opción múltiple</option>
                    <option value="multiple">Varias correctas</option>
                    <option value="true_false">Verdadero / Falso</option>
                    <option value="open">Respuesta abierta</option>
                  </select>
                </div>
                <div class="field-group">
                  <label class="field-label-sm">Límite de tiempo (seg)</label>
                  <input v-model.number="editQuestionForm.time_limit_seconds" class="input-sm" type="number" min="5" max="120" />
                </div>

                <template v-if="editQuestionForm.type === 'true_false'">
                  <div class="field-group" style="grid-column: 1 / -1;">
                    <label class="field-label-sm">Respuesta correcta</label>
                    <div style="display: flex; gap: 16px;">
                      <label style="display: flex; align-items: center; gap: 6px; color: var(--text-primary); font-family: 'Nunito', sans-serif; font-weight: 700;">
                        <input type="radio" v-model="editTfCorrect" value="true" /> Verdadero
                      </label>
                      <label style="display: flex; align-items: center; gap: 6px; color: var(--text-primary); font-family: 'Nunito', sans-serif; font-weight: 700;">
                        <input type="radio" v-model="editTfCorrect" value="false" /> Falso
                      </label>
                    </div>
                  </div>
                </template>

                <template v-else-if="editQuestionForm.type === 'open'">
                  <div class="field-group" style="grid-column: 1 / -1;">
                    <label class="field-label-sm">Palabras clave (separadas por coma)</label>
                    <input v-model="editOpenCorrect" class="input-sm" placeholder="200, guisantes, tomate cherry, stracciatella" required />
                  </div>
                </template>
              </div>

              <div style="display: flex; gap: 8px;">
                <button type="submit" class="btn-icon btn-host">✓ Guardar</button>
                <button type="button" class="btn-icon btn-delete" @click="editingQuestionId = null">✕ Cancelar</button>
              </div>
            </form>
          </template>
        </div>
      </div>

      <!-- Add question panel -->
      <div class="card add-question-panel">
        <h3 class="add-q-title">Agregar Pregunta</h3>

        <!-- Question type selector -->
        <div class="type-select">
          <button
            type="button"
            :class="['type-btn', newQuestion.type === 'closed' ? 'active-blue' : '']"
            @click="newQuestion.type = 'closed'"
          >Opción múltiple</button>
          <button
            type="button"
            :class="['type-btn', newQuestion.type === 'multiple' ? 'active-purple' : '']"
            @click="newQuestion.type = 'multiple'"
          >Varias correctas</button>
          <button
            type="button"
            :class="['type-btn', newQuestion.type === 'true_false' ? 'active-green' : '']"
            @click="newQuestion.type = 'true_false'"
          >Verdadero / Falso</button>
          <button
            type="button"
            :class="['type-btn', newQuestion.type === 'open' ? 'active-orange' : '']"
            @click="newQuestion.type = 'open'"
          >Respuesta abierta</button>
        </div>

        <form @submit.prevent="addQuestion">
          <div class="meta-fields" style="margin-bottom: 16px;">
            <div class="field-group" style="grid-column: 1 / -1;">
              <label class="field-label-sm">Texto de la pregunta</label>
              <input v-model="newQuestion.text" class="input-sm" placeholder="¿Cuál es la pregunta?" required />
            </div>
            <div class="field-group">
              <label class="field-label-sm">Tiempo límite (seg)</label>
              <input v-model.number="newQuestion.time_limit_seconds" class="input-sm" type="number" min="5" max="120" />
            </div>
          </div>

          <!-- Closed: draft options -->
          <template v-if="newQuestion.type === 'closed'">
            <div style="margin-bottom: 12px;">
              <label class="field-label-sm" style="margin-bottom: 8px; display: block;">Opciones de respuesta</label>
              <div v-for="(opt, idx) in newOptions" :key="idx" class="option-row" style="margin-bottom: 6px;">
                <input
                  type="radio"
                  :checked="opt.is_correct"
                  @change="setCorrectOption(idx)"
                  name="new-correct-option"
                />
                <span :style="opt.is_correct ? 'color: var(--accent-green); font-weight: 700;' : 'color: var(--text-primary);'">{{ opt.text }}</span>
                <button type="button" class="btn-icon btn-delete" style="padding: 4px 8px; font-size: 12px;" @click="removeNewOption(idx)">✕</button>
              </div>
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <input v-model="newOptionInput" class="input-sm" style="flex: 1;" placeholder="Texto de la opción" @keydown.enter.prevent="addNewOption" />
                <button type="button" class="btn-icon btn-edit" @click="addNewOption">+ Agregar opción</button>
              </div>
              <p v-if="newOptions.length < 2" style="color: var(--text-muted); font-size: 12px; margin-top: 6px; font-family: 'Nunito', sans-serif;">
                Agregá al menos 2 opciones
              </p>
            </div>
          </template>

          <!-- Multiple: draft options with several correct -->
          <template v-else-if="newQuestion.type === 'multiple'">
            <div style="margin-bottom: 12px;">
              <label class="field-label-sm" style="margin-bottom: 8px; display: block;">Opciones (marcá todas las correctas)</label>
              <div v-for="(opt, idx) in newOptions" :key="idx" class="option-row" style="margin-bottom: 6px;">
                <input
                  type="checkbox"
                  :checked="opt.is_correct"
                  @change="toggleNewOptionCorrect(idx)"
                />
                <span :style="opt.is_correct ? 'color: var(--accent-green); font-weight: 700;' : 'color: var(--text-primary);'">{{ opt.text }}</span>
                <button type="button" class="btn-icon btn-delete" style="padding: 4px 8px; font-size: 12px;" @click="removeNewOption(idx)">✕</button>
              </div>
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <input v-model="newOptionInput" class="input-sm" style="flex: 1;" placeholder="Texto de la opción" @keydown.enter.prevent="addNewOption" />
                <button type="button" class="btn-icon btn-edit" @click="addNewOption">+ Agregar opción</button>
              </div>
              <p v-if="newOptions.length < 2" style="color: var(--text-muted); font-size: 12px; margin-top: 6px; font-family: 'Nunito', sans-serif;">
                Agregá al menos 2 opciones
              </p>
              <p v-else-if="!newOptions.some(o => o.is_correct)" style="color: var(--text-muted); font-size: 12px; margin-top: 6px; font-family: 'Nunito', sans-serif;">
                Marcá al menos una opción correcta
              </p>
            </div>
          </template>

          <!-- True/False: correct answer -->
          <template v-else-if="newQuestion.type === 'true_false'">
            <div style="margin-bottom: 12px;">
              <label class="field-label-sm" style="margin-bottom: 8px; display: block;">Respuesta correcta</label>
              <div style="display: flex; gap: 16px;">
                <label style="display: flex; align-items: center; gap: 6px; color: var(--text-primary); font-family: 'Nunito', sans-serif; font-weight: 700;">
                  <input type="radio" v-model="newTfCorrect" value="true" /> Verdadero
                </label>
                <label style="display: flex; align-items: center; gap: 6px; color: var(--text-primary); font-family: 'Nunito', sans-serif; font-weight: 700;">
                  <input type="radio" v-model="newTfCorrect" value="false" /> Falso
                </label>
              </div>
            </div>
          </template>

          <!-- Open: required keywords -->
          <template v-else-if="newQuestion.type === 'open'">
            <div style="margin-bottom: 12px;">
              <label class="field-label-sm" for="new-open-correct" style="margin-bottom: 8px; display: block;">Palabras clave (separadas por coma)</label>
              <input
                id="new-open-correct"
                v-model="newOpenCorrect"
                class="input-sm"
                placeholder="ej. 200, guisantes, tomate cherry, stracciatella"
                required
              />
              <p style="color: var(--text-muted); font-size: 12px; margin-top: 6px; font-family: 'Nunito', sans-serif;">
                Ingresá solo los términos que la respuesta DEBE contener (no la respuesta completa), separados por coma. Es correcta si los contiene todos, en cualquier orden (ignora mayúsculas y acentos).
              </p>
            </div>
          </template>

          <button
            type="submit"
            class="btn btn-primary btn-sm"
            :disabled="
              (newQuestion.type === 'closed' && newOptions.length < 2) ||
              (newQuestion.type === 'multiple' && (newOptions.length < 2 || !newOptions.some(o => o.is_correct)))
            "
          >
            Agregar pregunta
          </button>
        </form>
      </div>

      <!-- Session launcher -->
      <div class="card session-launcher-panel">
        <h2 class="nunito" style="font-weight: 900; font-size: 20px; color: var(--text-primary); margin-bottom: 16px;">
          Iniciar una Partida
        </h2>
        <button class="btn btn-green" @click="createSession" :disabled="creatingSession">
          {{ creatingSession ? 'Creando sesión…' : '▶ Crear Sesión' }}
        </button>
        <p v-if="sessionPin" style="margin-top: 16px;">
          <span style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-size: 14px;">PIN generado:</span>
          <strong style="font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 28px; color: var(--accent-yellow); margin-left: 10px; letter-spacing: 4px;">
            {{ sessionPin }}
          </strong>
          <router-link
            :to="`/admin/sessions/${sessionPin}`"
            class="btn btn-primary btn-sm"
            style="margin-left: 14px; text-decoration: none;"
          >
            Abrir Sesión →
          </router-link>
        </p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'
import { useAdminApi } from '../../composables/useAdminApi.js'

const route = useRoute()
const router = useRouter()
const store = useQuizStore()
const api = useAdminApi()

const quizId = ref(route.params.id || null)
// isNew is derived from quizId, not the initial route param. This route uses
// no <RouterView :key>, so after saveQuiz creates a quiz and sets quizId, the
// same reused component instance must switch from create to update — a static
// isNew would stay true and create a duplicate on the next save.
const isNew = computed(() => !quizId.value)

const form = ref({ title: '', description: '' })
const saving = ref(false)
const quizError = ref('')

const questions = ref([])
const editingQuestionId = ref(null)
const editQuestionForm = ref({ text: '', type: 'closed', time_limit_seconds: 30 })
const newQuestion = ref({ text: '', type: 'closed', time_limit_seconds: 30 })
const newOptionText = ref({})
const newOptions = ref([])
const newOptionInput = ref('')
const newTfCorrect = ref('true')
const newOpenCorrect = ref('')
const editTfCorrect = ref('true')
const editOpenCorrect = ref('')
const creatingSession = ref(false)
const sessionPin = ref('')

onMounted(async () => {
  if (!isNew.value) {
    await store.fetchQuiz(quizId.value)
    if (store.activeQuiz) {
      form.value.title = store.activeQuiz.title
      form.value.description = store.activeQuiz.description || ''
      questions.value = store.activeQuiz.questions || []
    }
  }
})

async function saveQuiz() {
  saving.value = true
  quizError.value = ''
  try {
    if (isNew.value) {
      const quiz = await store.createQuiz(form.value)
      quizId.value = quiz.id
      router.replace(`/admin/quizzes/${quiz.id}`)
    } else {
      await store.updateQuiz(quizId.value, form.value)
    }
  } catch (e) {
    quizError.value = e.message
  } finally {
    saving.value = false
  }
}

function addNewOption() {
  const text = newOptionInput.value.trim()
  if (!text) return
  newOptions.value.push({ text, is_correct: newOptions.value.length === 0 })
  newOptionInput.value = ''
}

function removeNewOption(idx) {
  const wasCorrect = newOptions.value[idx].is_correct
  newOptions.value.splice(idx, 1)
  if (wasCorrect && newOptions.value.length > 0) newOptions.value[0].is_correct = true
}

function setCorrectOption(idx) {
  newOptions.value.forEach((o, i) => { o.is_correct = i === idx })
}

// 'multiple' allows several correct options, so each checkbox toggles
// independently instead of moving a single radio selection.
function toggleNewOptionCorrect(idx) {
  newOptions.value[idx].is_correct = !newOptions.value[idx].is_correct
}

async function addQuestion() {
  const payload = { ...newQuestion.value }
  if (payload.type === 'closed' || payload.type === 'multiple') {
    payload.options = newOptions.value.map(o => ({ text: o.text, is_correct: o.is_correct }))
  } else if (payload.type === 'true_false') {
    payload.correct_answer = newTfCorrect.value
  } else if (payload.type === 'open' && newOpenCorrect.value.trim()) {
    payload.correct_answer = newOpenCorrect.value.trim()
  }
  await store.createQuestion(quizId.value, payload)
  await store.fetchQuiz(quizId.value)
  questions.value = store.activeQuiz?.questions || []
  newQuestion.value = { text: '', type: 'closed', time_limit_seconds: 30 }
  newOptions.value = []
  newOptionInput.value = ''
  newTfCorrect.value = 'true'
  newOpenCorrect.value = ''
}

function startEditQuestion(q) {
  editingQuestionId.value = q.id
  editQuestionForm.value = { text: q.text, type: q.type, time_limit_seconds: q.time_limit_seconds }
  const correctOpt = (q.options || []).find(o => o.is_correct)
  editTfCorrect.value = q.type === 'true_false' ? (correctOpt?.text?.toLowerCase() ?? 'true') : 'true'
  editOpenCorrect.value = q.type === 'open' ? (correctOpt?.text ?? '') : ''
}

async function saveQuestion(id) {
  const payload = { ...editQuestionForm.value }
  if (payload.type === 'true_false') payload.correct_answer = editTfCorrect.value
  else if (payload.type === 'open') payload.correct_answer = editOpenCorrect.value.trim()
  await store.updateQuestion(id, payload)
  await store.fetchQuiz(quizId.value)
  questions.value = store.activeQuiz?.questions || []
  editingQuestionId.value = null
}

async function removeQuestion(id) {
  if (!confirm('¿Eliminar esta pregunta?')) return
  await store.deleteQuestion(id)
  questions.value = questions.value.filter(q => q.id !== id)
}

async function addOption(question) {
  const text = (newOptionText.value[question.id] || '').trim()
  if (!text) return
  const opt = await store.createOption(question.id, { text, is_correct: false })
  question.options = [...(question.options || []), opt]
  newOptionText.value[question.id] = ''
}

async function toggleOption(opt, questionId) {
  await store.updateOption(opt.id, questionId, { text: opt.text, is_correct: !opt.is_correct })
  opt.is_correct = !opt.is_correct
}

async function removeOption(id, questionId) {
  await store.deleteOption(id, questionId)
  const q = questions.value.find(x => x.id === questionId)
  if (q) q.options = q.options.filter(o => o.id !== id)
}

async function createSession() {
  creatingSession.value = true
  quizError.value = ''
  try {
    const res = await api.post('/api/sessions', { quizId: quizId.value })
    sessionPin.value = res.pin
  } catch (e) {
    quizError.value = e.message
  } finally {
    creatingSession.value = false
  }
}

function typeLabel(type) {
  if (type === 'closed') return 'Múltiple'
  if (type === 'multiple') return 'Varias correctas'
  if (type === 'true_false') return 'V/F'
  return 'Abierta'
}

function typeBadgeClass(type) {
  if (type === 'closed') return 'badge-blue'
  if (type === 'multiple') return 'badge-purple'
  if (type === 'true_false') return 'badge-green'
  return 'badge-orange'
}
</script>

<style scoped>
.quiz-editor-view {
  min-height: 100vh;
  padding: 24px 24px 80px;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
}

.editor-header {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.quiz-meta-panel {
  padding: 24px;
}

.meta-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label-sm {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

/* Question cards */
.question-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.q-card {
  padding: 18px 20px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  animation: fadeSlideUp 0.3s ease both;
  cursor: pointer;
  transition: border-color 0.2s;
}
.q-card:hover { border-color: var(--accent-purple); }

.q-index {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 14px;
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 2px;
}

.q-content { flex: 1; }

.q-text {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.q-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.options-list {
  list-style: none;
  padding: 0;
  margin: 8px 0;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  color: var(--text-primary);
  font-family: 'Nunito', sans-serif;
  font-size: 14px;
}

.correct-answer-note {
  color: var(--text-secondary);
  font-family: 'Nunito', sans-serif;
  font-size: 14px;
  margin-top: 8px;
}

/* Add question panel */
.add-question-panel {
  padding: 22px 24px;
}

.add-q-title {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 17px;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.type-select {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.type-btn {
  padding: 8px 16px;
  border-radius: var(--radius-full);
  border: 2px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.type-btn.active-blue   { border-color: var(--accent-cyan);   color: var(--accent-cyan);   background: rgba(61, 207, 207, 0.1); }
.type-btn.active-green  { border-color: var(--accent-green);  color: var(--accent-green);  background: rgba(70, 217, 138, 0.1); }
.type-btn.active-orange { border-color: var(--accent-yellow); color: var(--accent-yellow); background: rgba(245, 200, 66, 0.1); }
.type-btn.active-purple { border-color: var(--accent-purple); color: var(--accent-purple); background: rgba(155, 114, 245, 0.1); }

/* Action icon buttons */
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
.btn-delete { background: rgba(244, 99, 74, 0.15);   color: var(--accent-coral);  border: 1px solid rgba(244, 99, 74, 0.25); }

/* Session launcher */
.session-launcher-panel {
  padding: 24px;
}

@media (max-width: 600px) {
  .meta-fields { grid-template-columns: 1fr; }
}
</style>
