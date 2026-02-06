import type { Card, Rank } from '../types/poker'

const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

/* ------------------------------------------------------------------ */
/*  Stable unique card key                                              */
/* ------------------------------------------------------------------ */

/** Canonical unique key for a card – same value everywhere. */
export function cardKey(c: Card): string {
  return c.rank + c.suit          // e.g. "Ahearts", "10spades"
}

/* ------------------------------------------------------------------ */
/*  Public result type                                                   */
/* ------------------------------------------------------------------ */

export interface HandResult {
  /** Hand category name, e.g. "Two Pair" */
  name: string
  /** The EXACT cards that form the best hand (length = min(totalCards, 5)) */
  best5: Card[]
  /** Numeric score for comparison */
  score: number
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

function evaluate5(cards: Card[]): { score: number; name: string } {
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

  if (isStraight && isFlush) {
    return straightHigh === 14
      ? { score: 10e8, name: 'Royal Flush' }
      : { score: 9e8 + straightHigh, name: 'Straight Flush' }
  }
  if (pattern === '41') return { score: 8e8 + groups[0].value * 100 + groups[1].value, name: 'Four of a Kind' }
  if (pattern === '32') return { score: 7e8 + groups[0].value * 100 + groups[1].value, name: 'Full House' }
  if (isFlush) return { score: 6e8 + vals[0] * 1e6 + vals[1] * 1e4 + vals[2] * 100 + vals[3] + vals[4] * 0.01, name: 'Flush' }
  if (isStraight) return { score: 5e8 + straightHigh, name: 'Straight' }
  if (pattern === '311') return { score: 4e8 + groups[0].value * 1e4 + groups[1].value * 100 + groups[2].value, name: 'Three of a Kind' }
  if (pattern === '221') return { score: 3e8 + Math.max(groups[0].value, groups[1].value) * 1e4 + Math.min(groups[0].value, groups[1].value) * 100 + groups[2].value, name: 'Two Pair' }
  if (pattern === '2111') return { score: 2e8 + groups[0].value * 1e6 + groups[1].value * 1e4 + groups[2].value * 100 + groups[3].value, name: 'One Pair' }
  return { score: 1e8 + vals[0] * 1e6 + vals[1] * 1e4 + vals[2] * 100 + vals[3] + vals[4] * 0.01, name: 'High Card' }
}

/* ------------------------------------------------------------------ */
/*  Partial evaluator (2-4 cards, i.e. preflop)                         */
/* ------------------------------------------------------------------ */

function evaluatePartial(cards: Card[]): HandResult {
  const vals = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a)

  const counts: Record<number, number> = {}
  vals.forEach(v => counts[v] = (counts[v] || 0) + 1)
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ value: Number(v), count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value)

  const maxGroup = groups[0].count

  if (maxGroup >= 2) {
    // Pocket pair (or better in edge cases)
    return {
      name: 'One Pair',
      best5: [...cards],
      score: 2e8 + groups[0].value
    }
  }

  return {
    name: 'High Card',
    best5: [...cards],
    score: 1e8 + vals[0]
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Evaluate the best poker hand from ALL currently-available cards.
 *
 * Pass every card the local player can see right now
 * (hole cards + current community cards for the street).
 *
 * - 0-1 cards → null (nothing to evaluate)
 * - 2-4 cards → partial evaluation (preflop: "One Pair" / "High Card")
 * - 5+  cards → best 5-card hand chosen from C(n,5) combinations
 *
 * Returns `{ name, best5, score }`.
 * `best5` contains the EXACT Card objects that form the hand.
 */
export function getBestHand(allCards: Card[]): HandResult | null {
  if (allCards.length < 2) return null

  // ── Fewer than 5 cards (preflop) ────────────────────────────────
  if (allCards.length < 5) {
    return evaluatePartial(allCards)
  }

  // ── 5+ cards: find the best 5-card combination ─────────────────
  const combos = indexCombinations(allCards.length, 5)

  let best: HandResult | null = null
  for (const indices of combos) {
    const combo = indices.map(i => allCards[i])
    const result = evaluate5(combo)

    if (!best || result.score > best.score) {
      best = {
        name: result.name,
        best5: combo,
        score: result.score
      }
    }
  }

  // ── Dev-only sanity checks ─────────────────────────────────────
  if (import.meta.env.DEV && best) {
    if (best.best5.length !== 5) {
      console.warn(
        '[handEval] totalCards >= 5 but best5.length =', best.best5.length,
        'cards:', allCards.map(cardKey)
      )
    }
  }

  return best
}
