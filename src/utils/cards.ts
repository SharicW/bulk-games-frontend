import type { Card, Rank, Suit } from '../types/poker';

/* ── Eager glob import — all card PNGs resolved at build time ───────── */
const cardImages = import.meta.glob<{ default: string }>(
  '/assets/cards/**/*.png',
  { eager: true }
);

/* ──────────────────────────────────────────────────────────────────────
 * Face-card URL set
 * Face cards (J, Q, K, A) are 190-285 KB each — 3-5× larger than number
 * cards (≈54 KB).  The original code deferred ALL cards to requestIdleCallback,
 * which meant face cards might not be cached by the time they were dealt,
 * causing them to briefly appear invisible on first render.
 *
 * Fix: extract face-card URLs at module-init time so preloadPokerCards()
 * can load them synchronously (not in an idle batch).
 * ────────────────────────────────────────────────────────────────────── */
const FACE_CARD_FOLDERS = new Set(['jack', 'queen', 'king', 'ace']);

/**
 * Production URLs for face cards only (J, Q, K, A across all 4 suits).
 * Identified by the source-path folder name inside the glob key.
 */
export const faceCardUrls: string[] = Object.entries(cardImages)
  .filter(([srcPath]) => {
    // srcPath example: '/assets/cards/king/king_of_spades.png'
    const parts = srcPath.split('/');
    const folder = parts[parts.length - 2];
    return folder ? FACE_CARD_FOLDERS.has(folder) : false;
  })
  .map(([, mod]) => mod.default);

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
 * Preload poker card images.
 *
 * Phase 1 — face cards (J/Q/K/A, 16 cards) are fetched IMMEDIATELY and in
 *            parallel.  These are the largest files and the most likely to be
 *            visible at the start of a hand, so they must be in the browser
 *            cache before the game renders.
 *
 * Phase 2 — remaining number cards (2-10, 36 cards) are loaded lazily via
 *            requestIdleCallback / setTimeout so they don't compete with the
 *            first render.
 *
 * @param priorityCards  Optional list of cards currently in the player's hand
 *                       (included in the face-card batch for extra priority).
 */
export function preloadPokerCards(priorityCards?: Card[]): void {
  if (_preloadStarted) return;
  _preloadStarted = true;

  const DEV = import.meta.env.DEV;
  const t0 = DEV ? performance.now() : 0;

  // ── Phase 1: Face cards + any provided priority cards ─────────────────
  // Start immediately — do NOT wait for idle callback.
  const phase1Urls = new Set<string>(faceCardUrls);
  if (priorityCards) {
    for (const c of priorityCards) {
      const url = getCardImageUrl(c);
      if (url) phase1Urls.add(url);
    }
  }

  loadBatch([...phase1Urls]).then(() => {
    if (DEV) console.log(`[preload] phase1 face+priority (${phase1Urls.size}) cards: ${(performance.now() - t0).toFixed(0)}ms`);
  });

  // ── Phase 2: Number cards (2–10) via idle batches ─────────────────────
  const remaining = _allPokerUrls.filter(u => !phase1Urls.has(u));
  let idx = 0;

  function loadNextBatch() {
    if (idx >= remaining.length) {
      if (DEV) console.log(`[preload] all ${_allPokerUrls.length} cards done: ${(performance.now() - t0).toFixed(0)}ms`);
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

  // Delay number-card loading until the browser is idle
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => loadNextBatch());
  } else {
    setTimeout(loadNextBatch, 150);
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
  'A': 'ace'
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

  // Fallback to direct path if not found in glob.
  // In production the hashed URL won't be resolved this way, so
  // CardDisplay will fall back to its CSS text rendering.
  if (import.meta.env.DEV) {
    console.warn(`[cards] glob miss for: ${path}`);
  }
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
