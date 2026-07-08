<template>
  <div class="admins-view view-transition-enter">

    <!-- Header -->
    <div class="admins-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 14px;">
          ← Mis quizzes
        </router-link>
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary);">
          Administradores
        </h1>
      </div>
    </div>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <!-- Create admin -->
    <div class="card" style="padding: 24px; margin-bottom: 24px;">
      <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
        Crear administrador
      </h2>
      <form class="create-form" @submit.prevent="submitCreate" novalidate>
        <input v-model="form.email" class="input-sm" type="email" placeholder="email@ejemplo.com" autocomplete="off" />
        <input v-model="form.password" class="input-sm" type="password" placeholder="Contraseña" autocomplete="new-password" />
        <select v-model="form.role" class="input-sm">
          <option value="admin">Admin</option>
          <option value="superadmin">Superadmin</option>
        </select>
        <button type="submit" class="btn btn-primary" :disabled="creating">
          {{ creating ? 'Creando…' : 'Crear' }}
        </button>
      </form>
    </div>

    <!-- Admin list -->
    <p v-if="store.loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando…
    </p>

    <div v-else class="admin-list">
      <div
        v-for="a in store.admins"
        :key="a.id"
        class="card admin-row"
        :class="{ 'admin-row-inactive': !a.is_active }"
      >
        <div class="admin-row-info">
          <span class="admin-email">{{ a.email }}</span>
          <div class="admin-badges">
            <span class="badge" :class="a.role === 'superadmin' ? 'badge-super' : 'badge-plain'">
              {{ a.role === 'superadmin' ? 'Superadmin' : 'Admin' }}
            </span>
            <span v-if="!a.is_active" class="badge badge-inactive">Inactivo</span>
            <span v-if="a.id === auth.admin?.id" class="badge badge-you">Vos</span>
          </div>
        </div>

        <div class="admin-row-actions">
          <button
            v-if="a.role === 'admin'"
            class="btn-icon btn-promote"
            :disabled="busyId === a.id"
            @click="changeRole(a, 'superadmin')"
          >
            ↑ Superadmin
          </button>
          <button
            v-else
            class="btn-icon btn-demote"
            :disabled="busyId === a.id"
            @click="changeRole(a, 'admin')"
          >
            ↓ Admin
          </button>

          <button
            v-if="a.is_active"
            class="btn-icon btn-deactivate"
            :disabled="busyId === a.id || a.id === auth.admin?.id"
            :title="a.id === auth.admin?.id ? 'No podés desactivar tu propia cuenta' : ''"
            @click="setActive(a, false)"
          >
            Desactivar
          </button>
          <button
            v-else
            class="btn-icon btn-activate"
            :disabled="busyId === a.id"
            @click="setActive(a, true)"
          >
            Activar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAdminsStore } from '../../stores/admins.js'
import { useAuthStore } from '../../stores/auth.js'

const store = useAdminsStore()
const auth = useAuthStore()

const form = ref({ email: '', password: '', role: 'admin' })
const creating = ref(false)
const busyId = ref(null)
const errorMsg = ref('')

onMounted(() => store.fetchAdmins())

async function submitCreate() {
  errorMsg.value = ''
  if (!form.value.email.trim() || !form.value.password) {
    errorMsg.value = 'Email y contraseña son requeridos.'
    return
  }
  creating.value = true
  try {
    await store.createAdmin({
      email: form.value.email.trim(),
      password: form.value.password,
      role: form.value.role
    })
    form.value = { email: '', password: '', role: 'admin' }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    creating.value = false
  }
}

async function changeRole(admin, role) {
  await patch(admin, { role })
}

async function setActive(admin, is_active) {
  await patch(admin, { is_active })
}

async function patch(admin, changes) {
  errorMsg.value = ''
  busyId.value = admin.id
  try {
    await store.updateAdmin(admin.id, changes)
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    busyId.value = null
  }
}
</script>

<style scoped>
.admins-view {
  min-height: 100vh;
  padding: 32px 24px 40px;
  position: relative;
  z-index: 1;
}

.admins-header {
  margin-bottom: 24px;
}

.create-form {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.create-form .input-sm {
  flex: 1;
  min-width: 160px;
}

.admin-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.admin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  flex-wrap: wrap;
}

.admin-row-inactive {
  opacity: 0.6;
}

.admin-row-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.admin-email {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 15px;
  color: var(--text-primary);
}

.admin-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.badge {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 3px 10px;
  border-radius: 8px;
}

.badge-super    { background: rgba(155, 114, 245, 0.2); color: var(--accent-purple); }
.badge-plain    { background: rgba(61, 207, 207, 0.15); color: var(--accent-cyan); }
.badge-inactive { background: rgba(244, 99, 74, 0.15);  color: var(--accent-coral); }
.badge-you      { background: rgba(245, 200, 66, 0.15); color: var(--accent-yellow); }

.admin-row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  transition: all 0.15s;
}
.btn-icon:hover:not(:disabled) { filter: brightness(1.15); transform: translateY(-1px); }
.btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-promote    { background: rgba(155, 114, 245, 0.2); color: var(--accent-purple); }
.btn-demote     { background: rgba(61, 207, 207, 0.15); color: var(--accent-cyan); }
.btn-deactivate { background: rgba(244, 99, 74, 0.15);  color: var(--accent-coral); }
.btn-activate   { background: rgba(70, 217, 138, 0.15); color: var(--accent-green); }
</style>
