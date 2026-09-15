<template>
  <div class="users-view view-transition-enter">

    <!-- Header -->
    <div class="users-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <router-link to="/admin/quizzes" class="btn btn-ghost" style="font-size: 14px; padding: 8px 14px;">
          ← Mis quizzes
        </router-link>
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary);">
          Usuarios
        </h1>
      </div>
    </div>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <!-- Create user -->
    <div class="card" style="padding: 24px; margin-bottom: 24px;">
      <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
        Crear usuario
      </h2>
      <form class="create-form" @submit.prevent="submitCreate" novalidate>
        <input id="full-name-input" v-model="form.full_name" class="input-sm" type="text" placeholder="Nombre completo" autocomplete="off" />
        <input id="email-input" v-model="form.email" class="input-sm" type="email" placeholder="email@ejemplo.com" autocomplete="off" />
        <input id="password-input" v-model="form.password" class="input-sm" type="password" placeholder="Contraseña (mín. 8 caracteres)" autocomplete="new-password" />
        <!-- Superadmin-only: a non-superadmin has no client-side way to know
             its own store (login response never included it), and the server
             defaults it to the caller's own store automatically when omitted. -->
        <select v-if="auth.isSuperadmin" id="punto-de-venta-select" v-model="form.punto_de_venta" class="input-sm">
          <option value="">Punto de venta (su propia tienda si se omite)</option>
          <option v-for="p in PUNTOS_DE_VENTA" :key="p" :value="p">{{ p }}</option>
        </select>
        <button type="submit" class="btn btn-primary" :disabled="creating">
          {{ creating ? 'Creando…' : 'Crear' }}
        </button>
      </form>
    </div>

    <!-- Search -->
    <div class="card" style="padding: 16px 20px; margin-bottom: 20px;">
      <input
        id="search-input"
        v-model="searchQuery"
        class="input-sm"
        type="text"
        placeholder="Buscar por nombre o email…"
        style="width: 100%;"
        @input="onSearch"
      />
    </div>

    <!-- User list -->
    <p v-if="store.loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando…
    </p>

    <div v-else class="user-list">
      <div
        v-for="u in store.users"
        :key="u.id"
        class="card user-row"
        :class="{ 'user-row-inactive': !u.is_active }"
      >
        <div class="user-row-info">
          <span class="user-name">{{ u.full_name }}</span>
          <span class="user-email">{{ u.email }}</span>
          <div class="user-badges">
            <span class="badge badge-plain">{{ u.punto_de_venta }}</span>
            <span v-if="!u.is_active" class="badge badge-inactive">Inactivo</span>
          </div>
        </div>

        <div class="user-row-actions">
          <button
            class="btn-icon btn-edit"
            :disabled="busyId === u.id"
            @click="openEdit(u)"
          >
            Editar
          </button>
          <button
            v-if="u.is_active"
            class="btn-icon btn-deactivate"
            :disabled="busyId === u.id"
            @click="setActive(u, false)"
          >
            Desactivar
          </button>
          <button
            v-else
            class="btn-icon btn-activate"
            :disabled="busyId === u.id"
            @click="setActive(u, true)"
          >
            Activar
          </button>
        </div>
      </div>

      <p
        v-if="!store.users.length"
        style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700; text-align: center; margin-top: 20px;"
      >
        No hay usuarios para mostrar.
      </p>
    </div>

    <!-- Pagination -->
    <div class="pagination">
      <button class="btn btn-ghost" :disabled="store.page <= 1" @click="goToPage(store.page - 1)">
        Anterior
      </button>
      <span class="pagination-info">Página {{ store.page }} de {{ totalPages }}</span>
      <button class="btn btn-ghost" :disabled="store.page * store.pageSize >= store.total" @click="goToPage(store.page + 1)">
        Siguiente
      </button>
    </div>

    <!-- Edit popup — inline markup, not a reusable component: same pattern
         as AdminsView.vue's edit popup. -->
    <div v-if="editingUser" class="edit-overlay" @click.self="closeEdit">
      <div class="card edit-popup">
        <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
          Editar usuario
        </h2>
        <div class="edit-form">
          <input id="edit-full-name-input" v-model="editForm.full_name" class="input-sm" type="text" placeholder="Nombre completo" autocomplete="off" />
          <!-- Superadmin-only, same reason as the create form: a non-superadmin
               has no way to move a usuario to another store — the server only
               ever allows same-store writes for them. -->
          <select v-if="auth.isSuperadmin" id="edit-punto-de-venta-select" v-model="editForm.punto_de_venta" class="input-sm">
            <option v-for="p in PUNTOS_DE_VENTA" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="edit-actions">
          <button type="button" class="btn btn-ghost" :disabled="busyId === editingUser.id" @click="closeEdit">
            Cancelar
          </button>
          <button type="button" class="btn btn-primary" :disabled="busyId === editingUser.id" @click="submitEdit">
            {{ busyId === editingUser.id ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useUsersStore } from '../../stores/users.js'
import { useAuthStore } from '../../stores/auth.js'
import { PUNTOS_DE_VENTA } from '../../lib/puntosDeVenta.js'

const store = useUsersStore()
const auth = useAuthStore()

const form = ref({ full_name: '', email: '', password: '', punto_de_venta: '' })
const creating = ref(false)
const busyId = ref(null)
const errorMsg = ref('')
const searchQuery = ref('')

const editingUser = ref(null)
const editForm = ref({ full_name: '', punto_de_venta: '' })

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

onMounted(() => store.fetchUsers())

function onSearch() {
  store.fetchUsers({ page: 1, q: searchQuery.value })
}

function goToPage(page) {
  store.fetchUsers({ page, q: searchQuery.value })
}

async function submitCreate() {
  errorMsg.value = ''
  if (!form.value.full_name.trim() || !form.value.email.trim() || !form.value.password) {
    errorMsg.value = 'Nombre, email y contraseña son requeridos.'
    return
  }
  if (form.value.password.length < 8) {
    errorMsg.value = 'La contraseña debe tener al menos 8 caracteres.'
    return
  }
  creating.value = true
  try {
    const payload = {
      full_name: form.value.full_name.trim(),
      email: form.value.email.trim(),
      password: form.value.password
    }
    // Superadmin-only control: omitted entirely for a non-superadmin so the
    // server's own-store default applies (see UsersView's Design decisions).
    if (auth.isSuperadmin && form.value.punto_de_venta) {
      payload.punto_de_venta = form.value.punto_de_venta
    }
    await store.createUser(payload)
    form.value = { full_name: '', email: '', password: '', punto_de_venta: '' }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    creating.value = false
  }
}

function openEdit(user) {
  errorMsg.value = ''
  editingUser.value = user
  editForm.value = { full_name: user.full_name, punto_de_venta: user.punto_de_venta }
}

function closeEdit() {
  editingUser.value = null
}

async function submitEdit() {
  const user = editingUser.value
  if (!user) return
  const trimmedName = editForm.value.full_name.trim()
  if (!trimmedName) {
    errorMsg.value = 'El nombre no puede estar vacío.'
    return
  }
  errorMsg.value = ''
  busyId.value = user.id
  try {
    const changes = { full_name: trimmedName }
    // Superadmin-only: a non-superadmin's store can't be changed through this
    // popup (see the template comment above the select for why).
    if (auth.isSuperadmin) changes.punto_de_venta = editForm.value.punto_de_venta
    await store.updateUser(user.id, changes)
    editingUser.value = null
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    busyId.value = null
  }
}

async function setActive(user, is_active) {
  await patch(user, { is_active })
}

async function patch(user, changes) {
  errorMsg.value = ''
  busyId.value = user.id
  try {
    await store.updateUser(user.id, changes)
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    busyId.value = null
  }
}
</script>

<style scoped>
.users-view {
  min-height: 100vh;
  padding: 32px 24px 40px;
  position: relative;
  z-index: 1;
}

.users-header {
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

.user-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  flex-wrap: wrap;
}

.user-row-inactive {
  opacity: 0.6;
}

.user-row-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-name {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 15px;
  color: var(--text-primary);
}

.user-email {
  font-family: 'Nunito', sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: var(--text-secondary);
}

.user-badges {
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

.badge-plain    { background: rgba(61, 207, 207, 0.15); color: var(--accent-cyan); }
.badge-inactive { background: rgba(244, 99, 74, 0.15);  color: var(--accent-coral); }

.user-row-actions {
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

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
}

.pagination-info {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
