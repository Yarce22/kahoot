<template>
  <div class="admin-login-view view-transition-enter">
    <div class="card admin-login-card">
      <div class="admin-login-icon" aria-hidden="true">✉️</div>

      <h1 class="admin-title">Recuperar contraseña</h1>
      <p class="admin-subtitle">Ingresá tu email y te enviaremos un enlace para restablecerla</p>

      <form v-if="!sent" @submit.prevent="submit" novalidate>
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

        <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 8px;" :disabled="loading">
          {{ loading ? 'Enviando…' : 'Enviar enlace' }}
        </button>
      </form>

      <p v-else class="success-msg" role="status">{{ message }}</p>

      <router-link to="/admin/login" class="auth-alt-link">Volver a iniciar sesión</router-link>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const email = ref('')
const error = ref('')
const message = ref('')
const loading = ref(false)
const sent = ref(false)
const base = import.meta.env.VITE_API_BASE_URL || ''

async function submit() {
  error.value = ''
  if (!email.value.trim()) {
    error.value = 'El email es requerido.'
    return
  }
  loading.value = true
  try {
    const res = await fetch(`${base}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim() })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      error.value = data.error || `No se pudo enviar el enlace (error ${res.status}).`
      return
    }
    // The server always returns the same generic confirmation message
    // regardless of whether the email is registered — shown verbatim so
    // the client never has to guess/duplicate that anti-enumeration copy.
    message.value = data.message
    sent.value = true
  } catch (_) {
    error.value = 'No se pudo conectar con el servidor.'
  } finally {
    loading.value = false
  }
}
</script>

