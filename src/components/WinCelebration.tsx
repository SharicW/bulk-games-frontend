import { motion, AnimatePresence } from 'framer-motion'
import { useMemo } from 'react'

type CelebrationEffectId = 'stars' | 'red_hearts' | 'black_hearts'

const COUNT = 20
const STAR_COLORS = ['#ffd700', '#ffec8b', '#fff8dc', '#fffacd', '#f0e68c', '#ffa500', '#fff']
const REDS = ['#ff3b3b', '#ff5a5a', '#ff7a7a', '#ff2d55', '#ff453a']

function glyph(effectId: CelebrationEffectId): { char: string; color: (i: number) => string } {
  if (effectId === 'red_hearts') return { char: '♥', color: (i) => REDS[i % REDS.length] }
  if (effectId === 'black_hearts') return { char: '♥', color: () => '#111' }
  return { char: '★', color: (i) => STAR_COLORS[i % STAR_COLORS.length] }
}

export default function WinCelebration({ show, effectId = 'stars' }: { show: boolean; effectId?: CelebrationEffectId }) {
  const conf = glyph(effectId)
  const particles = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        id: i,
        x: 10 + Math.random() * 80,
        y: 12 + Math.random() * 70,
        size: 14 + Math.random() * 18,
        color: conf.color(i),
        delay: Math.random() * 0.55,
        dx: (Math.random() - 0.5) * 210,
        dy: -(60 + Math.random() * 170),
        rotate: Math.random() * 540 - 270,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [show, effectId],
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
          {particles.map((s) => (
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
                duration: 2.0,
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
              {conf.char}
            </motion.span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

