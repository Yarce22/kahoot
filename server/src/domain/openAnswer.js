// Open-answer matching by keywords.
//
// An open question stores its correct answer as a comma-separated list of
// required keywords (e.g. "500, lechuga, tomate, cebolla"). A player's answer
// is correct when it contains EVERY keyword as a substring, ignoring case and
// accents — full-sentence exact/fuzzy matching was unusable in practice since
// nobody types the stored sentence verbatim.

// normalize — lowercase, strip diacritics, collapse surrounding whitespace so
// "Lechuga" and "lechuga" compare equal. ̀-ͯ is the Unicode
// combining-diacritical-marks block that NFD decomposition produces.
function normalize(str) {
  return (str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// parseKeywords — split the stored answer into normalized, non-empty
// keywords. Commas AND whitespace are both treated as separators, so the
// answer works whether keywords are entered "500, lechuga, tomate" or
// "500 lechuga tomate" — otherwise a space-separated entry collapses into a
// single keyword that only matches that exact phrase in that exact order.
export function parseKeywords(csv) {
  return normalize(csv)
    .split(/[\s,]+/)
    .filter(Boolean)
}

// matchOpenAnswer — true iff `response` contains every keyword (substring,
// case/accent-insensitive). An empty keyword list means there is nothing to
// match against, so it returns false.
export function matchOpenAnswer(response, keywordsCsv) {
  const keywords = parseKeywords(keywordsCsv)
  if (!keywords.length) return false
  const haystack = normalize(response)
  return keywords.every(keyword => haystack.includes(keyword))
}
