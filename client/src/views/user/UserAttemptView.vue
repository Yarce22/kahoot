<template>
  <div class="user-attempt-view view-transition-enter">

    <!-- Attempt-start errors (409/404) — inline with a link back to the
         list, per the plan's design decision: the list's own fresh
         GET /quizzes already reflects the true state, so it's the correct
         place to re-decide what button to show, rather than guessing here. -->
    <template v-if="loadError">
      <p class="error-msg" role="alert">{{ loadError }}</p>
      <router-link to="/user/quizzes" class="btn btn-ghost">← Volver a mis exámenes</router-link>
    </template>

    <p v-else-if="!attempt" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando…
    </p>

    <template v-else>
      <div class="attempt-header">
        <span class="badge badge-purple">Pregunta {{ currentIndex + 1 }} de {{ questions.length }}</span>
        <span class="badge" :class="remainingSeconds <= 30 ? 'badge-orange' : 'badge-blue'">
          ⏱ {{ formattedRemaining }}
        </span>
      </div>

      <p v-if="answerError" class="error-msg" role="alert">{{ answerError }}</p>

      <div v-if="currentQuestion" class="card" style="padding: 24px; margin-bottom: 20px;">
        <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
          {{ currentQuestion.text }}
        </h2>

        <!-- closed / true_false: single-select — upsert allows resending, so
             clicking a different option after answering just re-records it,
             hence no `disabled` lock on already-answered options. -->
        <div
          v-if="currentQuestion.type === 'closed' || currentQuestion.type === 'true_false'"
          class="option-list"
        >
          <button
            v-for="opt in currentQuestion.options"
            :key="opt.id"
            type="button"
            class="btn"
            :class="isSelectedSingle(opt.id) ? 'btn-primary' : 'btn-outline'"
            :disabled="frozen"
            @click="answerSingle(opt.id)"
          >
            {{ opt.text }}
          </button>
        </div>

        <!-- multiple: checkboxes + explicit send — can't auto-submit on a
             single click since several options may need to be picked first. -->
        <div v-else-if="currentQuestion.type === 'multiple'" class="option-list">
          <label v-for="opt in currentQuestion.options" :key="opt.id" class="checkbox-row">
            <input type="checkbox" :value="opt.id" v-model="multiSelection" :disabled="frozen" />
            {{ opt.text }}
          </label>
          <button
            type="button"
            class="btn btn-primary"
            style="margin-top: 12px;"
            :disabled="frozen || multiSelection.length === 0"
            @click="answerMultiple"
          >
            Enviar respuesta
          </button>
        </div>

        <!-- open -->
        <div v-else class="open-answer">
          <input
            v-model="openText"
            class="input-sm"
            type="text"
            placeholder="Escribí tu respuesta…"
            maxlength="500"
            :disabled="frozen"
          />
          <button
            type="button"
            class="btn btn-primary"
            style="margin-top: 12px;"
            :disabled="frozen"
            @click="answerOpen"
          >
            Enviar respuesta
          </button>
        </div>

        <p v-if="answeredThisSession[currentQuestion.id]" class="answered-note" role="status">
          ✅ Respuesta registrada
        </p>
      </div>

      <div class="attempt-nav">
        <button class="btn btn-ghost" :disabled="currentIndex === 0" @click="currentIndex--">
          ← Anterior
        </button>
        <button class="btn btn-ghost" :disabled="currentIndex === questions.length - 1" @click="currentIndex++">
          Siguiente →
        </button>
      </div>

      <!-- Entregar examen — visible from ANY question, not gated on having
           answered every one (partial submission is a legitimate
           server-supported outcome). confirm()-gated: an irreversible
           action, same pattern as QuizListView.vue's remove(). -->
      <button class="btn btn-coral" style="width: 100%; margin-top: 20px;" :disabled="submitting" @click="entregar()">
        {{ submitting ? 'Entregando…' : 'Entregar examen' }}
      </button>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserQuizzesStore } from '../../stores/userQuizzes.js'

const route = useRoute()
const router = useRouter()
const store = useUserQuizzesStore()

const attempt = ref(null)
const questions = ref([])
const currentIndex = ref(0)
const loadError = ref('')
const answerError = ref('')
const submitting = ref(false)

// frozen — set once an answer attempt comes back 409 ATTEMPT_EXPIRED/
// ATTEMPT_NOT_IN_PROGRESS: the server has stopped accepting answers, so
// further clicks would just 409 again. Entregar stays enabled — submitting
// a frozen attempt is exactly what routes the usuario to their result.
const frozen = ref(false)

// answeredThisSession — questionId -> the answer payload just sent, purely
// local UI state for THIS session. Does not rehydrate from anything on
// mount (documented contract gap: GET/POST attempt never returns previously
// recorded answers for a resumed in-progress attempt), so a reload loses it
// by design, not by bug.
const answeredThisSession = ref({})

const multiSelection = ref([])
const openText = ref('')

const remainingSeconds = ref(0)
let timerHandle = null
// Guards the countdown's auto-submit so it can only ever fire once, even if
// the interval ticks again before navigation away completes.
let autoSubmitted = false

const currentQuestion = computed(() => questions.value[currentIndex.value])

function isSelectedSingle(optionId) {
  const q = currentQuestion.value
  return q && answeredThisSession.value[q.id]?.selectedOptionId === optionId
}

function computeRemaining() {
  const ms = new Date(attempt.value.expiresAt).getTime() - Date.now()
  return Math.max(0, Math.floor(ms / 1000))
}

const formattedRemaining = computed(() => {
  const total = remainingSeconds.value
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

onMounted(async () => {
  try {
    const res = await store.startAttempt(route.params.assignmentId)
    attempt.value = res.attempt
    // orderIndex is the server's authoritative question order — the payload
    // itself isn't guaranteed sorted, so this view sorts once rather than
    // trusting array order.
    questions.value = [...(res.questions ?? [])].sort((a, b) => a.orderIndex - b.orderIndex)
    remainingSeconds.value = computeRemaining()
    timerHandle = setInterval(tick, 1000)
  } catch (e) {
    loadError.value = e.message
  }
})

onUnmounted(() => {
  if (timerHandle) clearInterval(timerHandle)
})

function tick() {
  remainingSeconds.value = computeRemaining()
  // Client-side countdown is UX only — the server independently enforces
  // the real deadline (answers 409 past expires_at). Best-effort auto-submit
  // at zero, guarded so it can only fire once.
  if (remainingSeconds.value <= 0 && !autoSubmitted) {
    autoSubmitted = true
    entregar(true)
  }
}

// Reset per-question drafts on navigation, prefilling from anything already
// sent this session so revisiting a question shows what was picked (upsert
// makes resending harmless if they change their mind again).
watch(currentIndex, () => {
  const q = currentQuestion.value
  const prev = q && answeredThisSession.value[q.id]
  multiSelection.value = prev?.selectedOptionIds ? [...prev.selectedOptionIds] : []
  openText.value = prev?.answerText ?? ''
})

async function recordAnswer(payload) {
  if (frozen.value) return
  answerError.value = ''
  try {
    await store.submitAnswer(attempt.value.id, payload)
    answeredThisSession.value = { ...answeredThisSession.value, [payload.questionId]: payload }
  } catch (e) {
    if (e.message === 'ATTEMPT_EXPIRED' || e.message === 'ATTEMPT_NOT_IN_PROGRESS') {
      frozen.value = true
      answerError.value = 'Se acabó el tiempo para responder. Podés entregar el examen para ver tu resultado.'
    } else {
      answerError.value = e.message
    }
  }
}

function answerSingle(optionId) {
  recordAnswer({ questionId: currentQuestion.value.id, selectedOptionId: optionId })
}

function answerMultiple() {
  recordAnswer({ questionId: currentQuestion.value.id, selectedOptionIds: [...multiSelection.value] })
}

function answerOpen() {
  recordAnswer({ questionId: currentQuestion.value.id, answerText: openText.value.trim() })
}

// entregar — POST /submit. `auto` distinguishes the countdown's best-effort
// call (no confirm — the usuario isn't there to answer a dialog) from the
// button's explicit, confirm()-gated call.
async function entregar(auto = false) {
  if (submitting.value) return
  if (!auto && !confirm('¿Entregar el examen? No vas a poder modificar tus respuestas después.')) return

  submitting.value = true
  try {
    await store.submitAttempt(attempt.value.id)
    router.push(`/user/attempts/${attempt.value.id}/result`)
  } catch (e) {
    // ALREADY_SUBMITTED/EXPIRED mean the attempt is finalized one way or
    // another already — from the usuario's point of view the exam is over
    // either way, and GET /result will now succeed, so navigate there
    // instead of surfacing an error for something that already happened.
    if (e.message === 'ATTEMPT_ALREADY_SUBMITTED' || e.message === 'ATTEMPT_EXPIRED') {
      router.push(`/user/attempts/${attempt.value.id}/result`)
    } else {
      answerError.value = e.message
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.user-attempt-view {
  min-height: 100vh;
  padding: 32px 24px 40px;
  max-width: 640px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

.attempt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.option-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Nunito', sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.open-answer {
  display: flex;
  flex-direction: column;
}

.answered-note {
  margin-top: 14px;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--accent-green);
}

.attempt-nav {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
</style>
