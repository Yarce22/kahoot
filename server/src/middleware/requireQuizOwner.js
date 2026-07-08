import supabase from '../lib/supabase.js'
import { httpError } from '../lib/httpError.js'

// requireQuizOwner — reusable ownership guard, created in PR1 but NOT wired
// into any route yet (routes are updated in PR2/PR3).
//
// Usage:
//   requireQuizOwner()                                   // req.params.id IS the quiz id
//   requireQuizOwner({ resource: 'question', paramName: 'id' })  // resolve via questions.quiz_id
//   requireQuizOwner({ resource: 'session', paramName: 'id' })   // resolve via game_sessions.quiz_id
//   requireQuizOwner({ resolve: async (req) => quizId })         // custom resolver
//
// In every case only owner_id is fetched from `quizzes` (single lookup) —
// never the full row.
export function requireQuizOwner(options = {}) {
  const { resource = 'quiz', paramName = 'id', resolve } = options

  return async function (req, res, next) {
    if (!req.admin) return next(httpError(401, 'Authentication required'))

    let quizId
    try {
      quizId = resolve ? await resolve(req) : await resolveQuizId(resource, paramName, req)
    } catch (err) {
      return next(err)
    }

    if (!quizId) return next(httpError(404, 'Resource not found'))

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('owner_id')
      .eq('id', quizId)
      .single()

    if (error || !quiz) return next(httpError(404, 'Quiz not found'))

    // Superadmins bypass ownership entirely — they can view and manage every
    // admin's content. A plain admin must own the quiz.
    if (req.admin.role !== 'superadmin' && quiz.owner_id !== req.admin.id) {
      return next(httpError(403, 'Not the quiz owner'))
    }

    next()
  }
}

async function resolveQuizId(resource, paramName, req) {
  const paramValue = req.params[paramName]

  if (resource === 'quiz') return paramValue

  if (resource === 'question') {
    const { data, error } = await supabase
      .from('questions')
      .select('quiz_id')
      .eq('id', paramValue)
      .single()
    if (error || !data) return null
    return data.quiz_id
  }

  if (resource === 'session') {
    const { data, error } = await supabase
      .from('game_sessions')
      .select('quiz_id')
      .eq('id', paramValue)
      .single()
    if (error || !data) return null
    return data.quiz_id
  }

  throw httpError(500, `requireQuizOwner: unknown resource type "${resource}"`)
}
