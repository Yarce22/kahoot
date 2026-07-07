<template>
  <div class="admin-login-view view-transition-enter">
    <div class="card admin-login-card">
      <!-- Icon -->
      <div class="admin-login-icon" aria-hidden="true">🔐</div>

      <h1 class="admin-title">Panel Admin</h1>
      <p class="admin-subtitle">Ingresá con tu email y contraseña</p>

      <form @submit.prevent="submit" novalidate>
        <div class="field-group">
          <label class="field-label-sm" for="email-input">Email</label>
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

        <div class="field-group">
          <label class="field-label-sm" for="password-input">Contraseña</label>
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
import { useAuthStore } from '../../stores/auth.js'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()
const base = import.meta.env.VITE_API_BASE_URL || ''

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

<style scoped>
.admin-login-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  position: relative;
  z-index: 1;
}

.admin-login-card {
  width: 100%;
  max-width: 400px;
  padding: 44px 40px;
  animation: fadeSlideUp 0.5s ease both;
}

.admin-login-icon {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: linear-gradient(135deg, var(--accent-purple), #7c50e8);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  margin: 0 auto 24px;
  box-shadow: 0 8px 24px rgba(155, 114, 245, 0.4);
}

.admin-title {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 28px;
  text-align: center;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.admin-subtitle {
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
  margin-bottom: 32px;
}

.field-group {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label-sm {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.8px;
}
</style>
