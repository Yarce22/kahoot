<template>
  <span class="sbadge" :style="{ '--c': STATUS_COLORS[label] }"><i></i>{{ label }}</span>
</template>

<script setup>
import { STATUS_COLORS } from '../../lib/progress.js'

defineProps({ label: { type: String, required: true } })
</script>
