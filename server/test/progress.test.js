import { test } from 'node:test'
import assert from 'node:assert/strict'

const { toProgressRow, summarizeProgress } = await import('../src/domain/progress.js')

const assignment = (over = {}) => ({
  id: 'a1',
  quiz_id: 'q1',
  status: 'pending',
  cycle: 2,
  attempts: [],
  ...over
})

test('toProgressRow — picks only the current-cycle attempt', () => {
  const row = toProgressRow(assignment({
    status: 'completed',
    attempts: [
      { cycle: 1, status: 'completed', score_percent: 10, submitted_at: 't1' },
      { id: 'att-2', cycle: 2, status: 'completed', score_percent: 90, submitted_at: 't2' }
    ]
  }))
  assert.deepEqual(row, {
    assignmentId: 'a1',
    quizId: 'q1',
    status: 'completed',
    cycle: 2,
    attemptId: 'att-2',
    attemptStatus: 'completed',
    scorePercent: 90,
    submittedAt: 't2'
  })
})

test('toProgressRow — no current-cycle attempt yields nulls', () => {
  const row = toProgressRow(assignment({ attempts: [{ cycle: 1, status: 'completed', score_percent: 50 }] }))
  assert.equal(row.attemptId, null)
  assert.equal(row.attemptStatus, null)
  assert.equal(row.scorePercent, null)
  assert.equal(row.submittedAt, null)
  assert.equal(toProgressRow(assignment({ attempts: undefined })).attemptStatus, null)
})

test('summarizeProgress — counts, percent and average over completed attempts only', () => {
  const rows = [
    { status: 'completed', attemptStatus: 'completed', scorePercent: 80 },
    { status: 'completed', attemptStatus: 'completed', scorePercent: 71 },
    { status: 'pending', attemptStatus: 'expired', scorePercent: 0 },
    { status: 'pending', attemptStatus: 'in_progress', scorePercent: null },
    { status: 'pending', attemptStatus: null, scorePercent: null }
  ]
  assert.deepEqual(summarizeProgress(rows), {
    assigned: 5,
    completed: 2,
    completionPercent: 40,
    averageScore: 76 // (80 + 71) / 2 = 75.5 rounds up
  })
})

test('summarizeProgress — expired attempt does not complete; averageScore is null without completed attempts', () => {
  const rows = [{ status: 'pending', attemptStatus: 'expired', scorePercent: 0 }]
  assert.deepEqual(summarizeProgress(rows), { assigned: 1, completed: 0, completionPercent: 0, averageScore: null })
})

test('summarizeProgress — empty input is all zeros with null average', () => {
  assert.deepEqual(summarizeProgress([]), { assigned: 0, completed: 0, completionPercent: 0, averageScore: null })
})
