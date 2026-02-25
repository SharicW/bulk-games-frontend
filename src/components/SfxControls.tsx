/**
 * SfxControls — compact Sound On/Off toggle + volume slider.
 *
 * Drop this anywhere inside a page header. It subscribes to the sfx
 * singleton so it re-renders whenever settings change elsewhere.
 * Settings are persisted to localStorage automatically by the sfx service.
 */

import { useEffect, useReducer } from 'react'
import { sfx, subscribeSfx } from '../services/sfx'

// ── SVG icons (inline, no external dependency) ────────────────────────────────

function IconSoundOn() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function IconSoundOff() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SfxControls() {
  // Re-render when sfx settings change (via sfx.setEnabled / sfx.setVolume)
  const [, tick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeSfx(tick), [])

  const enabled = sfx.getEnabled()
  const volumePct = Math.round(sfx.getVolume() * 100)

  return (
    <div
      className="sfx-controls"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
      }}
      title={enabled ? `Sound ON — ${volumePct}%` : 'Sound OFF'}
    >
      {/* Toggle button */}
      <button
        type="button"
        className="btn-secondary sfx-controls__toggle"
        aria-label={enabled ? 'Mute sound' : 'Unmute sound'}
        onClick={() => sfx.setEnabled(!enabled)}
        style={{
          padding: '5px 8px',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          opacity: enabled ? 1 : 0.55,
        }}
      >
        {enabled ? <IconSoundOn /> : <IconSoundOff />}
      </button>

      {/* Volume slider — only shown when enabled */}
      {enabled && (
        <input
          type="range"
          min={0}
          max={100}
          value={volumePct}
          aria-label={`Volume ${volumePct}%`}
          onChange={e => sfx.setVolume(parseInt(e.target.value, 10) / 100)}
          style={{
            width: 72,
            cursor: 'pointer',
            accentColor: 'var(--primary, #6c63ff)',
            verticalAlign: 'middle',
          }}
        />
      )}
    </div>
  )
}

