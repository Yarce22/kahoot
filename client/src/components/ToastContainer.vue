<template>
  <div class="toast-container" role="status" aria-live="polite" aria-atomic="false">
    <div
      v-for="t in toasts"
      :key="t.id"
      :class="['toast', `toast--${t.type}`]"
      role="alert"
    >
      <span>{{ t.message }}</span>
      <button @click="remove(t.id)" aria-label="Dismiss notification">✕</button>
    </div>
  </div>
</template>

<script setup>
import { useToast } from '../composables/useToast.js'
const { toasts, remove } = useToast()
</script>
