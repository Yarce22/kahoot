<template>
  <div class="admin-login-view view-transition-enter">
    <div class="card admin-login-card">
      <div class="admin-login-icon" aria-hidden="true">🔑</div>

      <h1 class="admin-title">Elegir nueva contraseña</h1>
      <p class="admin-subtitle">Ingresá tu nueva contraseña dos veces para confirmarla</p>

      <p v-if="!token" class="error-msg" role="alert">
        El enlace no es válido. Solicitá uno nuevo desde
        <router-link to="/forgot-password">recuperar contraseña</router-link>.
      </p>

      <form v-else @submit.prevent="submit" novalidate>
        <div class="auth-field">
          <label class="auth-field-label" for="password-input">Nueva contraseña</label>
          <input
            id="password-input"
            v-model="password"
            class="input-sm"
            type="password"
            placeholder="Ingresá tu nueva contraseña"
            required
            autocomplete="new-password"
          />
        </div>

        <div class="auth-field">
          <label class="auth-field-label" for="confirm-password-input">Confirmar contraseña</label>
          <input
            id="confirm-password-input"
            v-model="confirmPassword"
            class="input-sm"
            type="password"
            placeholder="Repetí tu nueva contraseña"
            required
            autocomplete="new-password"
          />
        </div>

        <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 8px;" :disabled="loading">
          {{ loading ? 'Guardando…' : 'Guardar contraseña' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const token = ref(typeof route.query.token === 'string' ? route.query.token : '')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const base = import.meta.env.VITE_API_BASE_URL || ''

async function submit() {
  error.value = ''
  if (!password.value || !confirmPassword.value) {
    error.value = 'Completá ambos campos de contraseña.'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'Las contraseñas no coinciden.'
    return
  }
  loading.value = true
  try {
    const res = await fetch(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.value, password: password.value })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      error.value = data.error || `No se pudo restablecer la contraseña (error ${res.status}).`
      return
    }
    router.push({ path: '/admin/login', query: { reset: 'success' } })
  } catch (_) {
    error.value = 'No se pudo conectar con el servidor.'
  } finally {
    loading.value = false
  }
}
</script>

