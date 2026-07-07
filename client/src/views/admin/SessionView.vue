<template>
  <div class="session-view view-transition-enter">

    <!-- Header -->
    <div class="session-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 14px;">
          ← Mis quizzes
        </router-link>
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary);">
          Panel del Host
        </h1>
      </div>
      <div class="host-controls">
        <template v-if="phase === 'lobby'">
          <button class="btn btn-green" @click="startGame" :disabled="starting">
            {{ starting ? 'Iniciando…' : '▶ Iniciar Juego' }}
          </button>
        </template>
        <template v-else-if="phase === 'active'">
          <button class="btn btn-primary" @click="next">Siguiente Pregunta →</button>
          <button class="btn btn-coral" @click="end">Terminar Juego</button>
        </template>
      </div>
    </div>

    <!-- Grid layout -->
    <div class="session-grid">

      <!-- PIN card -->
      <div class="card session-pin-card">
        <p class="pin-label">PIN del juego</p>
        <p class="session-pin-big" aria-label="PIN del juego">{{ pin }}</p>
        <p style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-size: 14px; font-weight: 700;">
          Compartí este PIN con los jugadores
        </p>
      </div>

      <!-- Players card -->
      <div class="card session-players-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <p class="pin-label" style="margin-bottom: 0;">
            Jugadores ({{ players.length }})
          </p>
          <p v-if="phase === 'active' && currentQuestion" class="pin-label" style="margin-bottom: 0; color: var(--accent-green);">
            {{ answeredNicknames.length }}/{{ players.length }} respondieron
          </p>
        </div>
        <div class="session-player-list" aria-live="polite" aria-label="Lista de jugadores">
          <TransitionGroup name="player" tag="div">
            <div
              v-for="p in players"
              :key="p.nickname"
              class="session-player-row"
              :class="{ 'player-answered': phase === 'active' && answeredNicknames.includes(p.nickname) }"
            >
              <span
                class="session-player-dot"
                :style="phase === 'active' ? { background: answeredNicknames.includes(p.nickname) ? 'var(--accent-green)' : 'var(--text-muted)' } : {}"
                aria-hidden="true"
              ></span>
              <span style="flex: 1;">{{ p.nickname }}</span>
              <span v-if="phase === 'active'" style="font-size: 14px; font-weight: 800;">
                {{ answeredNicknames.includes(p.nickname) ? '✓' : '…' }}
              </span>
            </div>
          </TransitionGroup>
          <p
            v-if="!players.length"
            style="color: var(--text-muted); font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 14px; text-align: center; padding: 20px 0;"
          >
            Esperando jugadores…
          </p>
        </div>
      </div>

      <!-- Question progress card (active phase) -->
      <div v-if="phase === 'active'" class="card question-progress-card">
        <div class="progress-info">
          <p class="nunito" style="font-weight: 800; font-size: 16px; color: var(--text-primary);">
            {{ currentQuestion ? `Pregunta ${currentIndex + 1}` : 'Iniciando…' }}
          </p>
          <div
            v-if="currentQuestion"
            class="host-timer"
            :class="{ 'host-timer-urgent': timerSeconds <= 5 && timerSeconds > 0 }"
          >
            {{ timerSeconds }}s
          </div>
        </div>
        <p v-if="currentQuestion" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-size: 15px; font-weight: 700; font-style: italic;">
          "{{ currentQuestion.text }}"
        </p>
      </div>

      <!-- Detailed results card (post-game) -->
      <div v-if="phase === 'ended'" class="card" style="padding: 24px; grid-column: 1 / -1;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
          <h2 class="nunito" style="font-weight: 900; font-size: 20px; color: var(--text-primary);">
            📋 Respuestas por jugador
          </h2>
          <button
            class="btn btn-primary"
            style="font-size: 14px; padding: 8px 16px;"
            @click="loadResults"
            :disabled="loadingResults"
          >
            {{ loadingResults ? 'Cargando…' : resultsLoaded ? 'Actualizar' : 'Ver respuestas' }}
          </button>
        </div>

        <div v-if="resultsLoaded && groupedResults.length" style="display: flex; flex-direction: column; gap: 20px;">
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

        <p v-else-if="resultsLoaded && !groupedResults.length" style="color: var(--text-muted); font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 14px; text-align: center; padding: 20px 0;">
          No hay respuestas registradas.
        </p>
      </div>

      <!-- Final leaderboard card -->
      <div v-if="finalLeaderboard.length" class="card" style="padding: 24px; grid-column: 1 / -1;">
        <h2 class="nunito" style="font-weight: 900; font-size: 20px; color: var(--text-primary); margin-bottom: 16px;">
          🏆 Clasificación Final
        </h2>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div
            v-for="(entry, i) in finalLeaderboard"
            :key="entry.nickname"
            :class="['leaderboard-item', rankClass(i)]"
            :style="{ animationDelay: (i * 0.07) + 's' }"
          >
            <div class="rank-badge">{{ rankLabel(i) }}</div>
            <span class="player-name">{{ entry.nickname }}</span>
            <span class="player-score">{{ entry.score }} pts</span>
          </div>
        </div>
      </div>
    </div>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSocket } from '../../composables/useSocket.js'
import { useAdminApi } from '../../composables/useAdminApi.js'
import { useAuthStore } from '../../stores/auth.js'

const route = useRoute()
const pin = computed(() => route.params.pin)
const { connect, getSocket } = useSocket()
const api = useAdminApi()
const auth = useAuthStore()

const players = ref([])
const phase = ref('lobby')
const currentIndex = ref(-1)
const currentQuestion = ref(null)
const finalLeaderboard = ref([])
const starting = ref(false)
const errorMsg = ref('')
const loadingResults = ref(false)
const resultsLoaded = ref(false)
const groupedResults = ref([])
const timerSeconds = ref(0)
const answeredNicknames = ref([])

function initSession(currentPin) {
  players.value = []
  phase.value = 'lobby'
  currentIndex.value = -1
  currentQuestion.value = null
  finalLeaderboard.value = []
  errorMsg.value = ''

  const socket = connect({ token: auth.token })

  socket.off('connect')
  socket.off('player-joined')
  socket.off('player-left')
  socket.off('game-started')
  socket.off('question-show')
  socket.off('timer-tick')
  socket.off('player-answered')
  socket.off('game-end')
  socket.off('session-error')

  // (Re)join the session on every connection. On a reconnect socket.io opens
  // a fresh server-side socket (new id): the host is re-authenticated by the
  // handshake, but authorizedSessionId is unset and it is no longer in the
  // session room. Re-emitting host:join-session re-authorizes the socket and
  // re-adds it to the room — otherwise a dropped-and-restored connection
  // leaves the host unable to control the game (next-question would 401).
  function joinSession() {
    socket.emit('host:join-session', { pin: currentPin }, (ack) => {
      if (ack?.error) {
        errorMsg.value = `No se pudo unir a la sesión: ${ack.error}`
        return
      }
      errorMsg.value = ''
      players.value = ack?.players || []
    })
  }

  // 'connect' fires on the initial connection and on every reconnect. If the
  // socket is already connected (reused from another view) it won't fire, so
  // join immediately in that case.
  socket.on('connect', joinSession)
  if (socket.connected) joinSession()

  socket.on('player-joined', ({ nickname }) => {
    if (!players.value.find(p => p.nickname === nickname)) {
      players.value.push({ nickname })
    }
  })

  socket.on('player-left', ({ nickname }) => {
    players.value = players.value.filter(p => p.nickname !== nickname)
  })

  socket.on('game-started', () => {
    phase.value = 'active'
  })

  socket.on('question-show', (question) => {
    currentIndex.value = question.index
    currentQuestion.value = question
    timerSeconds.value = question.timeLimitSeconds
    answeredNicknames.value = []
  })

  socket.on('timer-tick', ({ secondsLeft }) => {
    timerSeconds.value = secondsLeft
  })

  socket.on('player-answered', ({ nickname }) => {
    if (!answeredNicknames.value.includes(nickname)) {
      answeredNicknames.value = [...answeredNicknames.value, nickname]
    }
  })

  socket.on('game-end', ({ leaderboard }) => {
    finalLeaderboard.value = leaderboard
    phase.value = 'ended'
  })

  socket.on('session-error', ({ code }) => {
    errorMsg.value = `Error: ${code}`
  })
}

watch(pin, (newPin) => { if (newPin) initSession(newPin) }, { immediate: true })

onUnmounted(() => {
  const socket = getSocket()
  if (!socket) return
  socket.off('connect')
  socket.off('player-joined')
  socket.off('player-left')
  socket.off('game-started')
  socket.off('question-show')
  socket.off('timer-tick')
  socket.off('player-answered')
  socket.off('game-end')
  socket.off('session-error')
})

async function startGame() {
  starting.value = true
  errorMsg.value = ''
  try {
    await api.post(`/api/sessions/${pin.value}/start`, {})
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    starting.value = false
  }
}

function next() {
  getSocket()?.emit('next-question', { pin: pin.value })
}

function end() {
  getSocket()?.emit('host:end-game', { pin: pin.value })
}

async function loadResults() {
  loadingResults.value = true
  try {
    const data = await api.get(`/api/sessions/${pin.value}/results`)
    const byPlayer = {}
    for (const r of data.results ?? []) {
      const name = r.player?.nickname ?? 'Desconocido'
      if (!byPlayer[name]) byPlayer[name] = { nickname: name, answers: [] }
      const answerText = r.answer_text || r.selected_option?.text || null
      byPlayer[name].answers.push({
        questionText: r.question?.text ?? '',
        order: r.question?.order_index ?? 0,
        answer: answerText,
        is_correct: r.is_correct,
        timeTakenMs: r.time_taken_ms ?? null
      })
    }
    for (const p of Object.values(byPlayer)) {
      p.answers.sort((a, b) => a.order - b.order)
    }
    groupedResults.value = Object.values(byPlayer)
    resultsLoaded.value = true
  } catch (e) {
    errorMsg.value = `Error cargando resultados: ${e.message}`
  } finally {
    loadingResults.value = false
  }
}

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
.session-view {
  min-height: 100vh;
  padding: 24px;
  position: relative;
  z-index: 1;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
  flex-wrap: wrap;
  gap: 14px;
}

.host-controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.session-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

/* PIN card */
.session-pin-card {
  padding: 32px;
  text-align: center;
}

.pin-label {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.session-pin-big {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: clamp(42px, 8vw, 72px);
  color: var(--accent-yellow);
  letter-spacing: 10px;
  animation: pinGlow 2.5s ease-in-out infinite;
  margin: 10px 0;
}

/* Players card */
.session-players-card { padding: 24px; }

.session-player-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
}

.session-player-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--bg-elevated);
  animation: bounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 15px;
  color: var(--text-primary);
}

.session-player-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-green);
  flex-shrink: 0;
}

/* Progress card */
.question-progress-card { padding: 24px; }

.progress-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.host-timer {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 28px;
  color: var(--accent-yellow);
  min-width: 52px;
  text-align: right;
  transition: color 0.3s;
}

.host-timer-urgent {
  color: var(--accent-coral);
  animation: pulse 0.5s ease infinite;
}

.session-player-row.player-answered {
  opacity: 0.6;
}

/* Leaderboard entries */
.leaderboard-item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  animation: staggerIn 0.4s ease both;
  transition: transform 0.2s;
}

.leaderboard-item.rank-1 {
  border-color: rgba(245, 200, 66, 0.5);
  background: linear-gradient(135deg, rgba(245, 200, 66, 0.12), var(--bg-elevated));
}
.leaderboard-item.rank-2 {
  border-color: rgba(180, 180, 200, 0.4);
}
.leaderboard-item.rank-3 {
  border-color: rgba(200, 120, 60, 0.4);
}

.rank-badge {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 14px;
  flex-shrink: 0; background: var(--bg-card); color: var(--text-secondary);
}

.rank-1 .rank-badge { background: linear-gradient(135deg, #f5c842, #e8b800); color: #1a1035; box-shadow: var(--shadow-glow-yellow); }
.rank-2 .rank-badge { background: linear-gradient(135deg, #c0c0d0, #a0a0b0); color: #1a1035; }
.rank-3 .rank-badge { background: linear-gradient(135deg, #cd7f32, #b8692a); color: white; }

.player-name {
  font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 17px; flex: 1;
  color: var(--text-primary);
}

.player-score {
  font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 18px;
  color: var(--accent-yellow);
}

/* TransitionGroup */
.player-enter-active { animation: bounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.player-leave-active { transition: opacity 0.3s, transform 0.3s; }
.player-leave-to    { opacity: 0; transform: scale(0.8); }

@media (max-width: 600px) {
  .session-grid { grid-template-columns: 1fr; }
}
</style>
