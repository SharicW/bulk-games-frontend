import type { Card, Rank } from '../types/poker'

const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

export interface HandResult {
  name: string
  cards: Card[]
  score: number
}

function getCombinations(arr: Card[], k: number): Card[][] {
  const result: Card[][] = []
  function helper(start: number, combo: Card[]) {
    if (combo.length === k) { result.push([...combo]); return }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i])
      helper(i + 1, combo)
      combo.pop()
    }
  }
  helper(0, [])
  return result
}

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

export function getBestHand(holeCards: Card[], communityCards: Card[]): HandResult | null {
  const allCards = [...holeCards, ...communityCards]
  if (allCards.length < 5) return null

  const combos = allCards.length === 5 ? [allCards] : getCombinations(allCards, 5)

  let best: HandResult | null = null
  for (const combo of combos) {
    const result = evaluate5(combo)
    if (!best || result.score > best.score) {
      best = { name: result.name, cards: combo, score: result.score }
    }
  }

  return best
}

export function isCardInHand(card: Card, hand: HandResult | null): boolean {
  if (!hand) return false
  return hand.cards.some(c => c.rank === card.rank && c.suit === card.suit)
}
