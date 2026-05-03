<template>
  <div class="leaderboard-final">
    <h2>Final Results</h2>
    <ol aria-label="Final leaderboard">
      <li v-for="(entry, i) in store.leaderboard" :key="entry.nickname">
        <span class="rank">{{ rankEmoji(i) }}</span>
        <span class="nickname">{{ entry.nickname }}</span>
        <span class="score">{{ entry.score }} pts</span>
      </li>
    </ol>
    <button style="margin-top: 2rem" @click="router.push('/')">Play Again</button>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'

const router = useRouter()
const store = useGameStore()

function rankEmoji(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`
}
</script>
