// Per-audience wiring for the shared ForgotPasswordView / ResetPasswordView:
// which API the forms hit and where the user lands around the flow.
export const RECOVERY_AUDIENCES = {
  admin: { apiBase: '/api/auth', loginPath: '/admin/login', forgotPath: '/forgot-password', emailPlaceholder: 'admin@ejemplo.com' },
  user: { apiBase: '/api/user/auth', loginPath: '/', forgotPath: '/user/forgot-password', emailPlaceholder: 'usuario@ejemplo.com' }
}
