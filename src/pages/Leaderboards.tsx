import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiGetLeaderboard, apiGetMyRank, type LeaderboardBy, type LeaderboardRow } from '../services/api'

type CacheEntry<T> = { ts: number; data: T }

function fmt(n: number | null | undefined): string {
  const x = Number(n ?? 0)
  return Number.isFinite(x) ? x.toLocaleString() : '0'
}

function Leaderboards() {
  const { isLoggedIn, loading } = useAuth()
  const [by, setBy] = useState<LeaderboardBy>('coins')
  const [top, setTop] = useState<LeaderboardRow[] | null>(null)
  const [meCoins, setMeCoins] = useState<LeaderboardRow | null>(null)
  const [meWins, setMeWins] = useState<LeaderboardRow | null>(null)
  const [err, setErr] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const cacheRef = useRef(new Map<string, CacheEntry<any>>())
  const cacheMs = 20_000

  const getCached = async <T,>(key: string, fetcher: () => Promise<T>): Promise<T> => {
    const hit = cacheRef.current.get(key) as CacheEntry<T> | undefined
    const now = Date.now()
    if (hit && now - hit.ts < cacheMs) return hit.data
    const data = await fetcher()
    cacheRef.current.set(key, { ts: now, data })
    return data
  }

  useEffect(() => {
    if (!isLoggedIn) return
    let cancelled = false
    setBusy(true)
    setErr('')
    Promise.all([
      getCached('me:coins', () => apiGetMyRank('coins')),
      getCached('me:wins', () => apiGetMyRank('wins')),
      getCached(`top:${by}`, () => apiGetLeaderboard(by, 10)),
    ])
      .then(([a, b, c]) => {
        if (cancelled) return
        setMeCoins(a.me)
        setMeWins(b.me)
        setTop(c.rows || [])
      })
      .catch(() => {
        if (cancelled) return
        setErr('Failed to load leaderboards')
      })
      .finally(() => {
        if (cancelled) return
        setBusy(false)
      })
    return () => { cancelled = true }
  }, [isLoggedIn, by])

  const me = useMemo(() => (by === 'coins' ? meCoins : meWins), [by, meCoins, meWins])
  const myRank = by === 'coins' ? meCoins?.rank : meWins?.rank
  const myInTop10 = (myRank ?? 999999) <= 10

  if (loading) {
    return (
      <div className="page-shell">
        <div className="page-header"><p className="eyebrow">Stats</p><h1>Leaderboards</h1></div>
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div className="spinner" />
          <p className="muted">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="page-shell">
        <div className="page-header"><p className="eyebrow">Stats</p><h1>Leaderboards</h1></div>
        <div className="auth-gate-banner">
          <p>You must be logged in to view leaderboards.</p>
          <a href="/profile" className="btn-primary" style={{ textDecoration: 'none', width: 'auto', padding: '8px 20px' }}>
            Go to Profile to Login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div className="page-header">
          <p className="eyebrow">Stats</p>
          <h1>Leaderboards</h1>
        </div>

        <div className="auth-tabs" style={{ width: 'auto' }}>
          <button className={`auth-tab ${by === 'coins' ? 'auth-tab--active' : ''}`} onClick={() => setBy('coins')} disabled={busy}>
            Coins
          </button>
          <button className={`auth-tab ${by === 'wins' ? 'auth-tab--active' : ''}`} onClick={() => setBy('wins')} disabled={busy}>
            Wins
          </button>
        </div>
      </div>

      {err && <div className="shop-message shop-message--error">{err}</div>}

      <div className="card" style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Your stats / Your rank</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div className="shop-equipped" style={{ minWidth: 220 }}>
            <span className="muted" style={{ fontSize: '12px', textTransform: 'uppercase' }}>Coins</span>
            <span style={{ fontWeight: 700, fontSize: '18px' }}>{fmt(meCoins?.coins)}</span>
            <span className="muted" style={{ fontSize: '12px' }}>Rank: #{fmt(meCoins?.rank)}</span>
          </div>
          <div className="shop-equipped" style={{ minWidth: 220 }}>
            <span className="muted" style={{ fontSize: '12px', textTransform: 'uppercase' }}>Wins</span>
            <span style={{ fontWeight: 700, fontSize: '18px' }}>{fmt(meWins?.wins)}</span>
            <span className="muted" style={{ fontSize: '12px' }}>Rank: #{fmt(meWins?.rank)}</span>
          </div>
          <div className="shop-equipped" style={{ minWidth: 220 }}>
            <span className="muted" style={{ fontSize: '12px', textTransform: 'uppercase' }}>Sorted by</span>
            <span style={{ fontWeight: 700, fontSize: '18px' }}>{by === 'coins' ? 'Coins' : 'Wins'}</span>
            <span className="muted" style={{ fontSize: '12px' }}>
              Your position: #{fmt(myRank)}
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Top 10</h3>
        {top === null ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div className="spinner" />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '8px' }}>
            {top.map((r) => (
              <div key={r.userId} className="shop-item__row" style={{
                display: 'grid',
                gridTemplateColumns: '64px 1fr 120px',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--color-border)',
              }}>
                <div style={{ fontWeight: 800 }}>#{r.rank}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: 999 }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: 999, background: 'rgba(148,163,184,0.14)' }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.nickname}</div>
                    <div className="muted" style={{ fontSize: '12px' }}>Wins: {fmt(r.wins)} | Coins: {fmt(r.coins)}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontWeight: 800 }}>
                  {by === 'coins' ? `${fmt(r.coins)} 🪙` : fmt(r.wins)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!myInTop10 && me && (
        <div className="card">
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Your position</h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '64px 1fr 120px',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--color-border)',
          }}>
            <div style={{ fontWeight: 800 }}>#{me.rank}</div>
            <div style={{ fontWeight: 650 }}>{me.nickname}</div>
            <div style={{ textAlign: 'right', fontWeight: 800 }}>
              {by === 'coins' ? `${fmt(me.coins)} 🪙` : fmt(me.wins)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Leaderboards


