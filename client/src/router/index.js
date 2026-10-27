import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { useUserAuthStore } from '../stores/userAuth.js'

function requireAdmin(to, from, next) {
  // Pinia is installed before the router in main.js, so the store is
  // available during navigation guards.
  if (!useAuthStore().isLoggedIn) return next('/admin/login')
  next()
}

// requireUsuario — mirrors requireAdmin exactly, but checks the SEPARATE
// usuario identity space (own token, own logged-in state) and bounces to
// / (the usuario login lives at the home route), not /admin/login — an
// admin session grants no access here and vice versa (design: aud=usuario
// vs aud=admin are different identities).
function requireUsuario(to, from, next) {
  if (!useUserAuthStore().isLoggedIn) return next('/')
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
  // Home IS the usuario login panel — this is the product's primary
  // audience now (employees with assigned exams), not anonymous PIN
  // players. The old PIN-join screen moved to /join.
  { path: '/', component: () => import('../views/user/UserLoginView.vue') },
  { path: '/join', component: () => import('../views/JoinGameView.vue') },
  { path: '/lobby/:pin', component: () => import('../views/LobbyView.vue') },
  { path: '/game/:pin', component: () => import('../views/GameView.vue') },
  { path: '/results/:pin', component: () => import('../views/ResultsView.vue') },
  { path: '/leaderboard/:pin', component: () => import('../views/LeaderboardView.vue') },
  // Usuario-facing routes — own top-level namespace, NOT nested under
  // /admin/, same reasoning that already puts /lobby/:pin and /game/:pin at
  // the top level: usuarios aren't admins.
  // Old direct entry point, kept as a redirect for anyone with the URL
  // bookmarked or linked from an old email/message.
  { path: '/user/login', redirect: '/' },
  { path: '/user/quizzes', component: () => import('../views/user/UserQuizzesView.vue'), beforeEnter: requireUsuario },
  { path: '/user/quizzes/:assignmentId/attempt', component: () => import('../views/user/UserAttemptView.vue'), beforeEnter: requireUsuario },
  { path: '/user/attempts/:id/result', component: () => import('../views/user/UserResultView.vue'), beforeEnter: requireUsuario },
  { path: '/admin/login', component: () => import('../views/admin/AdminLoginView.vue') },
  // Public and unauthenticated — hence top-level views, not views/admin/,
  // where everything else is either the login screen or behind a guard.
  { path: '/forgot-password', component: () => import('../views/ForgotPasswordView.vue') },
  { path: '/reset-password', component: () => import('../views/ResetPasswordView.vue') },
  // Same views for usuarios; the audience prop picks the API and login route.
  { path: '/user/forgot-password', component: () => import('../views/ForgotPasswordView.vue'), props: { audience: 'user' } },
  { path: '/user/reset-password', component: () => import('../views/ResetPasswordView.vue'), props: { audience: 'user' } },
  { path: '/admin/quizzes', component: () => import('../views/admin/QuizListView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/quizzes/new', component: () => import('../views/admin/QuizEditorView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/quizzes/:id', component: () => import('../views/admin/QuizEditorView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/quizzes/:id/sessions', component: () => import('../views/admin/QuizSessionsView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/quizzes/:id/sessions/:pin', component: () => import('../views/admin/SessionResultsView.vue'), beforeEnter: requireAdmin },
  // Async (assigned) exam attempt detail — separate from the PIN session
  // results above, since a quiz_attempts row has no `pin` to key on.
  { path: '/admin/quizzes/:id/attempts/:attemptId', component: () => import('../views/admin/AttemptResultView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/sessions/:pin', component: () => import('../views/admin/SessionView.vue'), beforeEnter: requireAdmin },
  { path: '/admin/admins', component: () => import('../views/admin/AdminsView.vue'), beforeEnter: requireSuperadmin },
  // requireAdmin, not requireSuperadmin: usuario management is store-scoped
  // for a plain admin, same authorization shape as the quiz routes.
  { path: '/admin/users', component: () => import('../views/admin/UsersView.vue'), beforeEnter: requireAdmin },
]

export default createRouter({
  history: createWebHistory(),
  routes
})
