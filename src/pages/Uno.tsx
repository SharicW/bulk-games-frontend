import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'
import tableLogo from '/assets/BULK_GAMES_LOGO.png'

const STORAGE_KEY = 'bulk_games_auth'
const USER_ID_KEY = 'bulk_games_user_id'
const UNO_LOBBY_PREFIX = 'uno_lobby_'
const UNO_INTENTS_PREFIX = 'uno_intents_'
const UNO_SNAPSHOT_PREFIX = 'uno_snapshot_'
const UNO_CLOSED_PREFIX = 'uno_closed_'

type UnoColor = 'red' | 'green' | 'blue' | 'yellow'
type UnoKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'

type UnoFaceId =
  | `${UnoColor}_${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `${UnoColor}_skip`
  | `${UnoColor}_reverse`
  | `${UnoColor}_draw2`
  | 'wild'
  | 'wild4'

type UnoCardFace =
  | { kind: 'number'; color: UnoColor; value: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }
  | { kind: 'skip'; color: UnoColor }
  | { kind: 'reverse'; color: UnoColor }
  | { kind: 'draw2'; color: UnoColor }
  | { kind: 'wild' }
  | { kind: 'wild4' }

type UnoPhase = 'lobby' | 'playing' | 'finished'

type UnoCard = {
  id: string
  face: UnoCardFace
}

type UnoPlayer = {
  playerId: string
  seatIndex: number
  nickname: string
  avatarUrl: string | null
  isConnected: boolean
  lastSeenAt: number
}

type UnoLogEntry = { id: string; ts: number; text: string }

type UnoState = {
  lobbyCode: string
  hostId: string
  players: UnoPlayer[]
  hands: Record<string, UnoCard[]>
  phase: UnoPhase
  dealerIndex: number
  direction: 1 | -1
  currentPlayerIndex: number
  currentColor: UnoColor | null
  drawPile: UnoCard[]
  discardPile: UnoCard[]
  winnerId: string | null
  drawnPlayable: null | { playerId: string; cardId: string }
  actionLog: UnoLogEntry[]
  createdAt: number
  updatedAt: number
  version: number
}

type UnoIntent =
  | { id: string; ts: number; type: 'join'; playerId: string; nickname: string; avatarUrl: string | null }
  | { id: string; ts: number; type: 'disconnect'; playerId: string }
  | { id: string; ts: number; type: 'start'; playerId: string }
  | { id: string; ts: number; type: 'play'; playerId: string; cardId: string; chosenColor?: UnoColor }
  | { id: string; ts: number; type: 'draw'; playerId: string }
  | { id: string; ts: number; type: 'pass'; playerId: string }
  | { id: string; ts: number; type: 'playAgain'; playerId: string }
  | { id: string; ts: number; type: 'end'; playerId: string }

function getOrCreateUserId(): string {
  let odotuid = localStorage.getItem(USER_ID_KEY)
  if (!odotuid) {
    odotuid = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem(USER_ID_KEY, odotuid)
  }
  return odotuid
}

function getUserProfile(): { nickname: string; avatarUrl: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const auth = JSON.parse(stored)
      if (auth.user) {
        return {
          nickname: auth.user.nickname || 'Player',
          avatarUrl: auth.user.avatarUrl || null,
        }
      }
    }
  } catch {
    // ignore
  }
  return { nickname: 'Player', avatarUrl: null }
}

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function writeUnoState(code: string, state: UnoState) {
  localStorage.setItem(`${UNO_LOBBY_PREFIX}${code}`, JSON.stringify(state))
}

function readUnoState(code: string): UnoState | null {
  return safeJsonParse<UnoState>(localStorage.getItem(`${UNO_LOBBY_PREFIX}${code}`))
}

function writeSnapshot(code: string, playerId: string, state: UnoState) {
  try {
    localStorage.setItem(`${UNO_SNAPSHOT_PREFIX}${code}_${playerId}`, JSON.stringify(state))
  } catch {
    // ignore
  }
}

function readSnapshot(code: string, playerId: string): UnoState | null {
  return safeJsonParse<UnoState>(localStorage.getItem(`${UNO_SNAPSHOT_PREFIX}${code}_${playerId}`))
}

function readIntents(code: string): UnoIntent[] {
  return safeJsonParse<UnoIntent[]>(localStorage.getItem(`${UNO_INTENTS_PREFIX}${code}`)) || []
}

function writeIntents(code: string, intents: UnoIntent[]) {
  localStorage.setItem(`${UNO_INTENTS_PREFIX}${code}`, JSON.stringify(intents))
}

function pushIntent(code: string, intent: UnoIntent) {
  const intents = readIntents(code)
  intents.push(intent)
  // prune
  if (intents.length > 2000) intents.splice(0, intents.length - 2000)
  writeIntents(code, intents)
}

function faceId(face: UnoCardFace): UnoFaceId {
  if (face.kind === 'wild') return 'wild'
  if (face.kind === 'wild4') return 'wild4'
  if (face.kind === 'number') return `${face.color}_${face.value}` as UnoFaceId
  return `${face.color}_${face.kind}` as UnoFaceId
}

function isWild(face: UnoCardFace) {
  return face.kind === 'wild' || face.kind === 'wild4'
}

function isPlayableCard(card: UnoCardFace, top: UnoCardFace | null, currentColor: UnoColor | null): boolean {
  if (isWild(card)) return true
  if (!top) return true
  if (!currentColor) {
    // should not happen once playing, but keep safe
    return card.kind !== 'wild4' ? true : true
  }
  if (card.kind !== 'wild' && card.kind !== 'wild4' && card.color === currentColor) return true
  if (top.kind === 'number') {
    if (card.kind === 'number' && card.value === top.value) return true
  } else if (top.kind === 'skip' || top.kind === 'reverse' || top.kind === 'draw2') {
    if (card.kind === top.kind) return true
  }
  // if top is wild, matching is by currentColor only (handled above)
  return false
}

function hasColor(hand: UnoCard[], color: UnoColor) {
  return hand.some(c => c.face.kind !== 'wild' && c.face.kind !== 'wild4' && 'color' in c.face && c.face.color === color)
}

function nextIndex(from: number, direction: 1 | -1, count: number, steps = 1) {
  if (count <= 0) return 0
  let idx = from
  for (let i = 0; i < steps; i++) {
    idx = (idx + direction + count) % count
  }
  return idx
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function makeDeck(): UnoCardFace[] {
  const colors: UnoColor[] = ['red', 'green', 'blue', 'yellow']
  const deck: UnoCardFace[] = []
  for (const color of colors) {
    deck.push({ kind: 'number', color, value: 0 })
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
    for (const n of nums) {
      deck.push({ kind: 'number', color, value: n })
      deck.push({ kind: 'number', color, value: n })
    }
    deck.push({ kind: 'skip', color }, { kind: 'skip', color })
    deck.push({ kind: 'reverse', color }, { kind: 'reverse', color })
    deck.push({ kind: 'draw2', color }, { kind: 'draw2', color })
  }
  for (let i = 0; i < 4; i++) deck.push({ kind: 'wild' })
  for (let i = 0; i < 4; i++) deck.push({ kind: 'wild4' })
  return deck
}

function instantiateDeck(faces: UnoCardFace[]): UnoCard[] {
  let n = 0
  return faces.map((face) => {
    n++
    return { id: `uno_${n}_${faceId(face)}_${Math.random().toString(36).slice(2, 7)}`, face }
  })
}

function cardLabel(face: UnoCardFace) {
  if (face.kind === 'wild') return 'Wild'
  if (face.kind === 'wild4') return 'Wild Draw Four'
  const c = face.color[0].toUpperCase() + face.color.slice(1)
  if (face.kind === 'number') return `${c} ${face.value}`
  if (face.kind === 'draw2') return `${c} Draw Two`
  if (face.kind === 'reverse') return `${c} Reverse`
  return `${c} Skip`
}

function drawCards(state: UnoState, count: number): { state: UnoState; cards: UnoCard[] } {
  let drawPile = state.drawPile
  let discardPile = state.discardPile

  const take = () => {
    const c = drawPile[0]
    drawPile = drawPile.slice(1)
    return c
  }

  const refillIfNeeded = () => {
    if (drawPile.length > 0) return
    if (discardPile.length <= 1) return
    const top = discardPile[discardPile.length - 1]
    const rest = discardPile.slice(0, -1)
    discardPile = [top]
    drawPile = shuffle([...rest])
  }

  const out: UnoCard[] = []
  for (let i = 0; i < count; i++) {
    refillIfNeeded()
    if (drawPile.length === 0) break
    const c = take()
    if (c) out.push(c)
  }
  return { state: { ...state, drawPile, discardPile }, cards: out }
}

function addLog(state: UnoState, text: string): UnoState {
  const ts = Date.now()
  const entry: UnoLogEntry = { id: nowId('uno_log'), ts, text }
  const actionLog = [...state.actionLog, entry]
  return { ...state, actionLog: actionLog.slice(-200) }
}

function normalizeState(s: UnoState): UnoState {
  return {
    ...s,
    dealerIndex: typeof (s as any).dealerIndex === 'number' ? (s as any).dealerIndex : 0,
    drawnPlayable: (s as any).drawnPlayable ?? null,
  }
}

function UnoCardImg({ card, images, className, dimmed, glow, onClick }: {
  card: UnoCard
  images: Record<string, string[]>
  className?: string
  dimmed?: boolean
  glow?: boolean
  onClick?: () => void
}) {
  const fId = faceId(card.face)
  const variants = images[fId] || []
  const src = variants.length ? variants[Math.abs(hashStr(card.id)) % variants.length] : null

  return (
    <button
      type="button"
      className={`uno-card ${className || ''} ${dimmed ? 'uno-card--dim' : ''} ${glow ? 'uno-card--glow' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={cardLabel(card.face)}
    >
      {src ? (
        <img src={src} alt={cardLabel(card.face)} loading="lazy" decoding="async" />
      ) : (
        <div className="uno-card__fallback">
          {cardLabel(card.face)}
        </div>
      )}
    </button>
  )
}

function hashStr(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}

function buildUnoImages(): Record<string, string[]> {
  const files = import.meta.glob('/assets/uno_cards/**/*.png', { eager: true, import: 'default' }) as Record<string, string>
  const out: Record<string, string[]> = {}

  const add = (id: UnoFaceId, path: string) => {
    if (!out[id]) out[id] = []
    out[id].push(path)
  }

  const parse = (nameRaw: string): UnoFaceId | null => {
    const name = nameRaw.replace(/\.png$/i, '').trim().replace(/\s+/g, ' ')

    const wild = /^Wild(?:-\d+)?$/i.test(name)
    if (wild) return 'wild'

    const draw4 = /^Draw4(?:-\d+)?$/i.test(name)
    if (draw4) return 'wild4'

    const mNum = /^(Red|Green|Blue|Yellow)\s*-\s*([0-9])$/i.exec(name)
    if (mNum) return `${mNum[1].toLowerCase()}_${parseInt(mNum[2], 10)}` as UnoFaceId

    const mDraw2 = /^(Red|Green|Blue|Yellow)\s+Draw2/i.exec(name)
    if (mDraw2) return `${mDraw2[1].toLowerCase()}_draw2` as UnoFaceId

    const mSkip = /^(Red|Green|Blue|Yellow)\s+Skip/i.exec(name)
    if (mSkip) return `${mSkip[1].toLowerCase()}_skip` as UnoFaceId

    const mRev = /^(Red|Green|Blue|Yellow)\s+Reverse/i.exec(name)
    if (mRev) return `${mRev[1].toLowerCase()}_reverse` as UnoFaceId

    // sometimes "Red Reverse2" (no dash)
    const mRev2 = /^(Red|Green|Blue|Yellow)\s+Reverse\d+/i.exec(name)
    if (mRev2) return `${mRev2[1].toLowerCase()}_reverse` as UnoFaceId

    return null
  }

  for (const [path, mod] of Object.entries(files)) {
    const file = path.split('/').pop() || ''
    const id = parse(file)
    if (id) add(id, mod)
  }

  return out
}

function seatPos(i: number, n: number) {
  const t = n <= 1 ? 0 : i / n
  // place me-ish at bottom by rotating +0.5
  const ang = (t + 0.5) * Math.PI * 2
  const rx = 46
  const ry = 34
  const x = 50 + Math.cos(ang) * rx
  const y = 50 + Math.sin(ang) * ry
  return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' as const }
}

function Uno() {
  const [searchParams] = useSearchParams()
  const lobbyCode = (searchParams.get('lobby') || '').toUpperCase()
  const { isLoggedIn } = useAuth()

  const userIdRef = useRef(getOrCreateUserId())
  const profileRef = useRef(getUserProfile())

  const [state, setState] = useState<UnoState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [colorModalOpen, setColorModalOpen] = useState(false)
  const [pendingWildCardId, setPendingWildCardId] = useState<string | null>(null)
  const [endClosed, setEndClosed] = useState(false)

  const images = useMemo(() => buildUnoImages(), [])

  const isHost = state?.hostId === userIdRef.current
  const me = state?.players.find(p => p.playerId === userIdRef.current) || null
  const myHand = state?.hands?.[userIdRef.current] || []
  const topCard = state?.discardPile?.length ? state.discardPile[state.discardPile.length - 1] : null

  const currentPlayer = state && state.players[state.currentPlayerIndex]
  const isMyTurn = !!state && state.phase === 'playing' && currentPlayer?.playerId === userIdRef.current
  const drawnPlayable = state?.drawnPlayable?.playerId === userIdRef.current ? state.drawnPlayable : null

  const playable = useMemo(() => {
    if (!state) return new Set<string>()
    const set = new Set<string>()
    const top = topCard?.face || null
    for (const c of myHand) {
      const ok = isPlayableCard(c.face, top, state.currentColor)
      if (!ok) continue
      if (c.face.kind === 'wild4' && state.currentColor && hasColor(myHand, state.currentColor)) continue
      if (drawnPlayable && c.id !== drawnPlayable.cardId) continue
      set.add(c.id)
    }
    return set
  }, [state, myHand, topCard, drawnPlayable])

  const hasAnyPlayable = playable.size > 0

  // Load / subscribe
  useEffect(() => {
    if (!isLoggedIn) return
    if (!lobbyCode) {
      setError('No lobby code provided')
      return
    }

    const uid = userIdRef.current
    const snap = readSnapshot(lobbyCode, uid)
    let s = readUnoState(lobbyCode)
    if (!s && snap && snap.hostId === uid) {
      writeUnoState(lobbyCode, snap)
      s = snap
    }

    if (!s) {
      setError('Lobby not found')
      return
    }

    s = normalizeState(s)
    setState(s)
    setError(null)
    writeSnapshot(lobbyCode, uid, s)

    // send join intent
    pushIntent(lobbyCode, {
      id: nowId('uno_int'),
      ts: Date.now(),
      type: 'join',
      playerId: uid,
      nickname: profileRef.current.nickname,
      avatarUrl: profileRef.current.avatarUrl,
    })

    const onStorage = (e: StorageEvent) => {
      if (e.key === `${UNO_LOBBY_PREFIX}${lobbyCode}`) {
        const next = safeJsonParse<UnoState>(e.newValue)
        if (!next) return
        const n = normalizeState(next)
        setState(n)
        writeSnapshot(lobbyCode, uid, n)
      }
      if (e.key === `${UNO_CLOSED_PREFIX}${lobbyCode}`) {
        setEndClosed(true)
        setState(null)
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [lobbyCode, isLoggedIn])

  // Host loop: process intents + heartbeat
  useEffect(() => {
    if (!state || !isHost || !lobbyCode) return
    let stopped = false

    const tick = () => {
      if (stopped) return
      let s = readUnoState(lobbyCode)
      if (!s) return
      s = normalizeState(s)
      if (s.hostId !== userIdRef.current) return

      const cursorKey = `uno_intents_cursor_${lobbyCode}`
      const cursor = parseInt(localStorage.getItem(cursorKey) || '0', 10) || 0
      const intents = readIntents(lobbyCode)
      const batch = intents.slice(cursor)

      let changed = false
      let next = s

      const commit = () => {
        next = { ...next, updatedAt: Date.now(), version: (next.version || 0) + 1 }
        writeUnoState(lobbyCode, next)
        writeSnapshot(lobbyCode, userIdRef.current, next)
        setState(next)
        changed = false
      }

      const ensurePlayer = (pid: string) => {
        const idx = next.players.findIndex(p => p.playerId === pid)
        return idx
      }

      const startGame = () => {
        const faces = makeDeck()
        const deck = shuffle(instantiateDeck(faces))
        const hands: Record<string, UnoCard[]> = { ...next.hands }
        let temp: UnoState = { ...next, drawPile: deck, discardPile: [], currentColor: null, direction: 1, winnerId: null, drawnPlayable: null }

        for (const p of temp.players) {
          const drawn = drawCards(temp, 7)
          temp = drawn.state
          hands[p.playerId] = drawn.cards
        }

        // choose starting card (no wilds)
        let start: UnoCard | null = null
        for (let k = 0; k < 20; k++) {
          const drawn = drawCards(temp, 1)
          temp = drawn.state
          const c = drawn.cards[0]
          if (!c) break
          if (c.face.kind === 'wild' || c.face.kind === 'wild4') {
            temp = { ...temp, drawPile: shuffle([...temp.drawPile, c]) }
            continue
          }
          start = c
          break
        }
        if (!start) {
          const drawn = drawCards(temp, 1)
          temp = drawn.state
          start = drawn.cards[0] || null
        }

        const dealerIndex = (temp.dealerIndex + 1) % temp.players.length
        const baseDir: 1 | -1 = 1
        let direction: 1 | -1 = baseDir
        let currentPlayerIndex = nextIndex(dealerIndex, baseDir, temp.players.length, 1)
        let currentColor: UnoColor | null = null
        const discardPile = start ? [start] : []
        if (start && start.face.kind !== 'wild' && start.face.kind !== 'wild4') currentColor = start.face.color

        let t2: UnoState = {
          ...temp,
          phase: 'playing',
          dealerIndex,
          direction,
          currentPlayerIndex,
          currentColor,
          discardPile,
          hands,
          winnerId: null,
          drawnPlayable: null,
        }

        if (start) {
          t2 = addLog(t2, `Game started — Starting card: ${cardLabel(start.face)}`)
          // apply start action
          if (start.face.kind === 'skip') {
            t2 = addLog(t2, `Start card effect: Skip`)
            t2 = { ...t2, currentPlayerIndex: nextIndex(dealerIndex, direction, t2.players.length, 2) }
          } else if (start.face.kind === 'draw2') {
            const victimIdx = nextIndex(dealerIndex, direction, t2.players.length, 1)
            const victim = t2.players[victimIdx]
            const drawn = drawCards(t2, 2)
            const victimHand = [...(t2.hands[victim.playerId] || []), ...drawn.cards]
            t2 = drawn.state
            t2 = { ...t2, hands: { ...t2.hands, [victim.playerId]: victimHand } }
            t2 = addLog(t2, `Start card effect: ${victim.nickname} draws 2 and is skipped`)
            t2 = { ...t2, currentPlayerIndex: nextIndex(dealerIndex, direction, t2.players.length, 2) }
          } else if (start.face.kind === 'reverse') {
            direction = (direction === 1 ? -1 : 1)
            if (t2.players.length === 2) {
              t2 = addLog(t2, `Start card effect: Reverse (acts as Skip)`)
              t2 = { ...t2, direction, currentPlayerIndex: dealerIndex }
            } else {
              t2 = addLog(t2, `Start card effect: Reverse`)
              t2 = { ...t2, direction, currentPlayerIndex: nextIndex(dealerIndex, direction, t2.players.length, 1) }
            }
          }
        }

        return t2
      }

      const applyPlay = (pid: string, cardId: string, chosenColor?: UnoColor) => {
        if (next.phase !== 'playing') return
        const idx = next.players.findIndex(p => p.playerId === pid)
        if (idx !== next.currentPlayerIndex) return
        const hand = [...(next.hands[pid] || [])]
        const ci = hand.findIndex(c => c.id === cardId)
        if (ci === -1) return
        if (next.drawnPlayable?.playerId === pid && next.drawnPlayable.cardId !== cardId) return

        const card = hand[ci]
        const top = next.discardPile.length ? next.discardPile[next.discardPile.length - 1].face : null
        const ok = isPlayableCard(card.face, top, next.currentColor)
        if (!ok) return
        if (card.face.kind === 'wild4' && next.currentColor && hasColor(hand, next.currentColor)) return
        if ((card.face.kind === 'wild' || card.face.kind === 'wild4') && !chosenColor) return

        hand.splice(ci, 1)
        let t = { ...next, hands: { ...next.hands, [pid]: hand }, discardPile: [...next.discardPile, card], drawnPlayable: null as UnoState['drawnPlayable'] }

        const player = t.players[t.currentPlayerIndex]
        const afterCount = hand.length
        const setColor = (c: UnoColor) => { t = { ...t, currentColor: c } }

        if (card.face.kind === 'wild' || card.face.kind === 'wild4') {
          setColor(chosenColor!)
          t = addLog(t, `${player.nickname} played ${cardLabel(card.face)} — Color: ${chosenColor!.toUpperCase()}`)
        } else {
          setColor(card.face.color)
          t = addLog(t, `${player.nickname} played ${cardLabel(card.face)}`)
        }

        if (afterCount === 1) {
          t = addLog(t, `${player.nickname} says UNO!`)
        }

        // win
        if (afterCount === 0) {
          t = { ...t, phase: 'finished', winnerId: pid }
          t = addLog(t, `${player.nickname} wins!`)
          next = t
          changed = true
          return
        }

        const n = t.players.length
        const dir = t.direction
        const cur = t.currentPlayerIndex

        const drawForNext = (amount: number) => {
          const victimIdx = nextIndex(cur, dir, n, 1)
          const victim = t.players[victimIdx]
          const drawn = drawCards(t, amount)
          const victimHand = [...(t.hands[victim.playerId] || []), ...drawn.cards]
          t = drawn.state
          t = { ...t, hands: { ...t.hands, [victim.playerId]: victimHand } }
          t = addLog(t, `${victim.nickname} draws ${amount} and is skipped`)
          t = { ...t, currentPlayerIndex: nextIndex(cur, dir, n, 2) }
        }

        if (card.face.kind === 'skip') {
          t = addLog(t, `Skip!`)
          t = { ...t, currentPlayerIndex: nextIndex(cur, dir, n, 2) }
        } else if (card.face.kind === 'reverse') {
          const ndir: 1 | -1 = dir === 1 ? -1 : 1
          t = addLog(t, `Reverse!`)
          if (n === 2) {
            // acts as skip
            t = { ...t, direction: ndir, currentPlayerIndex: cur }
          } else {
            t = { ...t, direction: ndir, currentPlayerIndex: nextIndex(cur, ndir, n, 1) }
          }
        } else if (card.face.kind === 'draw2') {
          t = addLog(t, `Draw Two!`)
          drawForNext(2)
        } else if (card.face.kind === 'wild4') {
          t = addLog(t, `Wild Draw Four!`)
          drawForNext(4)
        } else {
          t = { ...t, currentPlayerIndex: nextIndex(cur, dir, n, 1) }
        }

        next = t
        changed = true
      }

      const applyDraw = (pid: string) => {
        if (next.phase !== 'playing') return
        const idx = next.players.findIndex(p => p.playerId === pid)
        if (idx !== next.currentPlayerIndex) return
        if (next.drawnPlayable?.playerId === pid) return

        const hand = next.hands[pid] || []
        const top = next.discardPile.length ? next.discardPile[next.discardPile.length - 1].face : null
        const playableNow = hand.some(c => {
          if (!isPlayableCard(c.face, top, next.currentColor)) return false
          if (c.face.kind === 'wild4' && next.currentColor && hasColor(hand, next.currentColor)) return false
          return true
        })
        if (playableNow) return

        const drawn = drawCards(next, 1)
        const card = drawn.cards[0]
        let t = drawn.state
        if (!card) return
        const newHand = [...hand, card]
        t = { ...t, hands: { ...t.hands, [pid]: newHand } }
        const p = t.players[idx]
        t = addLog(t, `${p.nickname} drew 1 card`)

        const isPlayableDrawn = isPlayableCard(card.face, top, t.currentColor) && !(card.face.kind === 'wild4' && t.currentColor && hasColor(newHand, t.currentColor))
        if (isPlayableDrawn) {
          t = addLog(t, `Drawn card is playable`)
          t = { ...t, drawnPlayable: { playerId: pid, cardId: card.id } }
        } else {
          t = addLog(t, `${p.nickname} passes`)
          t = { ...t, currentPlayerIndex: nextIndex(t.currentPlayerIndex, t.direction, t.players.length, 1) }
        }

        next = t
        changed = true
      }

      const applyPass = (pid: string) => {
        if (next.phase !== 'playing') return
        const idx = next.players.findIndex(p => p.playerId === pid)
        if (idx !== next.currentPlayerIndex) return
        if (!next.drawnPlayable || next.drawnPlayable.playerId !== pid) return
        let t = { ...next, drawnPlayable: null }
        const p = t.players[idx]
        t = addLog(t, `${p.nickname} passes`)
        t = { ...t, currentPlayerIndex: nextIndex(t.currentPlayerIndex, t.direction, t.players.length, 1) }
        next = t
        changed = true
      }

      const resetForAgain = () => {
        let t: UnoState = { ...next, phase: 'lobby', winnerId: null, currentColor: null, drawPile: [], discardPile: [], drawnPlayable: null }
        t = addLog(t, `Host reset the table`)
        next = t
        changed = true
      }

      for (const intent of batch) {
        if (intent.type === 'join') {
          const i = ensurePlayer(intent.playerId)
          const ts = Date.now()
          if (i === -1) {
            if (next.players.length >= 10) continue
            const p: UnoPlayer = {
              playerId: intent.playerId,
              seatIndex: next.players.length,
              nickname: intent.nickname || 'Player',
              avatarUrl: intent.avatarUrl || null,
              isConnected: true,
              lastSeenAt: ts,
            }
            next = { ...next, players: [...next.players, p], hands: { ...next.hands, [intent.playerId]: next.hands[intent.playerId] || [] } }
            next = addLog(next, `${p.nickname} joined the lobby`)
            changed = true
          } else {
            const players = [...next.players]
            players[i] = { ...players[i], nickname: intent.nickname || players[i].nickname, avatarUrl: intent.avatarUrl ?? players[i].avatarUrl, isConnected: true, lastSeenAt: ts }
            next = { ...next, players }
            changed = true
          }
        }

        if (intent.type === 'disconnect') {
          const i = ensurePlayer(intent.playerId)
          if (i !== -1) {
            const players = [...next.players]
            players[i] = { ...players[i], isConnected: false, lastSeenAt: Date.now() }
            next = { ...next, players }
            changed = true
          }
        }

        if (intent.type === 'start') {
          if (intent.playerId !== next.hostId) continue
          if (next.phase !== 'lobby') continue
          if (next.players.length < 2) continue
          next = startGame()
          changed = true
        }

        if (intent.type === 'playAgain') {
          if (intent.playerId !== next.hostId) continue
          if (next.phase !== 'finished') continue
          resetForAgain()
        }

        if (intent.type === 'play') {
          applyPlay(intent.playerId, intent.cardId, intent.chosenColor)
        }

        if (intent.type === 'draw') {
          applyDraw(intent.playerId)
        }

        if (intent.type === 'pass') {
          applyPass(intent.playerId)
        }
      }

      localStorage.setItem(cursorKey, String(intents.length))
      if (changed) commit()
    }

    const interval = window.setInterval(tick, 180)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [state, isHost, lobbyCode])

  // Disconnect intent on close
  useEffect(() => {
    if (!isLoggedIn) return
    if (!lobbyCode) return
    const uid = userIdRef.current
    const onBeforeUnload = () => {
      pushIntent(lobbyCode, { id: nowId('uno_int'), ts: Date.now(), type: 'disconnect', playerId: uid })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [lobbyCode, isLoggedIn])

  const sendStart = useCallback(() => {
    if (!lobbyCode) return
    pushIntent(lobbyCode, { id: nowId('uno_int'), ts: Date.now(), type: 'start', playerId: userIdRef.current })
  }, [lobbyCode])

  const sendDraw = useCallback(() => {
    if (!lobbyCode) return
    pushIntent(lobbyCode, { id: nowId('uno_int'), ts: Date.now(), type: 'draw', playerId: userIdRef.current })
  }, [lobbyCode])

  const sendPass = useCallback(() => {
    if (!lobbyCode) return
    pushIntent(lobbyCode, { id: nowId('uno_int'), ts: Date.now(), type: 'pass', playerId: userIdRef.current })
  }, [lobbyCode])

  const sendPlay = useCallback((cardId: string, chosenColor?: UnoColor) => {
    if (!lobbyCode) return
    pushIntent(lobbyCode, { id: nowId('uno_int'), ts: Date.now(), type: 'play', playerId: userIdRef.current, cardId, chosenColor })
  }, [lobbyCode])

  const endLobby = useCallback(() => {
    if (!lobbyCode) return
    const s = readUnoState(lobbyCode)
    if (s?.hostId !== userIdRef.current) return
    localStorage.removeItem(`${UNO_LOBBY_PREFIX}${lobbyCode}`)
    localStorage.setItem(`${UNO_CLOSED_PREFIX}${lobbyCode}`, String(Date.now()))
    window.close()
  }, [lobbyCode])

  const playAgain = useCallback(() => {
    if (!lobbyCode) return
    pushIntent(lobbyCode, { id: nowId('uno_int'), ts: Date.now(), type: 'playAgain', playerId: userIdRef.current })
  }, [lobbyCode])

  const onCardClick = (c: UnoCard) => {
    if (!isMyTurn) return
    if (!playable.has(c.id)) return
    if (c.face.kind === 'wild' || c.face.kind === 'wild4') {
      setPendingWildCardId(c.id)
      setColorModalOpen(true)
      return
    }
    sendPlay(c.id)
  }

  const chooseWildColor = (color: UnoColor) => {
    if (!pendingWildCardId) return
    sendPlay(pendingWildCardId, color)
    setPendingWildCardId(null)
    setColorModalOpen(false)
  }

  // Auth gate — block unauthenticated users
  if (!isLoggedIn) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-auth-gate">
          <h2>Login Required</h2>
          <p>You must be logged in to join UNO lobbies.</p>
          <a href="/profile" className="btn-primary" style={{ textDecoration: 'none' }}>
            Go to Profile to Login
          </a>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-error">
          <h2>Error</h2>
          <p>{error}</p>
          <button className="btn-primary" onClick={() => window.close()}>Close</button>
        </div>
      </div>
    )
  }

  if (endClosed) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-error">
          <h2>Lobby Closed</h2>
          <p>The host ended the lobby.</p>
          <button className="btn-primary" onClick={() => window.close()}>Close</button>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-loading">
          <div className="spinner" />
          <p>Connecting to lobby...</p>
        </div>
      </div>
    )
  }

  const phaseLabel = state.phase === 'lobby' ? 'LOBBY' : state.phase === 'playing' ? 'PLAYING' : 'FINISHED'
  const dirLabel = state.direction === 1 ? '↻' : '↺'
  const colorLabel = state.currentColor ? state.currentColor.toUpperCase() : '—'
  const winner = state.winnerId ? state.players.find(p => p.playerId === state.winnerId) : null

  return (
    <div className="uno-page uno-page--standalone">
      <div className="uno-header">
        <div className="uno-header__info">
          <span className="uno-header__code">Lobby: {state.lobbyCode}</span>
          <span className="uno-header__phase">{phaseLabel}</span>
          <span className="uno-header__meta">Color: {colorLabel}</span>
          <span className="uno-header__meta">Direction: {dirLabel}</span>
        </div>

        {isHost && (
          <div className="uno-header__controls">
            {state.phase === 'lobby' && state.players.length >= 2 && (
              <button className="btn-primary" onClick={sendStart} style={{ width: 'auto', padding: '8px 16px' }}>
                Start Game
              </button>
            )}
            {state.phase === 'finished' && (
              <button className="btn-primary" onClick={playAgain} style={{ width: 'auto', padding: '8px 16px' }}>
                Play Again
              </button>
            )}
            <button className="btn-secondary" onClick={endLobby} style={{ width: 'auto', padding: '8px 16px' }}>
              End Lobby
            </button>
          </div>
        )}
      </div>

      <div className="uno-main">
        <div className="uno-table-wrapper">
          <div className="uno-table">
            <div className="uno-table__felt">
              <div className="uno-table__logo">
                <img src={tableLogo} alt="Bulk Games" />
              </div>

              <div className="uno-center">
                <div className="uno-deck" aria-label="Draw deck">
                  <div className="uno-deck__stack" />
                  <div className="uno-deck__count">{state.drawPile.length}</div>
                </div>

                <div className="uno-discard" aria-label="Discard pile">
                  {topCard ? (
                    <UnoCardImg
                      key={topCard.id}
                      card={topCard}
                      images={images}
                      className="uno-discard__card"
                    />
                  ) : (
                    <div className="uno-discard__empty" />
                  )}
                </div>
              </div>
            </div>

            <div className="uno-table__seats">
              {state.players.map((p, idx) => {
                const isTurn = state.phase === 'playing' && idx === state.currentPlayerIndex
                const isMe = p.playerId === userIdRef.current
                const isWinner = state.phase === 'finished' && state.winnerId === p.playerId
                const cards = state.hands[p.playerId] || []
                const uno = state.phase === 'playing' && cards.length === 1
                const style = seatPos(idx, state.players.length)

                return (
                  <div
                    key={p.playerId}
                    className={`uno-seat ${isTurn ? 'uno-seat--active' : ''} ${isMe ? 'uno-seat--me' : ''} ${isWinner ? 'uno-seat--winner' : ''} ${!p.isConnected ? 'uno-seat--disconnected' : ''}`}
                    style={style}
                  >
                    <div className="uno-seat__avatar">
                      {p.avatarUrl ? <img src={p.avatarUrl} alt={p.nickname} /> : <span>👤</span>}
                    </div>
                    <div className="uno-seat__info">
                      <span className="uno-seat__name">{p.nickname}</span>
                      <span className="uno-seat__count">{cards.length} cards</span>
                    </div>
                    {uno && <div className="uno-seat__uno">UNO!</div>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="uno-log">
          <div className="uno-log__title">Action Log</div>
          <div className="uno-log__entries">
            {state.actionLog.slice().reverse().map((e) => (
              <div key={e.id} className="uno-log__entry">
                <span className="uno-log__text">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {state.phase === 'lobby' && (
        <div className="uno-waiting">
          <h3>Waiting for game to start...</h3>
          <p>{state.players.length} player{state.players.length !== 1 ? 's' : ''} in lobby</p>
          <div className="uno-waiting__players">
            {state.players.map(p => (
              <div key={p.playerId} className="uno-waiting__player">
                <div className="uno-waiting__avatar">
                  {p.avatarUrl ? <img src={p.avatarUrl} alt={p.nickname} /> : '👤'}
                </div>
                <span>{p.nickname}</span>
                {p.playerId === state.hostId && <span className="uno-waiting__host">Host</span>}
              </div>
            ))}
          </div>
          {!isHost && <p className="muted">Waiting for host to start the game...</p>}
        </div>
      )}

      {state.phase === 'playing' && (
        <div className="uno-bottom-bar">
          <div className="uno-actions">
            <div className="uno-actions__status">
              {isMyTurn ? (
                <>
                  <span className="uno-actions__turn">Your turn</span>
                  {drawnPlayable ? (
                    <span className="muted">You drew a playable card — play it or pass</span>
                  ) : hasAnyPlayable ? (
                    <span className="muted">Play a card</span>
                  ) : (
                    <span className="muted">No playable cards — draw 1</span>
                  )}
                </>
              ) : (
                <>
                  <span className="uno-actions__turn">
                    {state.phase === 'playing' ? `${currentPlayer?.nickname || 'Player'}'s turn` : 'Waiting...'}
                  </span>
                  {me && <span className="muted">You have {myHand.length} cards</span>}
                </>
              )}
            </div>

            <div className="uno-actions__buttons">
              {isMyTurn && !drawnPlayable && (
                <button className="btn-primary uno-actions__btn" onClick={sendDraw} disabled={hasAnyPlayable}>
                  Draw
                </button>
              )}
              {isMyTurn && drawnPlayable && (
                <button className="btn-secondary uno-actions__btn" onClick={sendPass}>
                  Pass
                </button>
              )}
              <button className="btn-secondary uno-actions__btn" onClick={() => (window.location.href = '/main-menu')}>
                Back to Main Menu
              </button>
            </div>
          </div>

          <div className="uno-hand" aria-label="Your hand">
            <div className="uno-hand__fan">
              {myHand.map((c, i) => {
                const n = myHand.length
                const spread = clamp(n, 1, 14)
                const center = (n - 1) / 2
                const offset = (i - center)
                const rot = offset * (spread <= 6 ? 6 : 4)
                const x = offset * (spread <= 6 ? 36 : 28)
                const y = Math.abs(offset) * 2
                const style = { transform: `translateX(${x}px) translateY(${y}px) rotate(${rot}deg)` }
                const canClick = isMyTurn && playable.has(c.id)
                const dim = isMyTurn && !playable.has(c.id)
                return (
                  <div key={c.id} className="uno-hand__card" style={style}>
                    <UnoCardImg
                      card={c}
                      images={images}
                      glow={canClick}
                      dimmed={dim}
                      onClick={canClick ? () => onCardClick(c) : undefined}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {state.phase === 'finished' && (
        <div className="uno-end-overlay">
          <div className="uno-end-card">
            <h2>Game Over</h2>
            <p className="muted">{winner ? `${winner.nickname} wins!` : 'Winner decided.'}</p>
            <div className="uno-end-actions">
              {isHost && (
                <button className="btn-primary" onClick={playAgain}>
                  Play Again
                </button>
              )}
              <button className="btn-secondary" onClick={() => (window.location.href = '/main-menu')}>
                Back to Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={colorModalOpen}
        onClose={() => { setColorModalOpen(false); setPendingWildCardId(null) }}
        title="Choose a Color"
      >
        <div className="uno-color-picker">
          <button className="btn-secondary" onClick={() => chooseWildColor('red')}>Red</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('green')}>Green</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('blue')}>Blue</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('yellow')}>Yellow</button>
        </div>
      </Modal>
    </div>
  )
}

export default Uno

