import { motion, AnimatePresence } from 'framer-motion'
import { useMemo } from 'react'

type CelebrationEffectId = 'stars' | 'red_hearts' | 'black_hearts' | 'fire_burst' | 'sakura_petals'

interface Particle {
  id: number; x: number; y: number; size: number; color: string
  delay: number; dx: number; dy: number; rotate: number
}

const STAR_COLORS = ['#ffd700', '#ffec8b', '#fff8dc', '#fffacd', '#f0e68c', '#ffa500', '#fff']
const REDS = ['#ff3b3b', '#ff5a5a', '#ff7a7a', '#ff2d55', '#ff453a']
const FIRE = ['#ff7a18', '#ff4d00', '#ff2d55', '#ffd27a']
const SAKURA = ['#ffd1e8', '#ffb6d5', '#ff8fc1', '#ffc2dc']

function conf(effectId: CelebrationEffectId): {
  kind: 'glyph' | 'dot'
  char?: string
  count: number
  duration: number
  color: (i: number) => string
} {
  if (effectId === 'fire_burst') {
    return { kind: 'dot', count: 36, duration: 3.0, color: (i) => FIRE[i % FIRE.length] }
  }
  if (effectId === 'sakura_petals') {
    return { kind: 'glyph', char: '❀', count: 18, duration: 3.2, color: (i) => SAKURA[i % SAKURA.length] }
  }
  if (effectId === 'red_hearts') return { kind: 'glyph', char: '♥', count: 18, duration: 2.6, color: (i) => REDS[i % REDS.length] }
  if (effectId === 'black_hearts') return { kind: 'glyph', char: '♥', count: 18, duration: 2.6, color: () => '#111' }
  return { kind: 'glyph', char: '★', count: 20, duration: 2.6, color: (i) => STAR_COLORS[i % STAR_COLORS.length] }
}

export default function WinCelebration({ show, effectId = 'stars' }: { show: boolean; effectId?: CelebrationEffectId }) {
  const c = conf(effectId)
  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: c.count }, (_, i) => ({
        id: i,
        x:
          effectId === 'fire_burst'
            ? 8 + Math.random() * 84
            : 10 + Math.random() * 80,
        y:
          effectId === 'fire_burst'
            ? 30 + Math.random() * 55
            : effectId === 'sakura_petals'
              ? -8 - Math.random() * 14
              : 12 + Math.random() * 70,
        size:
          effectId === 'fire_burst'
            ? 5 + Math.random() * 9
            : 14 + Math.random() * 18,
        color: c.color(i),
        delay: Math.random() * (effectId === 'fire_burst' ? 0.5 : 0.55),
        dx:
          effectId === 'fire_burst'
            ? (Math.random() - 0.5) * 120
            : effectId === 'sakura_petals'
              ? (Math.random() - 0.5) * 180
              : (Math.random() - 0.5) * 210,
        dy:
          effectId === 'fire_burst'
            ? -(50 + Math.random() * 200)
            : effectId === 'sakura_petals'
              ? 420 + Math.random() * 220
              : -(60 + Math.random() * 170),
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
                duration: c.duration,
                delay: s.delay,
                ease: 'easeOut',
              }}
              style={{
                position: 'absolute',
                fontSize: c.kind === 'glyph' ? s.size : undefined,
                color: c.kind === 'glyph' ? s.color : undefined,
                textShadow: c.kind === 'glyph' ? `0 0 8px ${s.color}` : undefined,
                width: c.kind === 'dot' ? s.size : undefined,
                height: c.kind === 'dot' ? s.size : undefined,
                borderRadius: c.kind === 'dot' ? 999 : undefined,
                background:
                  c.kind === 'dot'
                    ? `radial-gradient(circle at 30% 30%, #fff, ${s.color} 55%, rgba(0,0,0,0) 72%)`
                    : undefined,
                boxShadow: c.kind === 'dot' ? `0 0 10px ${s.color}` : undefined,
                lineHeight: 1,
                pointerEvents: 'none',
              }}
            >
              {c.kind === 'glyph' ? c.char : ''}
            </motion.span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

