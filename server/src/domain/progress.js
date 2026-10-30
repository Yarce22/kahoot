// progress.js — pure aggregation shared by the admin and usuario progress
// endpoints. Only the CURRENT cycle counts: an older cycle's attempt belongs to
// that cycle's history, and an `expired` attempt never completes an assignment.

// toProgressRow — one assignment row (with its embedded `attempts`) to the
// per-quiz progress row. Callers add the quiz title under their own key.
export function toProgressRow(a) {
  const attempt = (a.attempts ?? []).find((t) => t.cycle === a.cycle) ?? null
  return {
    assignmentId: a.id,
    quizId: a.quiz_id,
    status: a.status,
    cycle: a.cycle,
    attemptId: attempt?.id ?? null,
    attemptStatus: attempt?.status ?? null,
    scorePercent: attempt?.score_percent ?? null,
    submittedAt: attempt?.submitted_at ?? null,
    dueAt: a.quiz?.due_at ?? null
  }
}

export function summarizeProgress(rows) {
  const assigned = rows.length
  const completed = rows.filter((r) => r.status === 'completed').length
  const scores = rows
    .filter((r) => r.attemptStatus === 'completed' && typeof r.scorePercent === 'number')
    .map((r) => r.scorePercent)
  return {
    assigned,
    completed,
    completionPercent: assigned ? Math.round((completed / assigned) * 100) : 0,
    averageScore: scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : null
  }
}
