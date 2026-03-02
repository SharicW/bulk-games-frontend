import React, { memo } from 'react'
import { motion } from 'framer-motion'
import { UnoCardImg } from '../pages/Uno'
import type { UnoCard } from '../types/uno'

export const UnoDesktopHand = memo(function UnoDesktopHand({
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
            {visibleHand.map((c, i) => {
                const n = visibleHand.length
                const gap = n <= 5 ? 52 : n <= 9 ? 40 : 28
                const rotStep = n <= 5 ? 6 : n <= 9 ? 4 : 2.5
                const center = (n - 1) / 2
                const offset = i - center
                const rot = offset * rotStep
                const xVal = offset * gap
                const yVal = Math.abs(offset) * 2.5
                const canClick = isMyTurn && playable.has(c.id)

                return (
                    <motion.div
                        key={c.id}
                        className="uno-hand__card"
                        data-card-id={c.id}
                        style={{ transformOrigin: 'center bottom' }}
                        animate={{ x: xVal, y: yVal, rotate: rot, zIndex: i + 1, scale: 1 }}
                        whileHover={canClick ? { y: yVal - 26, scale: 1.15, zIndex: 100 } : undefined}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <UnoCardImg
                            card={c}
                            images={images}
                            glow={canClick}
                            onCardClick={canClick ? onCardClick : undefined}
                        />
                    </motion.div>
                )
            })}
        </div>
    )
})
