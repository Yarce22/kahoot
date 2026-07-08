import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

function requireAdmin(to, from, next) {
  // Pinia is installed before the router in main.js, so the store is
  // available during navigation guards.
  if (!useAuthStore().isLoggedIn) return next('/admin/login')
  next()
}

function requireSuperadmin(to, from, next) {
  const auth = useAuthStore()
  if (!auth.isLoggedIn) return next('/admin/login')
  // A plain admin has no business on superadmin screens — bounce to their
  // own quiz list rather than showing a forbidden page.
  if (!auth.isSuperadmin) return next('/admin/quizzes')
  next()
}

const routes = [
  { path: '/', component: () => import('../views/HomeView.vue') },
  { path: '/lobby/:pin', component: () => import('../views/LobbyView.vue') },
  { path: '/game/:pin', component: () => import('../views/GameView.vue') },
  { path: '/results/:pin', component: () => import('../views/ResultsView.vue') },
  { path: '/leaderboard/:pin', component: () => import('../views/LeaderboardView.vue') },
  { path: '/admin/login', component: () => import('../views/admin/AdminLoginView.vue') },
  { path: '/admin/quizzes', component: () => import('../views/admin/QuizListView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/quizzes/new', component: () => import('../views/admin/QuizEditorView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/quizzes/:id', component: () => import('../views/admin/QuizEditorView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/quizzes/:id/sessions', component: () => import('../views/admin/QuizSessionsView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/sessions/:pin', component: () => import('../views/admin/SessionView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/admins', component: () => import('../views/admin/AdminsView.vue'), beforeEnter: requireSuperadmin },
]

export default createRouter({
  history: createWebHistory(),
  routes
})
