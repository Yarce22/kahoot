// groupResultsByPlayer — turn the flat answer rows returned by
// GET /api/sessions/:pin/results into one entry per player, each with its
// answers ordered by question. Shared by the live host panel and the
// session-history detail view so both render results the same way.
export function groupResultsByPlayer(results = []) {
  const byPlayer = {}
  for (const r of results) {
    const name = r.player?.nickname ?? 'Desconocido'
    if (!byPlayer[name]) byPlayer[name] = { nickname: name, answers: [] }
    const answer = r.answer_text || r.selected_option?.text || null
    byPlayer[name].answers.push({
      questionText: r.question?.text ?? '',
      order: r.question?.order_index ?? 0,
      answer,
      is_correct: r.is_correct,
      timeTakenMs: r.time_taken_ms ?? null
    })
  }
  for (const p of Object.values(byPlayer)) {
    p.answers.sort((a, b) => a.order - b.order)
  }
  return Object.values(byPlayer)
}
