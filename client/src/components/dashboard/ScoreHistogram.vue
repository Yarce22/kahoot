<template>
  <div class="histo">
    <div v-for="b in buckets" :key="b.label" class="histo-col" :title="`${b.label}%: ${b.n}`">
      <span class="histo-n" :data-testid="'histo-' + b.label">{{ b.n }}</span>
      <div class="histo-track"><div class="histo-bar" :style="{ height: (b.n / max) * 100 + '%', background: b.color }"></div></div>
      <span class="histo-l">{{ b.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { scoreBuckets } from '../../lib/progress.js'

const props = defineProps({ scores: { type: Array, required: true } })
const buckets = computed(() => scoreBuckets(props.scores))
const max = computed(() => Math.max(1, ...buckets.value.map((b) => b.n)))
</script>
