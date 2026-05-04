<template>
  <div class="results-view view-transition-enter">

    <!-- Confetti -->
    <div class="confetti-container" aria-hidden="true">
      <div
        v-for="p in confettiPieces"
        :key="p.id"
        class="confetti-piece"
        :style="{
          left: p.left + '%',
          top: '-20px',
          width:  p.size + 'px',
          height: p.size + 'px',
          background: p.color,
          animationDelay:    p.delay    + 's',
          animationDuration: p.duration + 's',
        }"
      ></div>
    </div>

    <!-- Title -->
    <h1 class="results-title">¡Resultados Finales!</h1>

    <!-- Podium (top 3) -->
    <div v-if="store.leaderboard.length" class="podium" aria-label="Podio">
      <!-- 2nd place -->
      <div v-if="store.leaderboard[1]" class="podium-spot podium-2">
        <span class="podium-trophy" aria-label="Segundo lugar">🥈</span>
        <p class="podium-name">{{ store.leaderboard[1].nickname }}</p>
        <p class="podium-score">{{ store.leaderboard[1].score }} pts</p>
        <div class="podium-block">2</div>
      </div>

      <!-- 1st place (center) -->
      <div v-if="store.leaderboard[0]" class="podium-spot podium-1">
        <span class="podium-trophy" aria-label="Primer lugar">🥇</span>
        <p class="podium-name">{{ store.leaderboard[0].nickname }}</p>
        <p class="podium-score">{{ store.leaderboard[0].score }} pts</p>
        <div class="podium-block">1</div>
      </div>

      <!-- 3rd place -->
      <div v-if="store.leaderboard[2]" class="podium-spot podium-3">
        <span class="podium-trophy" aria-label="Tercer lugar">🥉</span>
        <p class="podium-name">{{ store.leaderboard[2].nickname }}</p>
        <p class="podium-score">{{ store.leaderboard[2].score }} pts</p>
        <div class="podium-block">3</div>
      </div>
    </div>

    <!-- Full leaderboard (4th place onwards) -->
    <div
      v-if="store.leaderboard.length > 3"
      class="leaderboard-list"
      aria-label="Clasificación completa"
    >
      <div
        v-for="(entry, i) in store.leaderboard.slice(3)"
        :key="entry.nickname"
        class="leaderboard-item rank-default"
        :style="{ animationDelay: ((i + 3) * 0.07) + 's' }"
      >
        <div class="rank-badge">#{{ i + 4 }}</div>
        <span class="player-name">{{ entry.nickname }}</span>
        <span class="player-score">{{ entry.score }} pts</span>
      </div>
    </div>

    <button class="btn btn-yellow" style="margin-top: 8px;" @click="router.push('/')">
      ¡Jugar de nuevo!
    </button>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'

const router = useRouter()
const store = useGameStore()

const CONFETTI_COLORS = ['#f5c842', '#f4634a', '#3dcfcf', '#46d98a', '#9b72f5', '#ffffff']

const confettiPieces = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  left:     Math.random() * 100,
  color:    CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  size:     7 + Math.random() * 8,
  delay:    Math.random() * 2.5,
  duration: 2.5 + Math.random() * 2,
}))
</script>

<style scoped>
.results-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 20px 40px;
  gap: 32px;
  position: relative;
  z-index: 1;
  overflow: hidden;
}

.results-title {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: clamp(28px, 7vw, 48px);
  background: linear-gradient(135deg, var(--accent-yellow), var(--accent-coral));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-align: center;
  animation: popIn 0.6s ease both;
}

.confetti-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 200;
  overflow: hidden;
}

.confetti-piece {
  position: absolute;
  border-radius: 2px;
  animation: confettiFall linear both;
}

/* Podium */
.podium {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  justify-content: center;
  width: 100%;
  max-width: 480px;
}

.podium-spot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.podium-trophy {
  font-size: 32px;
  animation: trophyBounce 0.7s ease both;
}

.podium-name {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 14px;
  text-align: center;
  word-break: break-word;
  color: var(--text-primary);
}

.podium-score {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 13px;
  color: var(--text-secondary);
}

.podium-block {
  width: 100%;
  border-radius: 12px 12px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 28px;
  color: white;
}

.podium-1 .podium-block {
  height: 110px;
  background: linear-gradient(180deg, #f5c842, #e8b800);
  animation: fadeSlideUp 0.6s 0.2s ease both;
  box-shadow: var(--shadow-glow-yellow);
}
.podium-2 .podium-block {
  height: 80px;
  background: linear-gradient(180deg, #a8a8c0, #8888a0);
  animation: fadeSlideUp 0.6s 0.1s ease both;
}
.podium-3 .podium-block {
  height: 60px;
  background: linear-gradient(180deg, #cd7f32, #b8692a);
  animation: fadeSlideUp 0.6s 0s ease both;
}

/* Full leaderboard list (4th+) */
.leaderboard-list {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.leaderboard-item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  animation: staggerIn 0.4s ease both;
  transition: transform 0.2s;
}
.leaderboard-item:hover { transform: translateX(4px); }

.rank-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 14px;
  flex-shrink: 0;
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.player-name {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 17px;
  flex: 1;
  color: var(--text-primary);
}

.player-score {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 18px;
  color: var(--accent-yellow);
}
</style>
