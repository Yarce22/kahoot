<template>
  <ul class="legend">
    <li v-for="k in STATUS_ORDER" :key="k" :data-testid="'legend-' + k">
      <span class="swatch" :style="{ background: STATUS_COLORS[k] }"></span>
      <span class="legend-label">{{ k }}</span>
      <strong>{{ counts[k] }}</strong>
      <span class="legend-pct">{{ total ? Math.round((counts[k] / total) * 100) : 0 }}%</span>
    </li>
  </ul>
</template>

<script setup>
import { computed } from 'vue'
import { STATUS_COLORS, STATUS_ORDER } from '../../lib/progress.js'

const props = defineProps({ counts: { type: Object, required: true } })
const total = computed(() => STATUS_ORDER.reduce((n, k) => n + props.counts[k], 0))
</script>
