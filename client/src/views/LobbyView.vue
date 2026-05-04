<template>
  <div class="lobby-view view-transition-enter">
    <!-- PIN Display -->
    <div class="card pin-display">
      <p class="pin-label">PIN del juego</p>
      <p class="pin-number" aria-label="PIN del juego">{{ pin }}</p>
    </div>

    <!-- Player count + waiting message -->
    <div class="waiting-msg" aria-live="polite">
      <span class="waiting-dot" aria-hidden="true"></span>
      Esperando jugadores…
    </div>
    <p class="player-count" aria-live="polite">{{ store.players.length }} jugador(es) conectado(s)</p>

    <!-- Player chips with enter animation -->
    <TransitionGroup
      name="player"
      tag="div"
      class="player-list"
      aria-label="Jugadores en el lobby"
      aria-live="polite"
    >
      <div
        v-for="p in store.players"
        :key="p.nickname"
        :class="['player-chip', { 'is-me': p.nickname === store.nickname }]"
      >
        {{ p.nickname }}
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { useGameStore } from '../stores/game.js'
import { useGame } from '../composables/useGame.js'

const route = useRoute()
const pin = route.params.pin
const store = useGameStore()

useGame(pin)

if (store.nickname && !store.players.find(p => p.nickname === store.nickname)) {
  store.players.push({ nickname: store.nickname })
}
</script>

<style scoped>
.lobby-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 20px;
  gap: 24px;
  position: relative;
  z-index: 1;
  padding-top: 60px;
}

.pin-display {
  text-align: center;
  padding: 28px 40px;
}

.pin-label {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.pin-number {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: clamp(48px, 12vw, 80px);
  color: var(--accent-yellow);
  animation: pinGlow 2.5s ease-in-out infinite;
  letter-spacing: 8px;
}

.waiting-msg {
  display: flex;
  align-items: center;
  gap: 10px;
  animation: pulse 2s ease-in-out infinite;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: var(--text-secondary);
}

.waiting-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-cyan);
  animation: pulse 1s ease-in-out infinite;
}

.player-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  width: 100%;
  max-width: 600px;
}

.player-chip {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  padding: 8px 18px;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 14px;
  animation: bounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  transition: all 0.2s;
}

.player-chip.is-me {
  background: linear-gradient(135deg, rgba(155, 114, 245, 0.3), rgba(61, 207, 207, 0.2));
  border-color: var(--accent-purple);
  color: var(--accent-cyan);
  box-shadow: 0 0 14px rgba(155, 114, 245, 0.3);
}

.player-count {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: var(--text-secondary);
  text-align: center;
}

/* TransitionGroup animations */
.player-enter-active { animation: bounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.player-leave-active { transition: opacity 0.3s, transform 0.3s; }
.player-leave-to    { opacity: 0; transform: scale(0.8); }
</style>
