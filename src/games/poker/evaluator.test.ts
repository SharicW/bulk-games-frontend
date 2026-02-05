import { describe, expect, it } from 'vitest';
import { compareScores, evaluateHand } from './evaluator';
import type { PokerCard } from './evaluator';

const card = (rank: string, suit: PokerCard['suit']): PokerCard => ({
  rank,
  suit,
  value: '23456789TJQKA'.indexOf(rank) + 2,
});

describe('poker evaluator', () => {
  it('prefers four of a kind over flush', () => {
    const fourKind = evaluateHand([
      card('A', '♠'),
      card('A', '♥'),
      card('A', '♦'),
      card('A', '♣'),
      card('K', '♦'),
      card('Q', '♥'),
      card('J', '♣'),
    ]);
    const flush = evaluateHand([
      card('2', '♠'),
      card('4', '♠'),
      card('7', '♠'),
      card('9', '♠'),
      card('J', '♠'),
      card('5', '♥'),
      card('6', '♣'),
    ]);
    expect(compareScores(fourKind, flush)).toBeGreaterThan(0);
  });

  it('resolves high card correctly', () => {
    const handA = evaluateHand([
      card('A', '♠'),
      card('K', '♥'),
      card('Q', '♦'),
      card('J', '♣'),
      card('9', '♦'),
      card('3', '♥'),
      card('2', '♣'),
    ]);
    const handK = evaluateHand([
      card('K', '♠'),
      card('Q', '♥'),
      card('J', '♦'),
      card('9', '♣'),
      card('8', '♦'),
      card('3', '♥'),
      card('2', '♣'),
    ]);
    expect(compareScores(handA, handK)).toBeGreaterThan(0);
  });
});
