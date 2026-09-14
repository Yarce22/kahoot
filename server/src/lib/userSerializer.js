// userSerializer — the structural half of the "no correct-answer leak to a
// usuario" guarantee (spec: Structural No-Leak of Correct Answers to Usuario).
//
// Every /api/user/* response is built here field-by-field (never a spread of
// a raw DB row), and in camelCase, while every leaky column is snake_case at
// the source (is_correct, correct_option_id). That makes the leak check a
// flat, mechanical assertion: assertNoAnswerLeak walks a serialized payload
// and throws if it finds ANY snake_case OR camelCase spelling of a forbidden
// key, at any nesting depth.
//
// Highest-risk vector, called out explicitly (design D5): for type === 'open'
// questions, the correct answer's keyword CSV IS the text of the is_correct
// option (see server/src/domain/openAnswer.js / sockets/index.js). Dropping
// is_correct alone would still ship the answer in plain text via `text` —
// so serializeQuestionForUser emits `options: []` for open questions instead.

// SAFE_QUESTION_SELECT — the literal supabase `.select()` string for reading
// a question + its options for a usuario-facing response. Deliberately never
// requests answer_options.is_correct, so the leak cannot happen at the query
// layer either — grading re-queries options through a separate,
// admin-scoped read inside attemptEngine.
export const SAFE_QUESTION_SELECT = 'id, text, type, order_index, answer_options(id, text)'

// Both spellings of every leaky concept: snake_case is what the DB layer
// emits (is_correct, correct_option_id) and camelCase is what the domain
// layer emits — attemptEngine's gradeAnswer/gradeAttempt return `isCorrect`,
// which was missing here and is the likeliest real leak vector of all.
export const FORBIDDEN_KEYS = [
  'is_correct',
  'isCorrect',
  'correct_option_id',
  'correctOptionId',
  'correct_option_ids',
  'correctOptionIds',
  'correct_answer_text',
  'correctAnswerText'
]

const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_KEYS)

// serializeQuestionForUser — question + options shaped for a usuario. Never
// spreads the raw row: only the fields listed below are copied over.
export function serializeQuestionForUser(question) {
  const isOpen = question.type === 'open'
  return {
    id: question.id,
    text: question.text,
    type: question.type,
    orderIndex: question.order_index,
    // Open questions never expose options at all — see module doc above.
    options: isOpen
      ? []
      : (question.answer_options ?? []).map((option) => ({ id: option.id, text: option.text }))
  }
}

// assertNoAnswerLeak — deep-walks any JSON-shaped value (objects, arrays,
// nested combinations) and throws the moment it finds a key from
// FORBIDDEN_KEYS, at any depth. Used as a contract-test assertion run
// against every /api/user/* response body.
export function assertNoAnswerLeak(payload, path = '$') {
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertNoAnswerLeak(item, `${path}[${index}]`))
    return
  }

  if (payload !== null && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (FORBIDDEN_KEY_SET.has(key)) {
        throw new Error(`assertNoAnswerLeak: forbidden key "${key}" found at ${path}.${key}`)
      }
      assertNoAnswerLeak(value, `${path}.${key}`)
    }
  }
}
