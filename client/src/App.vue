<template>
  <div class="app-shell">
    <!-- Background decoration layers -->
    <div class="bg-dots" aria-hidden="true"></div>
    <div class="bg-gradient" aria-hidden="true"></div>

    <!-- App content -->
    <RouterView />
    <ToastContainer />
  </div>
</template>

<script setup>
import ToastContainer from './components/ToastContainer.vue'
</script>
