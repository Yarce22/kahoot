// trueFalseOptions — the two answer_options rows of a true_false question.
// The labels are user-facing (players and usuarios see them as the answer
// buttons), so they are stored in Spanish. Grading only reads is_correct.
export function trueFalseOptions(questionId, correctAnswer) {
  return [
    { question_id: questionId, text: 'Verdadero', is_correct: correctAnswer === 'true' },
    { question_id: questionId, text: 'Falso', is_correct: correctAnswer === 'false' }
  ]
}
