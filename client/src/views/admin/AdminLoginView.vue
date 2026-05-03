<template>
  <div class="admin-login">
    <h1>Admin Login</h1>
    <form @submit.prevent="submit">
      <label>
        Admin Token
        <input v-model="token" type="password" placeholder="Enter admin token" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit">Login</button>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth.js'

const token = ref('')
const error = ref('')
const router = useRouter()
const auth = useAuthStore()

function submit() {
  if (!token.value.trim()) {
    error.value = 'Token is required.'
    return
  }
  auth.login(token.value.trim())
  router.push('/admin/quizzes')
}
</script>
