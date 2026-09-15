import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
// Mirrors src/index.js:2 — without it an async throw inside a route handler
// never reaches errorHandler, so a crash-class bug hangs the request instead
// of surfacing as a clean 500.
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { userQuizzesRouter } = await import('../src/routes/userQuizzes.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { assertNoAnswerLeak } = await import('../src/lib/userSerializer.js')
const { default: request } = await import('supertest')

// Standalone app — userQuizzesRouter is not mounted in src/index.js until
// task 8.1 of this same PR3 batch.
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/user', userQuizzesRouter)
  app.use(errorHandler)
  return app
}

const USER = { id: 'user-1', email: 'u@example.com', full_name: 'Ana Usuaria', punto_de_venta: 'Cerritos', is_active: true }
const userToken = () => signToken({ sub: USER.id, email: USER.email, aud: 'usuario' })
const ASSIGNMENT_UUID = '11111111-1111-4111-8111-111111111111'
const ATTEMPT_UUID = '33333333-3333-4333-8333-333333333333'
const QUESTION_UUID = '44444444-4444-4444-8444-444444444444'
// answer_options.id is a uuid column (selected_option_id is an FK to it), so
// the route now requires a UUID-shaped selectedOptionId.
const OPTION_UUID = '66666666-6666-4666-8666-666666666666'

// stripOwnAnswerVerdict — the ONE documented exception to a flat
// assertNoAnswerLeak scan: a usuario's own result legitimately carries their
// own answer's isCorrect verdict (design D5, spec: "each answer includes
// only its own is_correct plus aggregate counts"). userSerializer's
// FORBIDDEN_KEYS deliberately treats bare isCorrect as forbidden too — it is
// "the likeliest real leak vector of all" for an IN-PROGRESS/option-level
// payload — so this helper removes ONLY that one already-reviewed field
// before scanning a submit/result response for everything else. It does NOT
// touch is_correct (snake_case) or any correct-option-identifier spelling,
// which stay forbidden everywhere, including here.
//
// The exception is punched at an explicit PATH — result.answers[*].isCorrect —
// not by key name at arbitrary depth. A JSON reviver keyed on the string
// 'isCorrect' erased EVERY such key everywhere, which silently widened the
// hole to cover anything that happened to live inside, under, or beside one:
// a per-option `options[].isCorrect` correct flag, or a correctAnswer nested
// under an isCorrect key, both sailed through the scan untouched. Deleting the
// element's OWN key and nothing else keeps the hole exactly the size of the
// documented exception.
function stripOwnAnswerVerdict(payload) {
  const clone = JSON.parse(JSON.stringify(payload))
  const answers = clone?.result?.answers
  if (Array.isArray(answers)) {
    for (const answer of answers) {
      if (answer !== null && typeof answer === 'object' && !Array.isArray(answer)) {
        delete answer.isCorrect
      }
    }
  }
  return clone
}

// --- the scan helper itself ---

// The helper above is the ONE hole deliberately punched in an otherwise
// mechanical assertion, so it has to be exactly the size of the legitimate
// exception. A bare key-name reviver at arbitrary depth was far too wide: any
// future leak that happened to live inside — or under — an `isCorrect` key was
// erased before the scan ever saw it. Each case below PASSED the old helper.
test('no-leak scan: a per-option isCorrect flag inside an answer is still caught', () => {
  const optionLevelLeak = {
    result: {
      attemptId: 'a1',
      answers: [
        {
          questionId: 'q1',
          // legitimate: the caller's own verdict
          isCorrect: true,
          // leak: the per-OPTION correct flag, which is answer-key data
          options: [{ id: 'o1', text: 'Yes', isCorrect: true }, { id: 'o2', text: 'No', isCorrect: false }]
        }
      ]
    }
  }
  assert.throws(() => assertNoAnswerLeak(stripOwnAnswerVerdict(optionLevelLeak)))
})

test('no-leak scan: an isCorrect outside the result.answers path is still caught', () => {
  const misplacedVerdict = {
    result: {
      attemptId: 'a1',
      answers: [{ questionId: 'q1', isCorrect: true }],
      // leak: anything else carrying a correctness flag is NOT the documented
      // exception, wherever it sits.
      summary: { isCorrect: { correctAnswer: 'lechuga, tomate' } }
    }
  }
  assert.throws(() => assertNoAnswerLeak(stripOwnAnswerVerdict(misplacedVerdict)))
})

test('no-leak scan: a plaintext correctAnswer is caught — the exact key the admin route uses', () => {
  const adminShapedLeak = {
    result: {
      attemptId: 'a1',
      answers: [{ questionId: 'q1', isCorrect: true, correctAnswer: 'lechuga, tomate' }]
    }
  }
  assert.throws(() => assertNoAnswerLeak(stripOwnAnswerVerdict(adminShapedLeak)))
  assert.throws(() => assertNoAnswerLeak(stripOwnAnswerVerdict({ result: { answers: [{ correct_answer: 'x' }] } })))
})

test('no-leak scan: the legitimate own-verdict payload still passes once the leaks are gone', () => {
  const clean = {
    result: {
      attemptId: 'a1',
      answers: [{ questionId: 'q1', questionText: 'Q1?', answerText: 'Yes', isCorrect: true }]
    }
  }
  assert.doesNotThrow(() => assertNoAnswerLeak(stripOwnAnswerVerdict(clean)))
})

// --- GET /quizzes ---

test('no-leak: GET /api/user/quizzes response carries no correct-answer data', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [{ id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', cycle: 1, status: 'pending', assigned_at: 'x', quiz: { id: 'quiz-1', title: 'Quiz', description: null, total_time_seconds: 600 } }],
        error: null
      }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/quizzes').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.doesNotThrow(() => assertNoAnswerLeak(res.body))
  } finally {
    restore()
  }
})

// --- POST /quizzes/:assignmentId/attempt (start) ---

// Highest-risk leak vector (design D5): for an 'open' question, the correct
// answer's keyword CSV IS the text of the is_correct option. Dropping
// is_correct alone would still ship the answer in plain text via `text` — so
// the serializer must emit `options: []` for open questions.
test('no-leak: start-attempt payload for an open-type question serializes options: [] and carries no leak', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, started_at: 'a', expires_at: 'b', time_budget_seconds: 600 }, error: null } },
    {
      table: 'questions',
      result: {
        data: [
          { id: QUESTION_UUID, text: 'What goes in a salad?', type: 'open', order_index: 1, answer_options: [{ id: 'o1', text: 'lechuga, tomate, cebolla' }] }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.questions[0].options, [])
    assert.doesNotThrow(() => assertNoAnswerLeak(res.body))
  } finally {
    restore()
  }
})

test('no-leak: start-attempt payload for a closed-type question exposes only option id+text', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, started_at: 'a', expires_at: 'b', time_budget_seconds: 600 }, error: null } },
    {
      table: 'questions',
      result: {
        data: [
          { id: QUESTION_UUID, text: 'Closed?', type: 'closed', order_index: 1, answer_options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }] }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.questions[0].options, [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }])
    assert.doesNotThrow(() => assertNoAnswerLeak(res.body))
  } finally {
    restore()
  }
})

// --- POST /attempts/:id/answers ---

test('no-leak: recording an answer never returns correctness', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z' }, error: null } },
    { table: 'questions', result: { data: { id: QUESTION_UUID, quiz_id: 'quiz-1', type: 'closed' }, error: null } },
    { table: 'answer_options', result: { data: [{ id: OPTION_UUID, text: 'Yes', is_correct: true }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: { id: 'ans-1' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID, selectedOptionId: OPTION_UUID })
    assert.equal(res.status, 200)
    assert.doesNotThrow(() => assertNoAnswerLeak(res.body))
  } finally {
    restore()
  }
})

// --- POST /attempts/:id/submit and GET /attempts/:id/result ---

const SUBMIT_SEQUENCE = () => [
  { table: 'users', result: { data: USER, error: null } },
  { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, assignment_id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z', submitted_at: null }, error: null } },
  { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
  { table: 'quiz_attempt_answers', result: { data: [{ question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2026-01-01T00:01:00.000Z' }], error: null } },
  { rpc: 'complete_quiz_attempt', result: { data: null, error: null } }
]

test('no-leak: submit result carries no correct-option identifier/text — only the caller\'s own isCorrect', async () => {
  const restore = mockSupabaseSequence(SUBMIT_SEQUENCE())
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    // The one documented exception: isCorrect is the caller's OWN verdict.
    assert.doesNotThrow(() => assertNoAnswerLeak(stripOwnAnswerVerdict(res.body)))
  } finally {
    restore()
  }
})

test('no-leak: GET result carries no correct-option identifier/text — only the caller\'s own isCorrect', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'completed', total_questions: 1, correct_count: 1, score_percent: 100, submitted_at: '2026-01-01T00:05:00.000Z' }, error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [{ question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2026-01-01T00:01:00.000Z' }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/user/attempts/${ATTEMPT_UUID}/result`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.doesNotThrow(() => assertNoAnswerLeak(stripOwnAnswerVerdict(res.body)))
  } finally {
    restore()
  }
})
