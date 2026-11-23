import type { EquityPoint, Trade, Settings } from '@/data/types'
import { dailyStats, dayKey, monthlyReturns, rOf, sortByExit, statOf, toDate } from './stats'

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legendary'

export interface AchievementDef {
  id: string
  name: string
  description: string
  tier: Tier
  icon: string // lucide icon name key, mapped in UI
  category: 'Profit' | 'Consistency' | 'Discipline' | 'Skill' | 'Journey'
  /** pure evaluation over the full history */
  evaluate: (c: Ctx) => { current: number; target: number; unlockedAt?: string }
}

export interface AchievementState extends Omit<AchievementDef, 'evaluate'> {
  current: number
  target: number
  progress: number
  unlocked: boolean
  unlockedAt?: string
  /** % of community members who own this (mock rarity) */
  rarity: number
}

interface Ctx {
  trades: Trade[]
  curve: EquityPoint[]
  settings: Settings
}

export const TIER_META: Record<Tier, { label: string; color: string; glow: string; xp: number }> = {
  bronze: { label: 'Bronze', color: '#c98a5a', glow: 'rgba(201,138,90,.45)', xp: 100 },
  silver: { label: 'Silver', color: '#c9d1dc', glow: 'rgba(201,209,220,.45)', xp: 250 },
  gold: { label: 'Gold', color: '#e8c37e', glow: 'rgba(232,195,126,.55)', xp: 600 },
  platinum: { label: 'Platinum', color: '#9fe6e0', glow: 'rgba(159,230,224,.5)', xp: 1200 },
  legendary: { label: 'Legendary', color: '#c4a2ff', glow: 'rgba(196,162,255,.6)', xp: 2500 },
}

// ───────────────────────── helpers
function lastDayOf(c: Ctx, month: string) {
  const ds = c.trades.filter((t) => t.exitTime.startsWith(month))
  return ds.length ? dayKey(ds[ds.length - 1].exitTime) : `${month}-01`
}

function firstIndex<T>(arr: T[], pred: (v: T, i: number) => boolean) {
  for (let i = 0; i < arr.length; i++) if (pred(arr[i], i)) return i
  return -1
}

function profitMilestone(amount: number) {
  return (c: Ctx) => {
    const i = firstIndex(c.curve, (p) => p.cum >= amount)
    const max = c.curve.reduce((m, p) => Math.max(m, p.cum), 0)
    return { current: Math.max(0, max), target: amount, unlockedAt: i >= 0 ? c.curve[i].date : undefined }
  }
}

function streak(pred: (t: Trade) => boolean, n: number) {
  return (c: Ctx) => {
    let run = 0
    let best = 0
    for (const t of c.trades) {
      run = pred(t) ? run + 1 : 0
      best = Math.max(best, run)
      if (run >= n) return { current: n, target: n, unlockedAt: dayKey(t.exitTime) }
    }
    return { current: best, target: n }
  }
}

function dayStreak(pred: (pnl: number, trades: number) => boolean, n: number) {
  return (c: Ctx) => {
    const days = dailyStats(c.trades)
    let run = 0
    let best = 0
    for (const d of days) {
      run = pred(d.pnl, d.trades) ? run + 1 : 0
      best = Math.max(best, run)
      if (run >= n) return { current: n, target: n, unlockedAt: d.date }
    }
    return { current: best, target: n }
  }
}

function countReached(pred: (t: Trade) => boolean, n: number) {
  return (c: Ctx) => {
    let k = 0
    for (const t of c.trades) {
      if (pred(t)) k++
      if (k >= n) return { current: n, target: n, unlockedAt: dayKey(t.exitTime) }
    }
    return { current: k, target: n }
  }
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Journey
  { id: 'first-trade', name: 'Opening Bell', description: 'Log your very first trade.', tier: 'bronze', icon: 'bell', category: 'Journey', evaluate: countReached(() => true, 1) },
  { id: 'first-win', name: 'First Blood', description: 'Close your first winning trade.', tier: 'bronze', icon: 'sparkles', category: 'Journey', evaluate: countReached((t) => t.pnl > 0, 1) },
  { id: 'trades-100', name: 'Centurion', description: 'Journal 100 trades.', tier: 'bronze', icon: 'book', category: 'Journey', evaluate: countReached(() => true, 100) },
  { id: 'trades-500', name: 'The Grind', description: 'Journal 500 trades.', tier: 'silver', icon: 'book', category: 'Journey', evaluate: countReached(() => true, 500) },
  { id: 'trades-1000', name: 'Ten Thousand Hours', description: 'Journal 1,000 trades.', tier: 'gold', icon: 'book', category: 'Journey', evaluate: countReached(() => true, 1000) },
  { id: 'notes-150', name: 'Scribe', description: 'Write notes on 150 trades.', tier: 'silver', icon: 'pen', category: 'Journey', evaluate: countReached((t) => t.notes.trim().length > 0, 150) },

  // Profit
  { id: 'profit-10k', name: 'Five Figures', description: 'Reach $10,000 in net profit.', tier: 'bronze', icon: 'coins', category: 'Profit', evaluate: profitMilestone(10000) },
  { id: 'profit-25k', name: 'Quarter Club', description: 'Reach $25,000 in net profit.', tier: 'silver', icon: 'coins', category: 'Profit', evaluate: profitMilestone(25000) },
  { id: 'profit-50k', name: 'Half Way to Six', description: 'Reach $50,000 in net profit.', tier: 'gold', icon: 'gem', category: 'Profit', evaluate: profitMilestone(50000) },
  { id: 'profit-100k', name: 'Six Figure Trader', description: 'Reach $100,000 in net profit.', tier: 'platinum', icon: 'crown', category: 'Profit', evaluate: profitMilestone(100000) },
  {
    id: 'dream-house',
    name: 'Keys to the Villa',
    description: 'Fully fund your dream-house goal.',
    tier: 'legendary',
    icon: 'home',
    category: 'Profit',
    evaluate: (c) => profitMilestone(c.settings.goalAmount)(c),
  },
  {
    id: 'big-day',
    name: 'Payday',
    description: 'Finish a single day up $5,000 or more.',
    tier: 'silver',
    icon: 'sun',
    category: 'Profit',
    evaluate: (c) => {
      const d = dailyStats(c.trades).find((x) => x.pnl >= 5000)
      const max = dailyStats(c.trades).reduce((m, x) => Math.max(m, x.pnl), 0)
      return { current: Math.min(max, 5000), target: 5000, unlockedAt: d?.date }
    },
  },
  {
    id: 'huge-day',
    name: 'Monster Session',
    description: 'Finish a single day up $10,000 or more.',
    tier: 'gold',
    icon: 'flame',
    category: 'Profit',
    evaluate: (c) => {
      const d = dailyStats(c.trades).find((x) => x.pnl >= 10000)
      const max = dailyStats(c.trades).reduce((m, x) => Math.max(m, x.pnl), 0)
      return { current: Math.min(max, 10000), target: 10000, unlockedAt: d?.date }
    },
  },

  // Skill
  { id: 'sniper', name: 'Sniper', description: 'Land a single trade of +5R or better.', tier: 'silver', icon: 'crosshair', category: 'Skill', evaluate: countReached((t) => rOf(t) >= 5, 1) },
  { id: 'home-run', name: 'Home Run', description: 'Land a single trade of +8R or better.', tier: 'gold', icon: 'rocket', category: 'Skill', evaluate: countReached((t) => rOf(t) >= 8, 1) },
  { id: 'on-fire', name: 'On Fire', description: 'Win 5 trades in a row.', tier: 'bronze', icon: 'flame', category: 'Skill', evaluate: streak((t) => t.pnl > 0, 5) },
  { id: 'unstoppable', name: 'Unstoppable', description: 'Win 9 trades in a row.', tier: 'gold', icon: 'zap', category: 'Skill', evaluate: streak((t) => t.pnl > 0, 9) },
  {
    id: 'pf-2',
    name: 'Edge Confirmed',
    description: 'Profit factor ≥ 2.0 over any 100 consecutive trades.',
    tier: 'gold',
    icon: 'trending',
    category: 'Skill',
    evaluate: (c) => {
      let best = 0
      for (let i = 99; i < c.trades.length; i++) {
        const pf = Math.min(statOf('', c.trades.slice(i - 99, i + 1)).profitFactor, 9)
        best = Math.max(best, pf)
        if (pf >= 2) return { current: 2, target: 2, unlockedAt: dayKey(c.trades[i].exitTime) }
      }
      return { current: best, target: 2 }
    },
  },
  {
    id: 'comeback',
    name: 'Comeback Kid',
    description: 'Recover from a 10%+ drawdown to a new equity high.',
    tier: 'gold',
    icon: 'refresh',
    category: 'Skill',
    evaluate: (c) => {
      let deep = 0
      for (const p of c.curve) {
        deep = Math.min(deep, p.drawdownPct)
        if (deep <= -0.1 && p.drawdown === 0) return { current: 1, target: 1, unlockedAt: p.date }
        if (p.drawdown === 0) deep = 0
      }
      return { current: 0, target: 1 }
    },
  },
  {
    id: 'ath-50',
    name: 'Sky Is the Limit',
    description: 'Set 50 new all-time equity highs.',
    tier: 'silver',
    icon: 'mountain',
    category: 'Skill',
    evaluate: (c) => {
      let k = 0
      let prev = -Infinity
      for (const p of c.curve) {
        if (p.equity > prev && p.drawdown === 0 && p.tradeId) {
          k++
          if (k >= 50) return { current: 50, target: 50, unlockedAt: p.date }
        }
        prev = Math.max(prev, p.equity)
      }
      return { current: k, target: 50 }
    },
  },

  // Consistency
  { id: 'green-3', name: 'Hat Trick', description: '3 green days in a row.', tier: 'bronze', icon: 'calendar', category: 'Consistency', evaluate: dayStreak((p) => p > 0, 3) },
  { id: 'green-7', name: 'Lucky Seven', description: '7 green days in a row.', tier: 'gold', icon: 'calendar', category: 'Consistency', evaluate: dayStreak((p) => p > 0, 7) },
  {
    id: 'green-months-3',
    name: 'Quarterly Hero',
    description: '3 profitable months in a row.',
    tier: 'gold',
    icon: 'award',
    category: 'Consistency',
    evaluate: (c) => {
      const ms = monthlyReturns(c.trades, c.settings.startingBalance)
      let run = 0
      let best = 0
      for (const m of ms) {
        run = m.pnl > 0 ? run + 1 : 0
        best = Math.max(best, run)
        if (run >= 3) return { current: 3, target: 3, unlockedAt: lastDayOf(c, m.key) }
      }
      return { current: best, target: 3 }
    },
  },
  {
    id: 'green-months-6',
    name: 'Half-Year Machine',
    description: '6 profitable months in a row.',
    tier: 'platinum',
    icon: 'award',
    category: 'Consistency',
    evaluate: (c) => {
      const ms = monthlyReturns(c.trades, c.settings.startingBalance)
      let run = 0
      let best = 0
      for (const m of ms) {
        run = m.pnl > 0 ? run + 1 : 0
        best = Math.max(best, run)
        if (run >= 6) return { current: 6, target: 6, unlockedAt: lastDayOf(c, m.key) }
      }
      return { current: best, target: 6 }
    },
  },

  // Discipline
  { id: 'disciplined-20', name: 'By the Book', description: 'Follow your plan on 20 trades in a row.', tier: 'silver', icon: 'shield', category: 'Discipline', evaluate: streak((t) => t.followedPlan && t.logged !== false, 20) },
  { id: 'disciplined-40', name: 'Iron Discipline', description: 'Follow your plan on 40 trades in a row.', tier: 'platinum', icon: 'shield', category: 'Discipline', evaluate: streak((t) => t.followedPlan && t.logged !== false, 40) },
  {
    id: 'cool-head',
    name: 'Cool Head',
    description: '20 trading days in a row without a revenge re-entry.',
    tier: 'silver',
    icon: 'snow',
    category: 'Discipline',
    evaluate: (c) => {
      const bad = new Set<string>()
      for (let i = 1; i < c.trades.length; i++) {
        const p = c.trades[i - 1]
        const t = c.trades[i]
        const gap = (toDate(t.entryTime).getTime() - toDate(p.exitTime).getTime()) / 60000
        if (p.pnl < 0 && gap >= 0 && gap <= 15) bad.add(dayKey(t.entryTime))
      }
      let run = 0
      let best = 0
      for (const d of dailyStats(c.trades)) {
        run = bad.has(d.date) ? 0 : run + 1
        best = Math.max(best, run)
        if (run >= 20) return { current: 20, target: 20, unlockedAt: d.date }
      }
      return { current: best, target: 20 }
    },
  },
  {
    id: 'risk-manager',
    name: 'Risk Manager',
    description: '60 trading days in a row inside your max daily loss.',
    tier: 'gold',
    icon: 'lock',
    category: 'Discipline',
    evaluate: (c) => dayStreak((p) => p >= -c.settings.maxDailyLoss, 60)(c),
  },
  {
    id: 'quality',
    name: 'Quality over Quantity',
    description: '15 green days with 2 trades or fewer.',
    tier: 'silver',
    icon: 'diamond',
    category: 'Discipline',
    evaluate: (c) => {
      let k = 0
      for (const d of dailyStats(c.trades)) {
        if (d.pnl > 0 && d.trades <= 2) k++
        if (k >= 15) return { current: 15, target: 15, unlockedAt: d.date }
      }
      return { current: k, target: 15 }
    },
  },
]

// Deterministic pseudo-rarity so the community feels alive.
const RARITY: Record<Tier, [number, number]> = { bronze: [48, 78], silver: [22, 44], gold: [7, 19], platinum: [2, 6.5], legendary: [0.3, 1.4] }
function rarityFor(id: string, tier: Tier) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [a, b] = RARITY[tier]
  return +(a + ((h % 1000) / 1000) * (b - a)).toFixed(1)
}

export function evaluateAchievements(trades: Trade[], curve: EquityPoint[], settings: Settings): AchievementState[] {
  const ctx: Ctx = { trades: sortByExit(trades), curve, settings }
  return ACHIEVEMENTS.map(({ evaluate, ...def }) => {
    const r = evaluate(ctx)
    const unlocked = r.unlockedAt !== undefined
    return {
      ...def,
      current: r.current,
      target: r.target,
      progress: unlocked ? 1 : Math.max(0, Math.min(0.99, r.current / r.target)),
      unlocked,
      unlockedAt: r.unlockedAt,
      rarity: rarityFor(def.id, def.tier),
    }
  })
}

// ───────────────────────── XP & levels — rewards process, not just profit.
export const LEVELS = [
  { level: 1, title: 'Apprentice', xp: 0 },
  { level: 2, title: 'Chart Reader', xp: 1500 },
  { level: 3, title: 'Tape Reader', xp: 4000 },
  { level: 4, title: 'Journeyman', xp: 8000 },
  { level: 5, title: 'Strategist', xp: 13000 },
  { level: 6, title: 'Risk Architect', xp: 19000 },
  { level: 7, title: 'Edge Hunter', xp: 26000 },
  { level: 8, title: 'Market Craftsman', xp: 34000 },
  { level: 9, title: 'Master Trader', xp: 44000 },
  { level: 10, title: 'Legend', xp: 56000 },
]

export function computeXp(trades: Trade[], achievements: AchievementState[]) {
  let xp = 0
  const sources = { journaling: 0, discipline: 0, consistency: 0, achievements: 0 }
  for (const t of trades) {
    sources.journaling += t.logged !== false ? 10 + (t.notes ? 5 : 0) : 2   // imported wallet trades count once logged
    if (t.followedPlan && t.logged !== false) sources.discipline += 15
  }
  for (const d of dailyStats(trades)) if (d.pnl > 0) sources.consistency += 20
  for (const a of achievements) if (a.unlocked) sources.achievements += TIER_META[a.tier].xp
  xp = sources.journaling + sources.discipline + sources.consistency + sources.achievements
  let cur = LEVELS[0]
  for (const l of LEVELS) if (xp >= l.xp) cur = l
  const next = LEVELS.find((l) => l.xp > xp)
  return {
    xp,
    sources,
    level: cur,
    next,
    progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1,
  }
}

/** Profit milestones for the equity-curve flags */
export function profitMilestones(goal: number) {
  const base = [10000, 25000, 50000, 100000, 150000, 200000]
  return [...base.filter((b) => b < goal), goal]
}
