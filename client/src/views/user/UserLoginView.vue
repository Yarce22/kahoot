<template>
  <div class="admin-login-view view-transition-enter">
    <div class="card admin-login-card">
      <div class="admin-login-icon" aria-hidden="true">🎓</div>

      <h1 class="admin-title">Mis exámenes</h1>
      <p class="admin-subtitle">Ingresá con tu email y contraseña</p>

      <form @submit.prevent="submit" novalidate>
        <div class="auth-field">
          <label class="auth-field-label" for="email-input">Email</label>
          <input
            id="email-input"
            v-model="email"
            class="input-sm"
            type="email"
            placeholder="usuario@ejemplo.com"
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
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserAuthStore } from '../../stores/userAuth.js'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useUserAuthStore()
const base = import.meta.env.VITE_API_BASE_URL || ''

// Raw fetch, not useUserApi — same reasoning as AdminLoginView: there is no
// token yet to attach, so the shared composable's Authorization-header logic
// has nothing to do here.
async function submit() {
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = 'Email y contraseña son requeridos.'
    return
  }
  loading.value = true
  try {
    const res = await fetch(`${base}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim(), password: password.value })
    })
    if (!res.ok) {
      // Anti-enumeration: unknown email, wrong password, and a deactivated
      // account all collapse into the identical 401 server-side, so the
      // client shows the same message for all of them — same shape as
      // AdminLoginView's 401 handling.
      error.value = res.status === 401
        ? 'Email o contraseña incorrectos.'
        : `No se pudo iniciar sesión (error ${res.status}).`
      return
    }
    const data = await res.json()
    auth.login(data.token, data.user)
    router.push('/user/quizzes')
  } catch (_) {
    error.value = 'No se pudo conectar con el servidor.'
  } finally {
    loading.value = false
  }
}
</script>
