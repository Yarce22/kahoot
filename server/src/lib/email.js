import { Resend } from 'resend'

let cachedClient = null

// getClient — lazily builds the Resend client so importing this module
// never throws just because env vars aren't set yet (e.g. at test-collection
// time); the clear failure only happens when an email is actually sent.
function getClient() {
  if (cachedClient) return cachedClient

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set — cannot send email')
  }

  cachedClient = new Resend(apiKey)
  return cachedClient
}

// Exported as a plain mutable object (default export), the same pattern
// `lib/supabase.js` uses — it lets tests swap `email.sendPasswordResetEmail`
// with a stub (via node:test's `mock.method`, as in auth.login.test.js'
// bcrypt.compare spy) instead of hitting the real Resend API.
const email = {
  // sendPasswordResetEmail — MVP plain-text email with the reset link.
  // Throws (rather than failing silently) if RESEND_API_KEY/RESEND_FROM_EMAIL
  // are missing or the Resend API call itself errors, so callers can decide
  // how to surface/log the failure.
  async sendPasswordResetEmail({ to, resetUrl }) {
    const from = process.env.RESEND_FROM_EMAIL
    if (!from) {
      throw new Error('RESEND_FROM_EMAIL is not set — cannot send email')
    }

    const resend = getClient()

    // Sandbox-only stopgap: Resend refuses to deliver to anyone but your own
    // account email until a sending domain is verified. Setting this env var
    // reroutes every reset email to that address regardless of which admin
    // requested it, so the flow can be tested end-to-end with real admins
    // before a domain is verified. SECURITY: whoever holds this inbox can
    // then reset any admin's password — remove this env var before real
    // production use with admins you don't control.
    const overrideTo = process.env.RESEND_SANDBOX_OVERRIDE_TO
    const recipient = overrideTo || to
    const text = overrideTo
      ? `[Sandbox override — solicitado para: ${to}]\n\nRecibimos una solicitud para restablecer tu contraseña.\n\nUsá este enlace para elegir una nueva contraseña (vence en 30 minutos):\n${resetUrl}\n\nSi no fuiste vos, podés ignorar este email.`
      : `Recibimos una solicitud para restablecer tu contraseña.\n\nUsá este enlace para elegir una nueva contraseña (vence en 30 minutos):\n${resetUrl}\n\nSi no fuiste vos, podés ignorar este email.`

    const { error } = await resend.emails.send({
      from,
      to: recipient,
      subject: 'Restablecé tu contraseña',
      text
    })

    if (error) {
      throw new Error(`Failed to send password reset email: ${error.message ?? error}`)
    }
  }
}

export default email
