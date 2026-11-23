import { Award, Bell, Book, Calendar, Coins, Crosshair, Crown, Diamond, Flame, Gem, House, Lock, Mountain, PenLine, RefreshCw, Rocket, Shield, Snowflake, Sparkles, Sun, TrendingUp, Zap, type LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { useId } from 'react'
import { TIER_META, type Tier } from '@/lib/achievements'

export const ICONS: Record<string, LucideIcon> = {
  bell: Bell,
  sparkles: Sparkles,
  book: Book,
  pen: PenLine,
  coins: Coins,
  gem: Gem,
  crown: Crown,
  home: House,
  sun: Sun,
  flame: Flame,
  crosshair: Crosshair,
  rocket: Rocket,
  zap: Zap,
  trending: TrendingUp,
  refresh: RefreshCw,
  mountain: Mountain,
  calendar: Calendar,
  award: Award,
  shield: Shield,
  snow: Snowflake,
  lock: Lock,
  diamond: Diamond,
}

const TIER_GRAD: Record<Tier, [string, string, string]> = {
  bronze: ['#f0c39b', '#c98a5a', '#6e4527'],
  silver: ['#f4f7fb', '#b9c2ce', '#5d6672'],
  gold: ['#fff0c7', '#e3c48d', '#8a6532'],
  platinum: ['#e6fffb', '#9fe6e0', '#3b8a85'],
  legendary: ['#f1e6ff', '#c4a2ff', '#5a3aa0'],
}

/** Medal-style badge. Hexagon for higher tiers, circle for bronze/silver. */
export function Badge({ tier, icon, unlocked, progress = 0, size = 72, shine = true }: { tier: Tier; icon: string; unlocked: boolean; progress?: number; size?: number; shine?: boolean }) {
  const id = useId().replace(/:/g, '')
  const Icon = ICONS[icon] ?? Award
  const [a, b, c] = TIER_GRAD[tier]
  const hex = tier === 'gold' || tier === 'platinum' || tier === 'legendary'
  const shape = hex ? 'M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z' : 'M50 6 A44 44 0 1 1 49.99 6 Z'
  const inner = hex ? 'M50 14 L82 32 L82 68 L50 86 L18 68 L18 32 Z' : 'M50 15 A35 35 0 1 1 49.99 15 Z'
  const circ = 2 * Math.PI * 47
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {unlocked && <div className="absolute inset-[12%] rounded-full blur-xl" style={{ background: TIER_META[tier].glow }} />}
      <svg viewBox="0 0 100 100" width={size} height={size} className="relative">
        <defs>
          <linearGradient id={`b1-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset=".5" stopColor={b} />
            <stop offset="1" stopColor={c} />
          </linearGradient>
          <linearGradient id={`b2-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a1d22" />
            <stop offset="1" stopColor="#0b0d10" />
          </linearGradient>
          <clipPath id={`bc-${id}`}>
            <path d={shape} />
          </clipPath>
        </defs>
        {!unlocked && progress > 0 && (
          <circle cx={50} cy={50} r={47} fill="none" stroke={b} strokeOpacity={0.6} strokeWidth={2} strokeDasharray={`${circ * progress} ${circ}`} strokeLinecap="round" transform="rotate(-90 50 50)" />
        )}
        <g style={{ filter: unlocked ? undefined : 'grayscale(1) brightness(.45)' }}>
          <path d={shape} fill={`url(#b1-${id})`} />
          <path d={inner} fill={`url(#b2-${id})`} stroke={a} strokeOpacity={0.35} strokeWidth={1} />
          {unlocked && shine && (
            <g clipPath={`url(#bc-${id})`}>
              <motion.rect x={-60} y={-10} width={26} height={130} fill="white" opacity={0.28} transform="skewX(-20)" animate={{ x: [-60, 160] }} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 3.5, ease: 'easeInOut' }} />
            </g>
          )}
        </g>
        <Icon x={34} y={34} width={32} height={32} strokeWidth={1.7} color={unlocked ? a : '#55534e'} />
      </svg>
      {!unlocked && (
        <div className="absolute bottom-[6%] right-[6%] grid place-items-center rounded-full border border-line-2 bg-bg-2 p-1">
          <Lock size={size * 0.12} className="text-ink-3" />
        </div>
      )}
    </div>
  )
}
