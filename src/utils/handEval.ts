import type { Card, Rank } from '../types/poker'

const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

/** Stable unique key for a Card: "rank_suit" e.g. "A_hearts" */
export function cardKey(c: Card): string {
  return `${c.rank}_${c.suit}`
}

export interface HandResult {
  /** Hand category name e.g. "Two Pair" */
  name: string
  /** The exact 5 cards that form the best hand (shallow copies) */
  best5: Card[]
  /** cardKey strings for the 5 cards – always length 5, always unique */
  best5Keys: string[]
  /** Numeric score for comparison */
  score: number
  /** Kickers detail */
  kickers: number[]
}

/* ------------------------------------------------------------------ */
/*  Combinations                                                       */
/* ------------------------------------------------------------------ */

function getCombinations(arr: Card[], k: number): Card[][] {
  const result: Card[][] = []
  function helper(start: number, combo: Card[]) {
    if (combo.length === k) { result.push(combo.slice()); return }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i])
      helper(i + 1, combo)
      combo.pop()
    }
  }
  helper(0, [])
  return result
}

/* ------------------------------------------------------------------ */
/*  5-card evaluator                                                    */
/* ------------------------------------------------------------------ */

function evaluate5(cards: Card[]): { score: number; name: string; kickers: number[] } {
  const vals = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)

  const isFlush = suits.every(s => s === suits[0])

  let isStraight = false
  let straightHigh = 0
  const unique = new Set(vals)
  if (unique.size === 5 && vals[0] - vals[4] === 4) {
    isStraight = true
    straightHigh = vals[0]
  }
  // Wheel (A-2-3-4-5)
  if (unique.size === 5 && vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) {
    isStraight = true
    straightHigh = 5
  }

  const counts: Record<number, number> = {}
  vals.forEach(v => counts[v] = (counts[v] || 0) + 1)
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ value: Number(v), count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value)

  const pattern = groups.map(g => g.count).join('')
  const kickers = groups.filter(g => g.count === 1).map(g => g.value).sort((a, b) => b - a)

  if (isStraight && isFlush) {
    return straightHigh === 14
      ? { score: 10e8, name: 'Royal Flush', kickers: [] }
      : { score: 9e8 + straightHigh, name: 'Straight Flush', kickers: [] }
  }
  if (pattern === '41') return { score: 8e8 + groups[0].value * 100 + groups[1].value, name: 'Four of a Kind', kickers: [groups[1].value] }
  if (pattern === '32') return { score: 7e8 + groups[0].value * 100 + groups[1].value, name: 'Full House', kickers: [] }
  if (isFlush) return { score: 6e8 + vals[0] * 1e6 + vals[1] * 1e4 + vals[2] * 100 + vals[3] + vals[4] * 0.01, name: 'Flush', kickers: vals }
  if (isStraight) return { score: 5e8 + straightHigh, name: 'Straight', kickers: [] }
  if (pattern === '311') return { score: 4e8 + groups[0].value * 1e4 + groups[1].value * 100 + groups[2].value, name: 'Three of a Kind', kickers }
  if (pattern === '221') return { score: 3e8 + Math.max(groups[0].value, groups[1].value) * 1e4 + Math.min(groups[0].value, groups[1].value) * 100 + groups[2].value, name: 'Two Pair', kickers }
  if (pattern === '2111') return { score: 2e8 + groups[0].value * 1e6 + groups[1].value * 1e4 + groups[2].value * 100 + groups[3].value, name: 'One Pair', kickers }
  return { score: 1e8 + vals[0] * 1e6 + vals[1] * 1e4 + vals[2] * 100 + vals[3] + vals[4] * 0.01, name: 'High Card', kickers: vals }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Evaluate the best 5-card poker hand from hole + community cards.
 * Returns null if fewer than 5 total cards.
 * `best5` and `best5Keys` always contain EXACTLY 5 entries.
 */
export function getBestHand(holeCards: Card[], communityCards: Card[]): HandResult | null {
  const allCards = [...holeCards, ...communityCards]
  if (allCards.length < 5) return null

  const combos = allCards.length === 5 ? [allCards] : getCombinations(allCards, 5)

  let best: HandResult | null = null
  for (const combo of combos) {
    const result = evaluate5(combo)
    if (!best || result.score > best.score) {
      // Shallow-copy the 5 cards so they don't share references with combos
      const five: Card[] = []
      const keys: string[] = []
      for (let i = 0; i < combo.length; i++) {
        const c = combo[i]
        five.push({ rank: c.rank, suit: c.suit })
        keys.push(cardKey(c))
      }

      best = {
        name: result.name,
        best5: five,
        best5Keys: keys,
        score: result.score,
        kickers: result.kickers
      }
    }
  }

  // ── Sanity assertions (dev-only, always enforced defensively) ──
  if (best) {
    if (best.best5.length !== 5 || best.best5Keys.length !== 5) {
      if (import.meta.env.DEV) {
        console.error('[handEval] best5 length !== 5', best)
      }
      return null // refuse to return bad data
    }
    const uniqueKeys = new Set(best.best5Keys)
    if (uniqueKeys.size !== 5) {
      if (import.meta.env.DEV) {
        console.error('[handEval] best5Keys has duplicates', best.best5Keys)
      }
      return null // refuse to return bad data
    }
  }

  return best
}
