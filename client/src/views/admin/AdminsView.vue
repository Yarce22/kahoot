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
        <input id="name-input" v-model="form.name" class="input-sm" type="text" placeholder="Nombre (opcional)" autocomplete="off" />
        <input id="email-input" v-model="form.email" class="input-sm" type="email" placeholder="email@ejemplo.com" autocomplete="off" />
        <input id="password-input" v-model="form.password" class="input-sm" type="password" placeholder="Contraseña" autocomplete="new-password" />
        <select v-model="form.role" class="input-sm">
          <option value="admin">Admin</option>
          <option value="superadmin">Superadmin</option>
        </select>
        <!-- Required by the API: admins.punto_de_venta is NOT NULL with no
             default, so a creation without a store is rejected with a 400. -->
        <select id="punto-de-venta-select" v-model="form.punto_de_venta" class="input-sm">
          <option value="" disabled>Punto de venta…</option>
          <option v-for="p in PUNTOS_DE_VENTA" :key="p" :value="p">{{ p }}</option>
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
          <template v-if="a.name">
            <span class="admin-name">{{ a.name }}</span>
            <span class="admin-email admin-email-secondary">{{ a.email }}</span>
          </template>
          <span v-else class="admin-email">{{ a.email }}</span>
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
            class="btn-icon btn-edit"
            :disabled="busyId === a.id"
            @click="openEdit(a)"
          >
            Editar
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

    <!-- Edit popup — inline markup, not a reusable component: this is the
         only place in the client a modal exists at all, and it has exactly
         one caller. -->
    <div v-if="editingAdmin" class="edit-overlay" @click.self="closeEdit">
      <div class="card edit-popup">
        <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
          Editar administrador
        </h2>
        <div class="edit-form">
          <input id="edit-name-input" v-model="editForm.name" class="input-sm" type="text" placeholder="Nombre (opcional)" autocomplete="off" />
          <select id="edit-role-select" v-model="editForm.role" class="input-sm">
            <option value="admin">Admin</option>
            <option value="superadmin">Superadmin</option>
          </select>
          <select id="edit-punto-de-venta-select" v-model="editForm.punto_de_venta" class="input-sm">
            <option v-for="p in PUNTOS_DE_VENTA" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="edit-actions">
          <button type="button" class="btn btn-ghost" :disabled="busyId === editingAdmin.id" @click="closeEdit">
            Cancelar
          </button>
          <button type="button" class="btn btn-primary" :disabled="busyId === editingAdmin.id" @click="submitEdit">
            {{ busyId === editingAdmin.id ? 'Guardando…' : 'Guardar' }}
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
import { PUNTOS_DE_VENTA } from '../../lib/puntosDeVenta.js'

const store = useAdminsStore()
const auth = useAuthStore()

const form = ref({ name: '', email: '', password: '', role: 'admin', punto_de_venta: '' })
const creating = ref(false)
const busyId = ref(null)
const errorMsg = ref('')

const editingAdmin = ref(null)
const editForm = ref({ name: '', role: 'admin', punto_de_venta: '' })

onMounted(() => store.fetchAdmins())

async function submitCreate() {
  errorMsg.value = ''
  if (!form.value.email.trim() || !form.value.password) {
    errorMsg.value = 'Email y contraseña son requeridos.'
    return
  }
  // Checked client-side too so the operator sees the problem next to the
  // control instead of as a round-trip 400 from the API.
  if (!form.value.punto_de_venta) {
    errorMsg.value = 'Elegí un punto de venta.'
    return
  }
  creating.value = true
  try {
    await store.createAdmin({
      name: form.value.name.trim() || null,
      email: form.value.email.trim(),
      password: form.value.password,
      role: form.value.role,
      punto_de_venta: form.value.punto_de_venta
    })
    form.value = { name: '', email: '', password: '', role: 'admin', punto_de_venta: '' }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    creating.value = false
  }
}

function openEdit(admin) {
  errorMsg.value = ''
  editingAdmin.value = admin
  editForm.value = { name: admin.name ?? '', role: admin.role, punto_de_venta: admin.punto_de_venta }
}

function closeEdit() {
  editingAdmin.value = null
}

async function submitEdit() {
  const admin = editingAdmin.value
  if (!admin) return
  errorMsg.value = ''
  busyId.value = admin.id
  try {
    await store.updateAdmin(admin.id, {
      name: editForm.value.name.trim() || null,
      role: editForm.value.role,
      punto_de_venta: editForm.value.punto_de_venta
    })
    editingAdmin.value = null
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    busyId.value = null
  }
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

.admin-name {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 15px;
  color: var(--text-primary);
}

.admin-email {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 15px;
  color: var(--text-primary);
}

.admin-email-secondary {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-secondary);
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

.btn-edit       { background: rgba(155, 114, 245, 0.2); color: var(--accent-purple); }
.btn-deactivate { background: rgba(244, 99, 74, 0.15);  color: var(--accent-coral); }
.btn-activate   { background: rgba(70, 217, 138, 0.15); color: var(--accent-green); }

.edit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  padding: 20px;
}

.edit-popup {
  width: 100%;
  max-width: 420px;
  padding: 24px;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.edit-form .input-sm {
  width: 100%;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
