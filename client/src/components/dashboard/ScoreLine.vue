<template>
  <div class="line-wrap">
    <svg :viewBox="`0 0 ${W} ${H}`" class="line-svg" preserveAspectRatio="none" role="img" :aria-label="aria">
      <g v-for="g in [0, 50, 100]" :key="g">
        <line :x1="P.l" :x2="W - P.r" :y1="Y(g)" :y2="Y(g)" stroke="var(--border)" :stroke-dasharray="g === 0 ? '' : '3 4'" />
        <text :x="P.l - 8" :y="Y(g) + 4" text-anchor="end" class="ax">{{ g }}%</text>
      </g>
      <path :d="area" fill="var(--salvia-200)" opacity=".6" />
      <path :d="d" fill="none" stroke="var(--salvia-700)" stroke-width="2.5" stroke-linejoin="round" />
      <g v-for="(p, i) in points" :key="i" @mouseenter="hover = i" @mouseleave="hover = null">
        <circle :cx="X(p.x)" :cy="Y(p.y)" r="14" fill="transparent" />
        <circle :cx="X(p.x)" :cy="Y(p.y)" :r="hover === i ? 6 : 4.5" fill="var(--bg-card)" stroke="var(--salvia-700)" stroke-width="2.5" />
        <text :x="X(p.x)" :y="H - 8" text-anchor="middle" class="ax">{{ p.x.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) }}</text>
      </g>
    </svg>
    <div v-if="hover != null" class="line-tip" :style="{ left: (X(points[hover].x) / W) * 100 + '%', top: (Y(points[hover].y) / H) * 100 + '%' }">
      <strong>{{ points[hover].y }}%</strong> {{ points[hover].label }}
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

// points: [{ x: Date, y: 0-100, label }], sorted by x, at least 2.
const props = defineProps({ points: { type: Array, required: true } })
const W = 760, H = 200, P = { l: 34, r: 16, t: 14, b: 28 }
const hover = ref(null)
const x0 = computed(() => Math.min(...props.points.map((p) => +p.x)))
const x1 = computed(() => Math.max(...props.points.map((p) => +p.x)))
const X = (x) => P.l + ((+x - x0.value) / (x1.value - x0.value || 1)) * (W - P.l - P.r)
const Y = (y) => P.t + (1 - y / 100) * (H - P.t - P.b)
const d = computed(() => props.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(' '))
const area = computed(() => {
  const pts = props.points
  return `${d.value} L${X(pts[pts.length - 1].x)},${Y(0)} L${X(pts[0].x)},${Y(0)} Z`
})
const aria = computed(() => props.points.map((p) => `${p.label}: ${p.y}%`).join(', '))
</script>
