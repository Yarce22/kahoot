<template>
  <div class="status-stack">
    <div class="stack" role="img" :aria-label="summary">
      <div
        v-for="s in segments"
        :key="s.label"
        class="seg"
        :style="{ flex: s.count, background: s.color }"
        :title="s.title"
      ></div>
    </div>
    <ul class="legend">
      <li v-for="s in items" :key="s.label">
        <span class="swatch" :style="{ background: s.color }" aria-hidden="true"></span>
        <span class="legend-label">{{ s.label }}</span>
        <strong>{{ s.count }}</strong>
        <span class="legend-pct">{{ s.percent }}%</span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // statusCounts() output: { Completado, 'En progreso', Vencido, Pendiente }
  counts: { type: Object, required: true }
})

const COLORS = {
  Completado: 'var(--status-completed)',
  'En progreso': 'var(--status-progress)',
  Vencido: 'var(--status-expired)',
  Pendiente: 'var(--status-pending)'
}

const total = computed(() => Object.values(props.counts).reduce((a, b) => a + b, 0))

const items = computed(() =>
  Object.keys(COLORS).map((label) => {
    const count = props.counts[label] ?? 0
    const percent = total.value ? Math.round((count / total.value) * 100) : 0
    return { label, count, percent, color: COLORS[label], title: `${label}: ${count} (${percent}%)` }
  })
)
const segments = computed(() => items.value.filter((s) => s.count > 0))
const summary = computed(() => items.value.map((s) => `${s.label}: ${s.count}`).join(', '))
</script>

<style scoped>
.status-stack {
  --status-completed: #56633f;
  --status-progress: #d67f48;
  --status-expired: #8c491a;
  --status-pending: #a69d8e;
  font-family: 'Nunito', sans-serif;
}
.stack { display: flex; gap: 2px; height: 14px; }
.seg { min-width: 4px; }
.seg:first-child { border-radius: 4px 0 0 4px; }
.seg:last-child { border-radius: 0 4px 4px 0; }
.seg:only-child { border-radius: 4px; }
.legend { list-style: none; padding: 0; margin: 14px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 16px; }
.legend li { display: flex; align-items: center; gap: 8px; color: var(--text-primary); font-size: 14px; }
.swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.legend-label { color: var(--text-secondary); font-weight: 700; }
.legend-pct { color: var(--text-muted); font-size: 13px; }
</style>
