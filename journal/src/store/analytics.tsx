import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useJournal, rangeStart, effectiveSettings } from './useJournal'
import { computeSummary, dailyStats, equityCurve, setAllDay, sortByExit, type Summary } from '@/lib/stats'
import { buildInsights, type Insight } from '@/lib/insights'
import { computeXp, evaluateAchievements, type AchievementState } from '@/lib/achievements'
import type { DayStat, EquityPoint, Trade } from '@/data/types'
import { setCurrency } from '@/lib/format'

interface Analytics {
  /** trades after global filters (range/symbol/setup/side) */
  trades: Trade[]
  all: Trade[]
  summary: Summary
  curve: EquityPoint[]
  days: DayStat[]
  startEquity: number
  insights: Insight[]
  /** lifetime (unfiltered) — the house & achievements always use the full journey */
  lifetime: { summary: Summary; curve: EquityPoint[]; achievements: AchievementState[]; xp: ReturnType<typeof computeXp> }
  latest: Date
}

const Ctx = createContext<Analytics | null>(null)

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const trades = useJournal((s) => s.trades)
  const realSettings = useJournal((s) => s.settings)
  const isDemo = useJournal((s) => s.isDemo)
  const walletStart = useJournal((s) => s.walletStart)
  const settings = useMemo(() => effectiveSettings(realSettings, walletStart, trades, isDemo), [isDemo, realSettings, walletStart, trades])
  const filters = useJournal((s) => s.filters)
  setCurrency(settings.currency)
  setAllDay(!isDemo)

  const all = useMemo(() => sortByExit(trades), [trades])
  const latest = useMemo(() => (all.length ? new Date(all[all.length - 1].exitTime) : new Date()), [all])

  const lifetime = useMemo(() => {
    const curve = equityCurve(all, settings.startingBalance)
    const summary = computeSummary(all, settings.startingBalance)
    const achievements = evaluateAchievements(all, curve, settings)
    const xp = computeXp(all, achievements)
    return { summary, curve, achievements, xp }
  }, [all, settings])

  const value = useMemo<Analytics>(() => {
    const from = rangeStart(filters.range, latest)
    const fromIso = from ? `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}` : ''
    let pre = 0
    const filtered = all.filter((t) => {
      const inRange = !fromIso || t.exitTime >= fromIso
      if (!inRange) pre += t.pnl
      if (!inRange) return false
      if (filters.symbols.length && !filters.symbols.includes(t.symbol)) return false
      if (filters.setups.length && !filters.setups.includes(t.setup)) return false
      if (filters.side !== 'all' && t.side !== filters.side) return false
      return true
    })
    const startEquity = settings.startingBalance + pre
    const summary = computeSummary(filtered, startEquity)
    // returnPct relative to the equity at the start of the window
    return {
      trades: filtered,
      all,
      summary,
      curve: equityCurve(filtered, startEquity),
      days: dailyStats(filtered),
      startEquity,
      insights: buildInsights(filtered, summary, settings),
      lifetime,
      latest,
    }
  }, [all, filters, settings, lifetime, latest])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAnalytics() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAnalytics must be used inside AnalyticsProvider')
  return v
}
