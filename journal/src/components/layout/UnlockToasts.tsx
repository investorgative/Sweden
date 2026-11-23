import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAnalytics } from '@/store/analytics'
import { useJournal } from '@/store/useJournal'
import { Badge } from '@/components/Badge'
import { Confetti } from '@/components/Confetti'
import { TIER_META, type AchievementState } from '@/lib/achievements'

/** Shows a celebratory toast + confetti when a new achievement is unlocked. */
export function UnlockToasts() {
  const { lifetime } = useAnalytics()
  const seen = useJournal((s) => s.seenAchievements)
  const markSeen = useJournal((s) => s.markSeen)
  const [queue, setQueue] = useState<AchievementState[]>([])
  const [burst, setBurst] = useState(0)
  const nav = useNavigate()

  useEffect(() => {
    const unlocked = lifetime.achievements.filter((a) => a.unlocked)
    // First run: silently acknowledge history so we only celebrate new unlocks.
    if (seen.length === 0) {
      if (unlocked.length) markSeen(unlocked.map((a) => a.id))
      return
    }
    const fresh = unlocked.filter((a) => !seen.includes(a.id))
    if (fresh.length) {
      setQueue((q) => [...q, ...fresh])
      setBurst((b) => b + 1)
      markSeen(fresh.map((a) => a.id))
    }
  }, [lifetime.achievements, seen, markSeen])

  useEffect(() => {
    if (!queue.length) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 5200)
    return () => clearTimeout(t)
  }, [queue])

  const a = queue[0]
  return (
    <>
      <Confetti burst={burst} />
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[95] flex justify-center px-4">
          <AnimatePresence>
            {a && (
              <motion.button
                key={a.id}
                onClick={() => (setQueue((q) => q.slice(1)), nav('/achievements'))}
                initial={{ y: -40, opacity: 0, scale: 0.9 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -30, opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="card pointer-events-auto flex items-center gap-4 bg-bg-2/95 py-3 pl-3 pr-6 text-left shadow-2xl"
                style={{ boxShadow: `0 20px 60px -15px ${TIER_META[a.tier].glow}` }}
              >
                <Badge tier={a.tier} icon={a.icon} unlocked size={56} />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: TIER_META[a.tier].color }}>
                    Achievement unlocked · {TIER_META[a.tier].label}
                  </div>
                  <div className="font-display text-2xl leading-tight">{a.name}</div>
                  <div className="text-xs text-ink-3">
                    {a.description} · +{TIER_META[a.tier].xp} XP
                  </div>
                </div>
              </motion.button>
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </>
  )
}
