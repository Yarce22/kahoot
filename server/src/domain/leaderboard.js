// rankPlayers — order players by score (desc), breaking ties by lower
// cumulative answer time (faster wins), and assign a 1-based rank.
//
// Input players: { nickname, score, totalTimeMs }.
// Output entries: { rank, nickname, score, totalTimeMs }.
export function rankPlayers(players) {
  return [...players]
    .sort((a, b) => b.score - a.score || a.totalTimeMs - b.totalTimeMs)
    .map((player, index) => ({
      rank: index + 1,
      nickname: player.nickname,
      score: player.score,
      totalTimeMs: player.totalTimeMs
    }))
}
