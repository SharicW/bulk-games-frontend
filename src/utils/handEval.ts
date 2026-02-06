import type { Card, Rank } from '../types/poker'

const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

export interface HandResult {
  /** Hand category name e.g. "Two Pair" */
  name: string
  /** Indices into holeCards that are part of the best 5 (values: 0 and/or 1) */
  holeIndices: number[]
  /** Indices into communityCards that are part of the best 5 (values: 0–4) */
  communityIndices: number[]
  /** Numeric score for comparison */
  score: number
  /** Kickers detail */
  kickers: number[]
}

/* ------------------------------------------------------------------ */
/*  Index-based combinations: returns arrays of indices [0..n)          */
/* ------------------------------------------------------------------ */

function indexCombinations(n: number, k: number): number[][] {
  const result: number[][] = []
  function helper(start: number, combo: number[]) {
    if (combo.length === k) { result.push(combo.slice()); return }
    for (let i = start; i < n; i++) {
      combo.push(i)
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
 *
 * `holeIndices`      – which of the 2 hole cards are in the best 5 (values 0/1)
 * `communityIndices` – which community cards are in the best 5 (values 0–4)
 *
 * Combined length is always exactly 5.
 */
export function getBestHand(holeCards: Card[], communityCards: Card[]): HandResult | null {
  const holeLen = holeCards.length
  const allCards = [...holeCards, ...communityCards]
  if (allCards.length < 5) return null

  // Generate index combinations (choose 5 from allCards.length)
  const combos = indexCombinations(allCards.length, 5)

  let best: HandResult | null = null
  for (const indices of combos) {
    const combo = indices.map(i => allCards[i])
    const result = evaluate5(combo)

    if (!best || result.score > best.score) {
      // Split indices into hole vs community
      const hIdx: number[] = []
      const cIdx: number[] = []
      for (const i of indices) {
        if (i < holeLen) {
          hIdx.push(i)         // index into holeCards
        } else {
          cIdx.push(i - holeLen) // index into communityCards
        }
      }

      best = {
        name: result.name,
        holeIndices: hIdx,
        communityIndices: cIdx,
        score: result.score,
        kickers: result.kickers
      }
    }
  }

  // Sanity: total highlighted must be exactly 5
  if (best && (best.holeIndices.length + best.communityIndices.length) !== 5) {
    if (import.meta.env.DEV) {
      console.error('[handEval] highlight count !== 5',
        best.holeIndices, best.communityIndices)
    }
    return null
  }

  return best
}
