import React, { memo } from 'react'
import { motion } from 'framer-motion'
import { UnoCardImg } from '../pages/Uno'
import type { UnoCard } from '../types/uno'

const MobileCard = memo(function MobileCard({
    card,
    index,
    totalCards,
    canClick,
    images,
    onCardClick
}: {
    card: UnoCard
    index: number
    totalCards: number
    canClick: boolean
    images: Record<string, string[]>
    onCardClick: (c: UnoCard) => void
}) {
    const n = totalCards
    const gap = n <= 5 ? 44 : n <= 9 ? 34 : 22
    const rotStep = n <= 5 ? 6 : n <= 9 ? 4 : 2.5
    const center = (n - 1) / 2
    const offset = index - center
    const rot = offset * rotStep
    const xVal = offset * gap
    const yVal = Math.abs(offset) * 2.5

    return (
        <motion.div
            className="uno-hand__card"
            data-card-id={card.id}
            style={{ transformOrigin: 'center bottom', x: xVal, y: yVal, rotate: rot, zIndex: index + 1 }}
            animate={{ x: xVal, y: yVal, rotate: rot, scale: 1 }}
            transition={{ duration: 0.12 }}
        >
            <UnoCardImg
                card={card}
                images={images}
                glow={canClick}
                onCardClick={canClick ? onCardClick : undefined}
            />
        </motion.div>
    )
})

export const UnoMobileHand = memo(function UnoMobileHand({
    visibleHand,
    playable,
    images,
    isMyTurn,
    onCardClick,
}: {
    visibleHand: UnoCard[]
    playable: Set<string>
    images: Record<string, string[]>
    isMyTurn: boolean
    onCardClick: (c: UnoCard) => void
}) {
    return (
        <div className="uno-hand__fan">
            {visibleHand.map((c, i) => (
                <MobileCard
                    key={c.id}
                    card={c}
                    index={i}
                    totalCards={visibleHand.length}
                    canClick={isMyTurn && playable.has(c.id)}
                    images={images}
                    onCardClick={onCardClick}
                />
            ))}
        </div>
    )
})
