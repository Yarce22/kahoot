<template>
  <div class="session-view">
    <h1>Session PIN: <strong>{{ pin }}</strong></h1>

    <div class="players-section">
      <h2>Players ({{ players.length }})</h2>
      <ul>
        <li v-for="p in players" :key="p.nickname">{{ p.nickname }}</li>
      </ul>
      <p v-if="!players.length">No players yet…</p>
    </div>

    <div v-if="phase === 'lobby'" class="controls">
      <button @click="startGame" :disabled="starting">
        {{ starting ? 'Starting…' : 'Start Game' }}
      </button>
    </div>

    <div v-else-if="phase === 'active'" class="controls">
      <p>Question {{ currentIndex + 1 }}</p>
      <p v-if="currentQuestion"><em>{{ currentQuestion.text }}</em></p>
      <button @click="next">Next Question</button>
      <button @click="end">End Game</button>
    </div>

    <div v-if="finalLeaderboard.length" class="leaderboard">
      <h2>Final Leaderboard</h2>
      <ol>
        <li v-for="entry in finalLeaderboard" :key="entry.nickname">
          {{ entry.nickname }} — {{ entry.score }} pts
        </li>
      </ol>
    </div>

    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
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

function initSession(currentPin) {
  players.value = []
  phase.value = 'lobby'
  currentIndex.value = -1
  currentQuestion.value = null
  finalLeaderboard.value = []
  errorMsg.value = ''

  const socket = connect({ adminToken: auth.adminToken })

  socket.off('player-joined')
  socket.off('player-left')
  socket.off('game-started')
  socket.off('question-show')
  socket.off('game-end')
  socket.off('session-error')

  socket.emit('host:join-session', { pin: currentPin }, (ack) => {
    if (ack?.error) {
      errorMsg.value = `Could not join session: ${ack.error}`
      return
    }
    players.value = ack?.players || []
  })

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
  socket.off('player-joined')
  socket.off('player-left')
  socket.off('game-started')
  socket.off('question-show')
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
</script>
