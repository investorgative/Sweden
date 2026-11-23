import type { DayStat, EquityPoint, Trade } from '@/data/types'

export const dayKey = (iso: string) => iso.slice(0, 10)
export const toDate = (iso: string) => new Date(iso)
export const rOf = (t: Trade) => (t.risk > 0 ? t.pnl / t.risk : 0)
export const holdMinutes = (t: Trade) => (toDate(t.exitTime).getTime() - toDate(t.entryTime).getTime()) / 60000

export function sortByExit(trades: Trade[]) {
  return [...trades].sort((a, b) => (a.exitTime < b.exitTime ? -1 : a.exitTime > b.exitTime ? 1 : 0))
}

export interface Summary {
  count: number
  wins: number
  losses: number
  breakeven: number
  netPnl: number
  grossProfit: number
  grossLoss: number
  fees: number
  winRate: number
  lossRate: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  payoff: number
  expectancy: number
  expectancyR: number
  avgR: number
  totalR: number
  largestWin: number
  largestLoss: number
  maxDrawdown: number
  maxDrawdownPct: number
  currentDrawdown: number
  currentDrawdownPct: number
  recoveryFactor: number
  sharpe: number
  sortino: number
  sqn: number
  kelly: number
  avgHoldWin: number
  avgHoldLoss: number
  maxWinStreak: number
  maxLossStreak: number
  currentStreak: number // +n wins / -n losses
  greenDays: number
  redDays: number
  tradingDays: number
  dayWinRate: number
  bestDay: DayStat | null
  worstDay: DayStat | null
  avgDailyPnl: number
  planAdherence: number
  avgMfeCapture: number
  returnPct: number
  equity: number
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
const std = (a: number[]) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

export function dailyStats(trades: Trade[]): DayStat[] {
  const map = new Map<string, DayStat>()
  for (const t of trades) {
    const k = dayKey(t.exitTime)
    let d = map.get(k)
    if (!d) {
      d = { date: k, pnl: 0, trades: 0, wins: 0, losses: 0, r: 0 }
      map.set(k, d)
    }
    d.pnl += t.pnl
    d.trades++
    d.r += rOf(t)
    if (t.pnl > 0) d.wins++
    else if (t.pnl < 0) d.losses++
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export function equityCurve(trades: Trade[], startingBalance: number): EquityPoint[] {
  const sorted = sortByExit(trades)
  const pts: EquityPoint[] = []
  let equity = startingBalance
  let peak = startingBalance
  const first = sorted[0]
  if (first) {
    const t0 = toDate(first.entryTime).getTime() - 3600_000
    pts.push({ t: t0, date: dayKey(first.entryTime), equity, cum: 0, peak, drawdown: 0, drawdownPct: 0, pnl: 0 })
  }
  for (const tr of sorted) {
    equity += tr.pnl
    peak = Math.max(peak, equity)
    pts.push({
      t: toDate(tr.exitTime).getTime(),
      date: dayKey(tr.exitTime),
      equity,
      cum: equity - startingBalance,
      peak,
      drawdown: equity - peak,
      drawdownPct: peak > 0 ? (equity - peak) / peak : 0,
      tradeId: tr.id,
      pnl: tr.pnl,
    })
  }
  return pts
}

export function computeSummary(trades: Trade[], startingBalance: number): Summary {
  const sorted = sortByExit(trades)
  const wins = sorted.filter((t) => t.pnl > 0)
  const losses = sorted.filter((t) => t.pnl < 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const netPnl = grossProfit - grossLoss
  const count = sorted.length
  const winRate = count ? wins.length / count : 0
  const lossRate = count ? losses.length / count : 0
  const avgWin = wins.length ? grossProfit / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const payoff = avgLoss ? avgWin / avgLoss : 0
  const rs = sorted.map(rOf)
  const totalR = rs.reduce((s, v) => s + v, 0)

  const curve = equityCurve(sorted, startingBalance)
  let maxDD = 0
  let maxDDPct = 0
  for (const p of curve) {
    if (p.drawdown < maxDD) maxDD = p.drawdown
    if (p.drawdownPct < maxDDPct) maxDDPct = p.drawdownPct
  }
  const last = curve[curve.length - 1]

  const days = dailyStats(sorted)
  const dayRets: number[] = []
  {
    let eq = startingBalance
    for (const d of days) {
      dayRets.push(d.pnl / eq)
      eq += d.pnl
    }
  }
  const sd = std(dayRets)
  const downside = Math.sqrt(mean(dayRets.map((r) => Math.min(0, r) ** 2)))
  const sharpe = sd ? (mean(dayRets) / sd) * Math.sqrt(252) : 0
  const sortino = downside ? (mean(dayRets) / downside) * Math.sqrt(252) : 0
  const sqn = std(rs) ? (mean(rs) / std(rs)) * Math.sqrt(Math.min(count, 100)) : 0
  const kelly = payoff ? winRate - (1 - winRate) / payoff : 0

  let maxW = 0
  let maxL = 0
  let cur = 0
  for (const t of sorted) {
    if (t.pnl > 0) cur = cur > 0 ? cur + 1 : 1
    else if (t.pnl < 0) cur = cur < 0 ? cur - 1 : -1
    maxW = Math.max(maxW, cur)
    maxL = Math.min(maxL, cur)
  }

  const green = days.filter((d) => d.pnl > 0)
  const red = days.filter((d) => d.pnl < 0)
  const best = days.reduce<DayStat | null>((b, d) => (!b || d.pnl > b.pnl ? d : b), null)
  const worst = days.reduce<DayStat | null>((b, d) => (!b || d.pnl < b.pnl ? d : b), null)
  const captures = wins.filter((t) => t.mfe > 0).map((t) => Math.min(1, rOf(t) / t.mfe))

  return {
    count,
    wins: wins.length,
    losses: losses.length,
    breakeven: count - wins.length - losses.length,
    netPnl,
    grossProfit,
    grossLoss,
    fees: sorted.reduce((s, t) => s + t.fees, 0),
    winRate,
    lossRate,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    payoff,
    expectancy: count ? netPnl / count : 0,
    expectancyR: count ? totalR / count : 0,
    avgR: mean(rs),
    totalR,
    largestWin: wins.reduce((m, t) => Math.max(m, t.pnl), 0),
    largestLoss: losses.reduce((m, t) => Math.min(m, t.pnl), 0),
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    currentDrawdown: last?.drawdown ?? 0,
    currentDrawdownPct: last?.drawdownPct ?? 0,
    recoveryFactor: maxDD ? netPnl / Math.abs(maxDD) : 0,
    sharpe,
    sortino,
    sqn,
    kelly,
    avgHoldWin: mean(wins.map(holdMinutes)),
    avgHoldLoss: mean(losses.map(holdMinutes)),
    maxWinStreak: maxW,
    maxLossStreak: Math.abs(maxL),
    currentStreak: cur,
    greenDays: green.length,
    redDays: red.length,
    tradingDays: days.length,
    dayWinRate: days.length ? green.length / days.length : 0,
    bestDay: best,
    worstDay: worst,
    avgDailyPnl: days.length ? netPnl / days.length : 0,
    planAdherence: (() => {
      const lg = sorted.filter((t) => t.logged !== false)
      return lg.length ? lg.filter((t) => t.followedPlan).length / lg.length : NaN   // NaN = nothing logged yet
    })(),
    avgMfeCapture: mean(captures),
    returnPct: startingBalance ? netPnl / startingBalance : 0,
    equity: startingBalance + netPnl,
  }
}

export interface GroupStat {
  key: string
  count: number
  pnl: number
  winRate: number
  profitFactor: number
  expectancy: number
  avgR: number
  totalR: number
  wins: number
  losses: number
}

export function groupStats(trades: Trade[], keyFn: (t: Trade) => string | string[]): GroupStat[] {
  const map = new Map<string, Trade[]>()
  for (const t of trades) {
    const keys = keyFn(t)
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(t)
    }
  }
  return [...map.entries()].map(([key, ts]) => statOf(key, ts))
}

export function statOf(key: string, ts: Trade[]): GroupStat {
  const wins = ts.filter((t) => t.pnl > 0)
  const losses = ts.filter((t) => t.pnl < 0)
  const gp = wins.reduce((s, t) => s + t.pnl, 0)
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const pnl = gp - gl
  const totalR = ts.reduce((s, t) => s + rOf(t), 0)
  return {
    key,
    count: ts.length,
    pnl,
    winRate: ts.length ? wins.length / ts.length : 0,
    profitFactor: gl ? gp / gl : gp > 0 ? 99 : 0,
    expectancy: ts.length ? pnl / ts.length : 0,
    avgR: ts.length ? totalR / ts.length : 0,
    totalR,
    wins: wins.length,
    losses: losses.length,
  }
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** true = a 24/7 market (crypto): all weekdays and 3-hour blocks around the clock; false = the stock-market demo */
export let allDay = true
export const setAllDay = (v: boolean) => {
  allDay = v
}
export const HOUR_KEYS_24 = ['00-03', '03-06', '06-09', '09-12', '12-15', '15-18', '18-21', '21-24']
export const DAY_KEYS = () => (allDay ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
export const HOUR_KEYS = () => (allDay ? HOUR_KEYS_24 : ['Pre', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'])

export function hourBucket(t: Trade) {
  const d = toDate(t.entryTime)
  if (allDay) return HOUR_KEYS_24[Math.floor(d.getHours() / 3)]
  const m = d.getHours() * 60 + d.getMinutes()
  if (m < 9 * 60 + 30) return 'Pre'
  const h = d.getHours()
  return `${String(h).padStart(2, '0')}:00`
}

export function holdBucket(t: Trade) {
  const m = holdMinutes(t)
  if (m < 5) return '< 5m'
  if (m < 15) return '5–15m'
  if (m < 30) return '15–30m'
  if (m < 60) return '30–60m'
  if (m < 120) return '1–2h'
  return '2h +'
}
export const HOLD_ORDER = ['< 5m', '5–15m', '15–30m', '30–60m', '1–2h', '2h +']

export function histogram(values: number[], step: number, min: number, max: number) {
  const bins: { x0: number; x1: number; count: number }[] = []
  for (let x = min; x < max; x += step) bins.push({ x0: x, x1: x + step, count: 0 })
  for (const v of values) {
    const c = Math.min(max - step / 2, Math.max(min, v))
    const i = Math.floor((c - min) / step)
    if (bins[i]) bins[i].count++
  }
  return bins
}

export function monthlyReturns(trades: Trade[], startingBalance: number) {
  const days = dailyStats(trades)
  const months = new Map<string, { key: string; pnl: number; startEq: number; trades: number }>()
  let eq = startingBalance
  for (const d of days) {
    const k = d.date.slice(0, 7)
    if (!months.has(k)) months.set(k, { key: k, pnl: 0, startEq: eq, trades: 0 })
    const m = months.get(k)!
    m.pnl += d.pnl
    m.trades += d.trades
    eq += d.pnl
  }
  return [...months.values()].map((m) => ({ ...m, ret: m.startEq ? m.pnl / m.startEq : 0 }))
}

/** Rolling metric over trades, e.g. 30-trade rolling win rate & expectancy */
export function rolling(trades: Trade[], window: number) {
  const s = sortByExit(trades)
  const out: { i: number; date: string; winRate: number; expectancyR: number; pf: number }[] = []
  for (let i = window - 1; i < s.length; i++) {
    const slice = s.slice(i - window + 1, i + 1)
    const st = statOf('', slice)
    out.push({ i, date: dayKey(s[i].exitTime), winRate: st.winRate, expectancyR: st.avgR, pf: Math.min(st.profitFactor, 6) })
  }
  return out
}

/** Trader score 0–100 — a composite similar to what modern journals display. */
export function traderScore(s: Summary) {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const parts = [
    { key: 'Win rate', value: clamp01((s.winRate - 0.3) / 0.35), raw: s.winRate },
    { key: 'Profit factor', value: clamp01((Math.min(s.profitFactor, 4) - 1) / 1.6), raw: s.profitFactor },
    { key: 'Payoff', value: clamp01((s.payoff - 0.8) / 1.8), raw: s.payoff },
    { key: 'Recovery', value: clamp01(s.recoveryFactor / 8), raw: s.recoveryFactor },
    { key: 'Consistency', value: clamp01((s.dayWinRate - 0.35) / 0.35), raw: s.dayWinRate },
    { key: 'Discipline', value: isFinite(s.planAdherence) ? clamp01((s.planAdherence - 0.5) / 0.45) : 0.5, raw: s.planAdherence },
  ]
  const score = Math.round((parts.reduce((a, p) => a + p.value, 0) / parts.length) * 100)
  return { score, parts }
}
