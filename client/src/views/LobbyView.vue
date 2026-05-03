<template>
  <div class="lobby">
    <h2>Waiting for host…</h2>
    <p class="pin-label">Game PIN</p>
    <p class="pin-display" aria-label="Game PIN">{{ pin }}</p>
    <p class="player-count" aria-live="polite">{{ store.players.length }} player(s) joined</p>
    <ul class="player-chips" aria-label="Players in lobby" aria-live="polite">
      <li v-for="p in store.players" :key="p.nickname">{{ p.nickname }}</li>
    </ul>
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
