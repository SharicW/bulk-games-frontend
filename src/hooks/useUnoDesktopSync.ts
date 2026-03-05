import { useEffect, useRef, useState } from 'react'
import { unoSocket } from '../services/socket'
import { sfx } from '../services/sfx'
import type { UnoClientState } from '../types/uno'

export function useUnoSync(lobbyCode: string, isLoggedIn: boolean, userId: string | undefined) {
    const [state, setState] = useState<UnoClientState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [connected, setConnected] = useState(unoSocket.connected)

    const [unoPrompt, setUnoPrompt] = useState<UnoClientState['unoPrompt'] | null>(null)
    const [celebration, setCelebration] = useState<null | { id: string; effectId: string }>(null)
    const [oppDrawFlash, setOppDrawFlash] = useState<{ id: string } | null>(null)

    const celebrationTimerRef = useRef<number | null>(null)
    const prevStateRef = useRef<UnoClientState | null>(null)

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

    useEffect(() => {
        if (!isLoggedIn || !userId) return
        if (!lobbyCode) {
            setError('No lobby code provided')
            return
        }

        const handleConnect = () => setConnected(true)
        const handleDisconnect = () => setConnected(false)

        let stopped = false
        const join = async () => {
            try {
                const result = await unoSocket.joinLobby(lobbyCode)
                if (stopped) return
                if (result.success && result.gameState) {
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
            }
        }

        const connectAndJoin = async () => {
            try {
                if (!unoSocket.connected) {
                    await unoSocket.connect()
                }
                if (stopped) return
                setConnected(true)
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

            // Dumb state hydration: no RAF coalescing, no versions.
            setState(next)

            if (next.unoPrompt?.active !== undefined) {
                setUnoPrompt(next.unoPrompt)
            }
        })

        const unsubscribeRoster = unoSocket.on('uno:roster', (payload) => {
            const p = payload as any
            setState(prev => {
                if (!prev) return prev
                if (prev.phase !== 'lobby') return prev
                const players = Array.isArray(p?.players) ? p.players : prev.players
                return { ...prev, players }
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
            handleConnect()
            if (!stopped && lobbyCode) {
                join().catch(err => {
                    if (!stopped) console.warn('[uno:reconnect] join failed:', err?.message || err)
                })
            }
        })

        const unsubscribeDisconnectOrig = unoSocket.on('disconnect', handleDisconnect)

        const unsubscribeDrawFx = unoSocket.on('uno:drawFx', (payload) => {
            const p = payload as { playerId?: string | number }
            if (!p?.playerId) return
            if (String(p.playerId) === String(userId)) return
            setOppDrawFlash({ id: `drawfx_${p.playerId}_${Date.now()}` })
        })

        const unsubscribeUnoPrompt = unoSocket.on('uno:prompt', (payload) => {
            setUnoPrompt(payload as UnoClientState['unoPrompt'])
        })

        return () => {
            stopped = true
            unsubscribeState()
            unsubscribeRoster()
            unsubscribeCelebration()
            unsubscribeEnd()
            unsubscribeConnect()
            unsubscribeDisconnectOrig()
            unsubscribeDrawFx()
            unsubscribeUnoPrompt()
            if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current)
            // STRICT RULE: No unoSocket.disconnect() here
        }
    }, [lobbyCode, isLoggedIn, userId])

    return { state, setState, connected, error, setError, unoPrompt, setUnoPrompt, oppDrawFlash, setOppDrawFlash, celebration }
}
