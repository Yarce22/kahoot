<template>
  <div class="home-view view-transition-enter">
    <!-- Floating background shapes -->
    <div class="floating-shapes" aria-hidden="true">
      <div class="shape shape-1"></div>
      <div class="shape shape-2"></div>
      <div class="shape shape-3"></div>
      <div class="shape shape-4"></div>
    </div>

    <!-- Logo -->
    <div class="home-logo-big" aria-label="Bianco Examenes">Bianco <span class="logo-line">Examenes</span></div>
    <p class="home-tagline">Tus exámenes asignados, en un solo lugar 🎓</p>

    <div class="card admin-login-card">
      <h1 class="admin-title">Mis exámenes</h1>
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

      <router-link to="/user/forgot-password" class="auth-alt-link">¿Olvidaste tu contraseña?</router-link>
    </div>

    <!-- Alternate entry points -->
    <p class="home-footer-link">
      ¿Querés unirte a un juego con PIN?
      <router-link to="/join" class="home-admin-link">Entrá acá</router-link>
    </p>
    <p class="home-footer-link">
      ¿Sos el host?
      <router-link to="/admin/login" class="home-admin-link">Accedé al panel de administración</router-link>
    </p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserAuthStore } from '../../stores/userAuth.js'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const route = useRoute()
const auth = useUserAuthStore()
const base = import.meta.env.VITE_API_BASE_URL || ''

// Shown after a successful password reset redirects back here with
// ?reset=success — see ResetPasswordView.vue.
const resetSuccess = route.query.reset === 'success'

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

<style scoped>
.home-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  position: relative;
  z-index: 1;
}

.home-logo-big {
  font-family: 'Nunito', sans-serif;
  text-align: center;
  font-weight: 900;
  font-size: clamp(42px, 10vw, 72px);
  background: linear-gradient(135deg, var(--accent-yellow) 0%, var(--accent-coral) 50%, var(--accent-purple) 100%);
  background-size: 200% auto;
  animation: gradientShift 4s ease infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 8px;
}

.home-tagline {
  color: var(--text-secondary);
  font-size: 16px;
  margin-bottom: 48px;
  text-align: center;
}

/* Floating background shapes */
.floating-shapes {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.shape {
  position: absolute;
  border-radius: 50%;
  opacity: 0.06;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-cyan));
}

.shape-1 { width: 220px; height: 220px; top: 15%; left: 5%;  animation: floatDot 4s ease-in-out 0s infinite; }
.shape-2 { width: 140px; height: 140px; top: 60%; left: 75%; animation: floatDot 6s ease-in-out 2s infinite; }
.shape-3 { width:  80px; height:  80px; top: 35%; left: 60%; animation: floatDot 5s ease-in-out 1s infinite; }
.shape-4 { width: 100px; height: 100px; top: 75%; left: 10%; animation: floatDot 7s ease-in-out 3s infinite; }

.home-footer-link {
  margin-top: 16px;
  color: var(--text-muted);
  font-size: 13px;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  text-align: center;
}

.home-admin-link {
  color: var(--accent-cyan);
  text-decoration: underline;
  cursor: pointer;
}
</style>
