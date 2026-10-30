<template>
  <div class="stack" :style="{ height: height + 'px', gap: '2px' }" role="img" :aria-label="label">
    <div v-if="!total" class="seg" style="flex: 1; background: var(--neutral-300)"></div>
    <div
      v-for="k in present"
      v-else
      :key="k"
      class="seg"
      :title="`${k}: ${counts[k]}`"
      :style="{ flex: counts[k], background: STATUS_COLORS[k] }"
    ></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { STATUS_COLORS, STATUS_ORDER } from '../../lib/progress.js'

const props = defineProps({ counts: { type: Object, required: true }, height: { type: Number, default: 14 } })
const total = computed(() => STATUS_ORDER.reduce((n, k) => n + props.counts[k], 0))
const present = computed(() => STATUS_ORDER.filter((k) => props.counts[k]))
const label = computed(() => STATUS_ORDER.map((k) => `${k}: ${props.counts[k]}`).join(', '))
</script>
