<template>
  <div
    class="ring"
    :style="{ width: size + 'px', height: size + 'px' }"
    role="progressbar"
    :aria-valuenow="value"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="label"
  >
    <svg :width="size" :height="size" aria-hidden="true">
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" stroke="var(--neutral-300)" :stroke-width="stroke" />
      <circle
        :cx="size / 2" :cy="size / 2" :r="r" fill="none" stroke="var(--salvia-700)" :stroke-width="stroke"
        stroke-linecap="round" :stroke-dasharray="c" :stroke-dashoffset="c * (1 - value / 100)"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`" style="transition: stroke-dashoffset .6s ease"
      />
    </svg>
    <div class="ring-center"><slot /></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, required: true },
  label: { type: String, default: 'Avance' },
  size: { type: Number, default: 132 },
  stroke: { type: Number, default: 12 }
})
const r = computed(() => (props.size - props.stroke) / 2)
const c = computed(() => 2 * Math.PI * r.value)
</script>
