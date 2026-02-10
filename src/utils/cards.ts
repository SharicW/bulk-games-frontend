import type { Card, Rank, Suit } from '../types/poker';

// Import all card images using Vite's import.meta.glob (eager → resolved at build time)
const cardImages = import.meta.glob<{ default: string }>(
  '/assets/cards/**/*.png',
  { eager: true }
);

/* ── Preload all poker card images into browser cache ──────────────── */
const _allPokerUrls = Object.values(cardImages).map(m => m.default);
let _preloaded = false;

/** Preload every poker card image. Safe to call multiple times. */
export function preloadPokerCards(): void {
  if (_preloaded) return;
  _preloaded = true;
  for (const url of _allPokerUrls) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

// Map rank to folder name
const rankToFolder: Record<Rank, string> = {
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  'J': 'jack',
  'Q': 'queen',
  'K': 'king',
  'A': 'A'
};

// Map rank to file prefix
const rankToPrefix: Record<Rank, string> = {
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  'J': 'jack',
  'Q': 'queen',
  'K': 'king',
  'A': 'ace'
};

export function getCardImageUrl(card: Card): string {
  const folder = rankToFolder[card.rank];
  const prefix = rankToPrefix[card.rank];
  const filename = `${prefix}_of_${card.suit}.png`;
  const path = `/assets/cards/${folder}/${filename}`;
  
  const imageModule = cardImages[path];
  if (imageModule) {
    return imageModule.default;
  }
  
  // Fallback to direct path if not found in glob
  return path;
}

// Card back - use a simple CSS fallback since no card back image provided
export function getCardBackUrl(): string {
  return ''; // Will use CSS fallback
}

export function formatCard(card: Card): string {
  const suitSymbols: Record<Suit, string> = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  };
  
  return `${card.rank}${suitSymbols[card.suit]}`;
}

export function getSuitColor(suit: Suit): string {
  return suit === 'hearts' || suit === 'diamonds' ? '#e53935' : '#212121';
}
