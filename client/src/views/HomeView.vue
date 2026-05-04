<template>
  <div class="home-view view-transition-enter">
    <!-- Floating background shapes -->
    <div class="floating-shapes" aria-hidden="true">
      <div class="shape shape-1"></div>
      <div class="shape shape-2"></div>
      <div class="shape shape-3"></div>
      <div class="shape shape-4"></div>
    </div>

    <!-- Logo -->
    <div class="home-logo-big" aria-label="QuizPlay">QuizPlay</div>
    <p class="home-tagline">El quiz más divertido en tiempo real 🎮</p>

    <!-- Join card -->
    <div class="card home-card">
      <form @submit.prevent="joinGame" aria-label="Formulario de ingreso al juego" novalidate>
        <div class="field-group">
          <label class="field-label" for="pin-input">PIN del juego</label>
          <input
            id="pin-input"
            v-model="pin"
            class="input-field"
            type="text"
            inputmode="numeric"
            placeholder="000000"
            maxlength="6"
            pattern="\d{6}"
            autocomplete="off"
            required
            :aria-describedby="error ? 'join-error' : undefined"
          />
        </div>

        <div class="field-group">
          <label class="field-label" for="nickname-input">Tu apodo</label>
          <input
            id="nickname-input"
            v-model="nickname"
            class="input-field input-normal"
            style="letter-spacing: 1px; font-size: 20px;"
            type="text"
            placeholder="SuperJugador"
            maxlength="30"
            autocomplete="off"
            required
          />
        </div>

        <p v-if="error" id="join-error" class="error-msg" role="alert">{{ error }}</p>

        <button
          type="submit"
          :class="['btn', 'btn-yellow', { 'btn-disabled': loading }]"
          style="width: 100%; margin-top: 8px;"
          :disabled="loading"
          :aria-busy="loading"
        >
          {{ loading ? 'Uniéndose…' : '¡Unirse al juego!' }}
        </button>
      </form>
    </div>

    <!-- Admin link -->
    <p class="home-footer-link">
      ¿Sos el host?
      <router-link to="/admin/login" class="home-admin-link">Accedé al panel de administración</router-link>
    </p>
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
  SESSION_NOT_FOUND: 'Juego no encontrado. Verificá el PIN.',
  SESSION_NOT_JOINABLE: 'Este juego ya comenzó.',
  NICKNAME_TAKEN: 'Ese apodo ya está en uso. Probá con otro.',
  VALIDATION_ERROR: 'Datos inválidos.',
}

async function joinGame() {
  error.value = ''
  loading.value = true
  const socket = connect()

  socket.emit('join-game', { pin: pin.value, nickname: nickname.value }, (ack) => {
    loading.value = false
    if (ack?.error) {
      error.value = ERROR_MESSAGES[ack.error] || 'Algo salió mal.'
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

<style scoped>
.home-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  position: relative;
  z-index: 1;
}

.home-logo-big {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: clamp(42px, 10vw, 72px);
  background: linear-gradient(135deg, var(--accent-yellow) 0%, var(--accent-coral) 50%, var(--accent-purple) 100%);
  background-size: 200% auto;
  animation: gradientShift 4s ease infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 8px;
}

.home-tagline {
  color: var(--text-secondary);
  font-size: 16px;
  margin-bottom: 48px;
  text-align: center;
}

.home-card {
  width: 100%;
  max-width: 440px;
  padding: 40px 36px;
  animation: fadeSlideUp 0.5s ease both;
}

.field-group {
  margin-bottom: 20px;
}

.field-label {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
  display: block;
}

/* Floating background shapes */
.floating-shapes {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.shape {
  position: absolute;
  border-radius: 50%;
  opacity: 0.06;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-cyan));
}

.shape-1 { width: 220px; height: 220px; top: 15%; left: 5%;  animation: floatDot 4s ease-in-out 0s infinite; }
.shape-2 { width: 140px; height: 140px; top: 60%; left: 75%; animation: floatDot 6s ease-in-out 2s infinite; }
.shape-3 { width:  80px; height:  80px; top: 35%; left: 60%; animation: floatDot 5s ease-in-out 1s infinite; }
.shape-4 { width: 100px; height: 100px; top: 75%; left: 10%; animation: floatDot 7s ease-in-out 3s infinite; }

.home-footer-link {
  margin-top: 24px;
  color: var(--text-muted);
  font-size: 13px;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  text-align: center;
}

.home-admin-link {
  color: var(--accent-cyan);
  text-decoration: underline;
  cursor: pointer;
}
</style>
