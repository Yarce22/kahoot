<template>
  <ul class="hbar" :aria-label="title">
    <li v-for="it in items" :key="it.key" class="row" :title="`${it.label}: ${it.value}% · ${it.caption}`">
      <span class="label" :title="it.label">{{ it.label }}</span>
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
      <span class="value">{{ it.value }}%</span>
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
.row { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(80px, 2fr) 44px; grid-template-areas: 'label track value' 'caption caption caption'; align-items: center; gap: 2px 12px; }
.label { grid-area: label; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; font-size: 14px; }
.track { grid-area: track; height: 12px; border-radius: 4px; background: var(--bg-elevated); overflow: hidden; }
.fill { height: 100%; border-radius: 0 4px 4px 0; background: var(--accent-green); }
.value { grid-area: value; text-align: right; font-weight: 800; font-size: 14px; }
.caption { grid-area: caption; color: var(--text-muted); font-size: 12px; }
</style>
