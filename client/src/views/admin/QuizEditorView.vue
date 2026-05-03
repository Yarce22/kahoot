<template>
  <div class="quiz-editor">
    <h1>{{ isNew ? 'New Quiz' : 'Edit Quiz' }}</h1>

    <form @submit.prevent="saveQuiz" class="quiz-form">
      <label>
        Title
        <input v-model="form.title" required placeholder="Quiz title" />
      </label>
      <label>
        Description
        <input v-model="form.description" placeholder="Optional description" />
      </label>
      <button type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save Quiz' }}</button>
      <p v-if="quizError" class="error">{{ quizError }}</p>
    </form>

    <template v-if="quizId">
      <h2>Questions</h2>
      <p v-if="store.loading">Loading…</p>

      <div v-for="(q, qi) in questions" :key="q.id" class="question-card">
        <template v-if="editingQuestionId !== q.id">
          <p>
            <strong>{{ qi + 1 }}. {{ q.text }}</strong>
            <span class="badge">{{ q.type }}</span>
            <span class="badge">{{ q.time_limit_seconds }}s</span>
          </p>
          <button @click="startEditQuestion(q)">Edit</button>
          <button @click="removeQuestion(q.id)">Delete</button>

          <ul v-if="q.type === 'closed'" class="options">
            <li v-for="opt in (q.options || [])" :key="opt.id">
              <input
                type="checkbox"
                :checked="opt.is_correct"
                @change="toggleOption(opt, q.id)"
              />
              {{ opt.text }}
              <button @click="removeOption(opt.id, q.id)">✕</button>
            </li>
            <li>
              <form @submit.prevent="addOption(q)">
                <input v-model="newOptionText[q.id]" placeholder="New option" />
                <button type="submit">Add</button>
              </form>
            </li>
          </ul>
        </template>

        <template v-else>
          <form @submit.prevent="saveQuestion(q.id)" class="inline-form">
            <input v-model="editQuestionForm.text" placeholder="Question text" required />
            <select v-model="editQuestionForm.type">
              <option value="closed">Closed</option>
              <option value="open">Open</option>
            </select>
            <input
              type="number"
              v-model.number="editQuestionForm.time_limit_seconds"
              min="5"
              max="120"
            />
            <button type="submit">Save</button>
            <button type="button" @click="editingQuestionId = null">Cancel</button>
          </form>
        </template>
      </div>

      <div class="add-question">
        <h3>Add Question</h3>
        <form @submit.prevent="addQuestion">
          <input v-model="newQuestion.text" placeholder="Question text" required />
          <select v-model="newQuestion.type">
            <option value="closed">Multiple choice</option>
            <option value="true_false">True / False</option>
            <option value="open">Open answer</option>
          </select>
          <input
            type="number"
            v-model.number="newQuestion.time_limit_seconds"
            min="5"
            max="120"
          />

          <!-- Multiple choice options -->
          <template v-if="newQuestion.type === 'closed'">
            <div class="draft-options">
              <div v-for="(opt, idx) in newOptions" :key="idx" class="draft-option">
                <input
                  type="radio"
                  :checked="opt.is_correct"
                  @change="setCorrectOption(idx)"
                  name="new-correct-option"
                />
                <span>{{ opt.text }}</span>
                <button type="button" @click="removeNewOption(idx)">✕</button>
              </div>
              <div class="add-option-inline">
                <input v-model="newOptionInput" placeholder="Option text" @keydown.enter.prevent="addNewOption" />
                <button type="button" @click="addNewOption">+ Add option</button>
              </div>
              <p v-if="newOptions.length < 2" class="hint">Add at least 2 options</p>
            </div>
          </template>

          <!-- True/False correct answer -->
          <template v-else-if="newQuestion.type === 'true_false'">
            <div class="tf-correct">
              <span>Correct answer:</span>
              <label><input type="radio" v-model="newTfCorrect" value="true" /> True</label>
              <label><input type="radio" v-model="newTfCorrect" value="false" /> False</label>
            </div>
          </template>

          <!-- Open question correct answer -->
          <template v-else-if="newQuestion.type === 'open'">
            <label>
              Correct answer
              <input
                v-model="newOpenCorrect"
                placeholder="e.g. Buenos Aires"
                required
              />
            </label>
            <p class="hint">Accepts minor typos (up to ~20% of the answer length)</p>
          </template>

          <button type="submit" :disabled="newQuestion.type === 'closed' && newOptions.length < 2">
            Add Question
          </button>
        </form>
      </div>

      <div class="session-launcher">
        <h2>Host a Game</h2>
        <button @click="createSession" :disabled="creatingSession">
          {{ creatingSession ? 'Creating…' : 'Create Session' }}
        </button>
        <p v-if="sessionPin" class="pin">
          PIN: <strong>{{ sessionPin }}</strong>
          <router-link :to="`/admin/sessions/${sessionPin}`"> → Open Session</router-link>
        </p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'
import { useAdminApi } from '../../composables/useAdminApi.js'

const route = useRoute()
const router = useRouter()
const store = useQuizStore()
const api = useAdminApi()

const routeId = route.params.id
const isNew = !routeId
const quizId = ref(isNew ? null : routeId)

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
const creatingSession = ref(false)
const sessionPin = ref('')

onMounted(async () => {
  if (!isNew) {
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
    if (isNew) {
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

async function addQuestion() {
  const payload = { ...newQuestion.value }
  if (payload.type === 'closed') {
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
}

async function saveQuestion(id) {
  const updated = await store.updateQuestion(id, { ...editQuestionForm.value })
  const idx = questions.value.findIndex(x => x.id === id)
  if (idx !== -1) Object.assign(questions.value[idx], updated)
  editingQuestionId.value = null
}

async function removeQuestion(id) {
  if (!confirm('Delete this question?')) return
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
</script>
