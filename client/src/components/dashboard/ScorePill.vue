<template>
  <span v-if="value == null" class="score-pill is-empty">—</span>
  <span v-else class="score-pill" :style="{ '--c': scoreColor(value) }">{{ value }}%</span>
</template>

<script setup>
import { scoreColor } from '../../lib/progress.js'

defineProps({ value: { type: Number, default: null } })
</script>
