import { motion, AnimatePresence } from 'framer-motion'
import { useMemo } from 'react'

const STAR_COUNT = 18
const COLORS = ['#ffd700', '#ffec8b', '#fff8dc', '#fffacd', '#f0e68c', '#ffa500', '#fff']

export default function WinCelebration({ show }: { show: boolean }) {
  const stars = useMemo(
    () =>
      Array.from({ length: STAR_COUNT }, (_, i) => ({
        id: i,
        x: 10 + Math.random() * 80,
        y: 10 + Math.random() * 80,
        size: 14 + Math.random() * 18,
        color: COLORS[i % COLORS.length],
        delay: Math.random() * 0.35,
        dx: (Math.random() - 0.5) * 180,
        dy: -(40 + Math.random() * 120),
        rotate: Math.random() * 540 - 270,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [show],
  )

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="win-celebration-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {stars.map((s) => (
            <motion.span
              key={s.id}
              initial={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                scale: 0,
                rotate: 0,
                opacity: 0,
              }}
              animate={{
                x: s.dx,
                y: s.dy,
                scale: [0, 1.3, 1, 0.6],
                rotate: s.rotate,
                opacity: [0, 1, 1, 0],
              }}
              transition={{
                duration: 1.5,
                delay: s.delay,
                ease: 'easeOut',
              }}
              style={{
                position: 'absolute',
                fontSize: s.size,
                color: s.color,
                textShadow: `0 0 8px ${s.color}`,
                lineHeight: 1,
                pointerEvents: 'none',
              }}
            >
              ★
            </motion.span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

