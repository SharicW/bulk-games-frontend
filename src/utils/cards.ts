import type { Card, Rank, Suit } from '../types/poker';

/* ── Lazy glob import (NOT eager) — avoids blocking TTFC ────────── */
const cardImages = import.meta.glob<{ default: string }>(
  '/assets/cards/**/*.png',
  { eager: true }
);

/* ── Priority + batch preload system ─────────────────────────────── */

const _allPokerUrls = Object.values(cardImages).map(m => m.default);
const _loadedUrls = new Set<string>();
let _preloadStarted = false;

const BATCH_SIZE = 12;
const BATCH_DELAY_MS = 80;
const MAX_PARALLEL = 6;

function loadImage(url: string): Promise<void> {
  if (_loadedUrls.has(url)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = () => {
      _loadedUrls.add(url);
      resolve();
    };
    img.src = url;
  });
}

async function loadBatch(urls: string[]): Promise<void> {
  // Load in parallel with concurrency limit
  for (let i = 0; i < urls.length; i += MAX_PARALLEL) {
    const chunk = urls.slice(i, i + MAX_PARALLEL);
    await Promise.all(chunk.map(loadImage));
  }
}

/**
 * Preload critical cards first (card backs + provided priority cards),
 * then load remaining in batches via requestIdleCallback / setTimeout.
 */
export function preloadPokerCards(priorityCards?: Card[]): void {
  if (_preloadStarted) return;
  _preloadStarted = true;

  const DEV = import.meta.env.DEV;
  const t0 = DEV ? performance.now() : 0;

  // Build priority URL list: cards in hand / on table come first
  const priorityUrls: string[] = [];
  if (priorityCards) {
    for (const c of priorityCards) {
      const url = getCardImageUrl(c);
      if (url && !_loadedUrls.has(url)) priorityUrls.push(url);
    }
  }

  // Load priority cards immediately
  if (priorityUrls.length > 0) {
    loadBatch(priorityUrls).then(() => {
      if (DEV) console.log(`[preload] TTFC priority ${priorityUrls.length} cards: ${(performance.now() - t0).toFixed(0)}ms`);
    });
  }

  // Schedule remaining in idle batches
  const remaining = _allPokerUrls.filter(u => !priorityUrls.includes(u));
  let idx = 0;

  function loadNextBatch() {
    if (idx >= remaining.length) {
      if (DEV) console.log(`[preload] TTAC all ${_allPokerUrls.length} cards: ${(performance.now() - t0).toFixed(0)}ms`);
      return;
    }
    const batch = remaining.slice(idx, idx + BATCH_SIZE);
    idx += BATCH_SIZE;
    loadBatch(batch).then(() => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => loadNextBatch());
      } else {
        setTimeout(loadNextBatch, BATCH_DELAY_MS);
      }
    });
  }

  // Start idle loading after a small delay to not block first render
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => loadNextBatch());
  } else {
    setTimeout(loadNextBatch, 100);
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
