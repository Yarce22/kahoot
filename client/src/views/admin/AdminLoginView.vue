<template>
  <div class="admin-login-view view-transition-enter">
    <div class="card admin-login-card">
      <!-- Icon -->
      <div class="admin-login-icon" aria-hidden="true">🔐</div>

      <h1 class="admin-title">Panel Admin</h1>
      <p class="admin-subtitle">Ingresá con tu email y contraseña</p>

      <p v-if="resetSuccess" class="success-msg" role="status">Contraseña actualizada. Iniciá sesión con tu nueva contraseña.</p>

      <form @submit.prevent="submit" novalidate>
        <div class="auth-field">
          <label class="auth-field-label" for="email-input">Email</label>
          <input
            id="email-input"
            v-model="email"
            class="input-sm"
            type="email"
            placeholder="admin@ejemplo.com"
            required
            autocomplete="username"
          />
        </div>

        <div class="auth-field">
          <label class="auth-field-label" for="password-input">Contraseña</label>
          <input
            id="password-input"
            v-model="password"
            class="input-sm"
            type="password"
            placeholder="Ingresá tu contraseña"
            required
            autocomplete="current-password"
          />
        </div>

        <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 8px;" :disabled="loading">
          {{ loading ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>

      <router-link to="/forgot-password" class="auth-alt-link">¿Olvidaste tu contraseña?</router-link>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth.js'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const base = import.meta.env.VITE_API_BASE_URL || ''

// Shown after a successful password reset redirects back here with
// ?reset=success — see ResetPasswordView.vue.
const resetSuccess = route.query.reset === 'success'

async function submit() {
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = 'Email y contraseña son requeridos.'
    return
  }
  loading.value = true
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim(), password: password.value })
    })
    if (!res.ok) {
      error.value = res.status === 401
        ? 'Email o contraseña incorrectos.'
        : `No se pudo iniciar sesión (error ${res.status}).`
      return
    }
    const data = await res.json()
    auth.login(data.token, data.admin)
    router.push('/admin/quizzes')
  } catch (_) {
    error.value = 'No se pudo conectar con el servidor.'
  } finally {
    loading.value = false
  }
}
</script>
