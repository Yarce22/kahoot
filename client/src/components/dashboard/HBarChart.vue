<template>
  <ul class="hbar" :aria-label="title">
    <li v-for="it in items" :key="it.key" class="row" :title="`${it.label}: ${it.value}% · ${it.caption}`">
      <div class="head">
        <span class="label" :title="it.label">{{ it.label }}</span>
        <span class="value">{{ it.value }}%</span>
      </div>
      <div
        class="track"
        role="progressbar"
        :aria-label="`${title}: ${it.label}`"
        :aria-valuenow="it.value"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="fill" :style="{ width: it.value + '%' }"></div>
      </div>
      <span class="caption">{{ it.caption }}</span>
    </li>
  </ul>
</template>

<script setup>
defineProps({
  // [{ key, label, value (0-100), caption }]
  items: { type: Array, required: true },
  title: { type: String, default: '' }
})
</script>

<style scoped>
.hbar { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; font-family: 'Nunito', sans-serif; color: var(--text-primary); }
.row { display: grid; gap: 4px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; font-size: 14px; }
.track { height: 12px; border-radius: 4px; background: var(--bg-elevated); overflow: hidden; }
.fill { height: 100%; border-radius: 0 4px 4px 0; background: var(--accent-green); }
.value { flex: none; font-weight: 800; font-size: 14px; }
.caption { color: var(--text-muted); font-size: 12px; }
</style>
