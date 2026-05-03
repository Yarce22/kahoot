<template>
  <div class="home">
    <h1>Kahoot!</h1>
    <form @submit.prevent="joinGame" aria-label="Join game form" novalidate>
      <label for="pin-input">
        Game PIN
        <input
          id="pin-input"
          v-model="pin"
          type="text"
          inputmode="numeric"
          placeholder="6-digit PIN"
          maxlength="6"
          pattern="\d{6}"
          autocomplete="off"
          required
          :aria-describedby="error ? 'join-error' : undefined"
        />
      </label>
      <label for="nickname-input">
        Nickname
        <input
          id="nickname-input"
          v-model="nickname"
          type="text"
          placeholder="Your nickname"
          maxlength="30"
          autocomplete="off"
          required
        />
      </label>
      <p v-if="error" id="join-error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="loading" :aria-busy="loading">
        {{ loading ? 'Joining…' : 'Join Game' }}
      </button>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSocket } from '../composables/useSocket.js'
import { useGameStore } from '../stores/game.js'

const pin = ref('')
const nickname = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const store = useGameStore()
const { connect } = useSocket()

const ERROR_MESSAGES = {
  SESSION_NOT_FOUND: 'Game not found. Check the PIN.',
  SESSION_NOT_JOINABLE: 'This game has already started.',
  NICKNAME_TAKEN: 'That nickname is taken. Try another.',
  VALIDATION_ERROR: 'Invalid input.',
}

async function joinGame() {
  error.value = ''
  loading.value = true
  const socket = connect()

  socket.emit('join-game', { pin: pin.value, nickname: nickname.value }, (ack) => {
    loading.value = false
    if (ack?.error) {
      error.value = ERROR_MESSAGES[ack.error] || 'Something went wrong.'
      return
    }
    store.pin = pin.value
    store.playerId = ack.playerId
    store.sessionId = ack.sessionId
    store.nickname = nickname.value
    store.phase = 'lobby'
    router.push(`/lobby/${pin.value}`)
  })
}
</script>
