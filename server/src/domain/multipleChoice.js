// evaluateMultipleAnswer — score a 'multiple' question (several correct
// options) with all-or-nothing semantics: the player's picks are correct only
// if they select EXACTLY the correct set — every correct option and no
// incorrect one.
//
// `options`: [{ id, is_correct }] — the question's options.
// `selectedIds`: the raw ids the player submitted (may contain unknown or
//   duplicate ids; both are sanitized away).
//
// Returns { picked, isCorrect }:
//   picked    — the deduped list of valid selected ids (for stats/display)
//   isCorrect — true iff picked matches the correct set exactly
export function evaluateMultipleAnswer(options = [], selectedIds = []) {
  const validIds = new Set(options.map(o => o.id))
  const picked = [...new Set(selectedIds.filter(id => validIds.has(id)))]
  const correctIds = options.filter(o => o.is_correct).map(o => o.id)

  const isCorrect =
    picked.length === correctIds.length &&
    correctIds.every(id => picked.includes(id))

  return { picked, isCorrect }
}
