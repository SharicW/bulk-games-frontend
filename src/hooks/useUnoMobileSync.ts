import { useEffect, useRef, useState, useCallback } from 'react'
import { unoSocket } from '../services/socket'
import { sfx } from '../services/sfx'
import type { UnoClientState, UnoColor } from '../types/uno'

export function useUnoMobileSync(lobbyCode: string, isLoggedIn: boolean, userId: string | undefined) {
    const [state, setState] = useState<UnoClientState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [connected, setConnected] = useState(false)

    const [unoPrompt, setUnoPrompt] = useState<UnoClientState['unoPrompt'] | null>(null)
    const [celebration, setCelebration] = useState<null | { id: string; effectId: string }>(null)
    const [oppDrawFlash, setOppDrawFlash] = useState<{ id: string } | null>(null)

    const celebrationTimerRef = useRef<number | null>(null)
    const lastVersionRef = useRef<number>(0)
    const resyncingRef = useRef(false)
    const prevStateRef = useRef<UnoClientState | null>(null)

    // ── RAF coalesced state updates ────────────────────────────────
    const latestStateRef = useRef<UnoClientState | null>(null)
    const rafScheduledRef = useRef(false)

    // SFX: state-diff effect — fires sounds based on game state transitions
    useEffect(() => {
        if (!state || !userId) {
            prevStateRef.current = null
            return
        }

        const prev = prevStateRef.current
        prevStateRef.current = state

        if (!prev) return

        // Phase: lobby → playing (game starts)
        if (prev.phase !== 'playing' && state.phase === 'playing') {
            sfx.play('game_start', { cooldownMs: 3000 })
            setTimeout(() => sfx.play('deal', { cooldownMs: 0 }), 250)
            setTimeout(() => sfx.play('deal', { cooldownMs: 0 }), 500)
            return
        }

        // Phase: playing → finished (game over)
        if (prev.phase === 'playing' && state.phase === 'finished') {
            if (state.winnerId === userId) {
                sfx.play('win', { cooldownMs: 3000 })
            } else {
                sfx.play('game_end', { cooldownMs: 3000 })
            }
            return
        }

        if (state.phase !== 'playing') return

        // Turn change: now my turn
        const prevTurnId = prev.players[prev.currentPlayerIndex]?.playerId
        const currTurnId = state.players[state.currentPlayerIndex]?.playerId
        if (prevTurnId !== currTurnId && currTurnId === userId) {
            sfx.play('card_select', { cooldownMs: 500 })
        }

        // Top card changed → a card was played
        const prevTop = prev.discardPile?.[prev.discardPile.length - 1]
        const currTop = state.discardPile?.[state.discardPile.length - 1]

        if (currTop && prevTop?.id !== currTop.id) {
            if (prevTurnId && prevTurnId !== userId) {
                switch (currTop.face.kind) {
                    case 'reverse':
                        sfx.play('card_reverse', { cooldownMs: 300 })
                        break
                    case 'skip':
                        sfx.play('card_skip', { cooldownMs: 300 })
                        break
                    case 'draw2':
                    case 'wild4':
                        sfx.play('card_punish', { cooldownMs: 300 })
                        break
                    case 'wild':
                        sfx.play('wild_card', { cooldownMs: 300 })
                        break
                    default:
                        sfx.play('card_play_other', { cooldownMs: 200 })
                }
            }
        }
    }, [state, userId])

    const applyState = useCallback((incoming: UnoClientState) => {
        const incomingVersion = incoming.version ?? 0
        const lastVersion = lastVersionRef.current

        // Detect version gap → resync
        if (incomingVersion > lastVersion + 1 && lastVersion > 0 && !resyncingRef.current) {
            resyncingRef.current = true
            unoSocket.requestFullState(incoming.lobbyCode).then(res => {
                resyncingRef.current = false
                if (res.success && res.gameState) {
                    lastVersionRef.current = res.gameState.version ?? 0
                    setState(res.gameState)
                    setUnoPrompt(res.gameState.unoPrompt)
                }
            }).catch(() => { resyncingRef.current = false })
        }

        // Identical version short-circuit: stops React re-render queue spam
        if (incomingVersion === lastVersion && lastVersion > 0) {
            setUnoPrompt((prev: UnoClientState['unoPrompt'] | null) => {
                if (prev?.active !== incoming.unoPrompt?.active) return incoming.unoPrompt;
                return prev;
            })
            return
        }

        lastVersionRef.current = incomingVersion

        // MOBILE: strictly coalesce updates per animation frame to prevent clogging UI thread
        latestStateRef.current = incoming

        if (!rafScheduledRef.current) {
            rafScheduledRef.current = true
            requestAnimationFrame(() => {
                rafScheduledRef.current = false
                const s = latestStateRef.current
                if (s) {
                    latestStateRef.current = null

                    setState((prev: UnoClientState | null) => {
                        if (prev) {
                            const isStateChanged = () => {
                                if (prev.phase !== s.phase) return true;
                                if (prev.currentPlayerIndex !== s.currentPlayerIndex) return true;
                                if (prev.currentColor !== s.currentColor) return true;
                                if (prev.drawPileCount !== s.drawPileCount) return true;
                                if (prev.direction !== s.direction) return true;
                                if (prev.mustCallUno !== s.mustCallUno) return true;
                                if (prev.winnerId !== s.winnerId) return true;
                                if (prev.actionLog?.length !== s.actionLog?.length) return true;
                                if (prev.discardPile?.length !== s.discardPile?.length) return true;
                                if (prev.players.length !== s.players.length) return true;
                                for (let i = 0; i < prev.players.length; i++) {
                                    if (prev.players[i].cardCount !== s.players[i].cardCount ||
                                        prev.players[i].isConnected !== s.players[i].isConnected) return true;
                                }
                                if (userId) {
                                    const hA = prev.hands?.[userId] || [];
                                    const hB = s.hands?.[userId] || [];
                                    if (hA.length !== hB.length) return true;
                                    for (let i = 0; i < hA.length; i++) {
                                        if (hA[i].id !== hB[i].id) return true;
                                    }
                                }
                                if (prev.drawnPlayable?.cardId !== s.drawnPlayable?.cardId) return true;
                                if (prev.unoPrompt?.active !== s.unoPrompt?.active) return true;
                                return false;
                            }
                            if (!isStateChanged()) {
                                return prev;
                            }
                        }
                        return s;
                    })

                    setUnoPrompt((prev: UnoClientState['unoPrompt'] | null) => {
                        if (prev?.active !== s.unoPrompt?.active) return s.unoPrompt;
                        return prev;
                    })
                }
            })
        }
    }, [userId])

    useEffect(() => {
        if (!isLoggedIn || !userId) return
        if (!lobbyCode) {
            setError('No lobby code provided')
            return
        }

        let stopped = false
        let initialJoinDone = false
        let joinInFlight = false

        const join = async () => {
            if (joinInFlight) return
            joinInFlight = true
            try {
                const result = await unoSocket.joinLobby(lobbyCode)
                if (stopped) return
                if (result.success && result.gameState) {
                    const v = result.gameState.version ?? 0
                    lastVersionRef.current = Math.max(lastVersionRef.current, v)
                    latestStateRef.current = null // kill RAF payload
                    setState(result.gameState)
                    setUnoPrompt(result.gameState.unoPrompt)
                    setError(null)
                } else {
                    setError(result.error || 'Failed to join lobby')
                }
            } catch (err: any) {
                if (!stopped) {
                    console.warn('[uno:join] error:', err?.message || err)
                    setError('Failed to join lobby — retrying…')
                    setTimeout(() => { if (!stopped) setError(null) }, 4000)
                }
            } finally {
                joinInFlight = false
            }
        }

        const connectAndJoin = async () => {
            try {
                await unoSocket.connect()
                if (stopped) return
                setConnected(true)
                initialJoinDone = true
                await join()
            } catch (err) {
                if (!stopped) setError('Failed to connect to server')
                console.error(err)
            }
        }

        connectAndJoin()

        const unsubscribeState = unoSocket.on('gameState', (data) => {
            const next = data as UnoClientState
            if (!next || next.gameType !== 'uno') return
            applyState(next)
        })

        const unsubscribeRoster = unoSocket.on('uno:roster', (payload) => {
            const p = payload as any
            setState((prev: UnoClientState | null) => {
                if (!prev) return prev
                if (prev.phase !== 'lobby') return prev
                const v = Number(p?.version ?? prev.version)
                const players = Array.isArray(p?.players) ? p.players : prev.players
                return { ...prev, players, version: Math.max(prev.version ?? 0, v) }
            })
        })

        const unsubscribeCelebration = unoSocket.on('game:celebration', (payload) => {
            const p = payload as any
            const id = String(p?.id || '')
            const effectId = (p?.effectId || 'stars') as string
            if (!id) return
            setCelebration({ id, effectId })
            if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current)
            celebrationTimerRef.current = window.setTimeout(() => setCelebration(null), 4000)
        })

        const unsubscribeEnd = unoSocket.on('lobbyEnded', () => {
            setError('Lobby has been closed by the host')
        })

        const unsubscribeConnect = unoSocket.on('connect', () => {
            if (!stopped && lobbyCode && initialJoinDone) {
                join().catch(err => {
                    if (!stopped) console.warn('[uno:reconnect] join failed:', err?.message || err)
                })
            }
        })

        const unsubscribeDrawFx = unoSocket.on('uno:drawFx', (payload) => {
            const p = payload as { playerId?: string | number }
            if (!p?.playerId) return
            if (String(p.playerId) === String(userId)) return
            setOppDrawFlash({ id: `drawfx_${p.playerId}_${Date.now()}` })
        })

        // Immediate UNO Prompt pop-up
        const unsubscribeUnoPrompt = unoSocket.on('uno:prompt', (payload) => {
            setUnoPrompt(payload as UnoClientState['unoPrompt'])
        })

        // ── Page-visibility restore (mobile: tab returns from background) ──
        const lastHiddenTimeRef = { current: 0 }
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                lastHiddenTimeRef.current = Date.now()
                return
            }

            if (document.visibilityState !== 'visible' || stopped || !lobbyCode) return

            const timeHidden = Date.now() - lastHiddenTimeRef.current
            if (unoSocket.isConnected() && timeHidden > 5000) {
                unoSocket.requestState(lobbyCode).then(res => {
                    if (!stopped && res.success && res.gameState) {
                        applyState(res.gameState)
                    }
                }).catch(() => { /* ignore */ })
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            stopped = true
            unsubscribeState()
            unsubscribeRoster()
            unsubscribeCelebration()
            unsubscribeEnd()
            unsubscribeConnect()
            unsubscribeDrawFx()
            unsubscribeUnoPrompt()
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current)
            unoSocket.disconnect()
        }
    }, [lobbyCode, isLoggedIn, userId, applyState])

    return { state, setState, connected, error, setError, unoPrompt, setUnoPrompt, oppDrawFlash, setOppDrawFlash, celebration }
}
