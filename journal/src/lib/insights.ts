import type { Settings, Trade } from '@/data/types'
import { allDay, HOLD_ORDER, WEEKDAYS, dailyStats, dayKey, groupStats, holdBucket, hourBucket, rOf, sortByExit, statOf, toDate, type Summary } from './stats'

export type InsightKind = 'leak' | 'strength' | 'habit'

export interface Insight {
  id: string
  kind: InsightKind
  /** 1 = minor, 2 = notable, 3 = critical */
  severity: 1 | 2 | 3
  title: string
  detail: string
  /** currency impact. Negative = what it cost you. */
  impact: number
  metric: { label: string; value: string }
  action: string
  category: 'Psychology' | 'Strategy' | 'Timing' | 'Risk' | 'Execution'
  /** trade ids that make up this insight, used for drill-down + what-if */
  tradeIds: string[]
}

const fmtR = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`
const fmtPct = (v: number) => `${Math.round(v * 100)}%`
const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y)
  return b.length ? b[Math.floor(b.length / 2)] : 0
}

/**
 * The weak-spot engine. Every rule is a pure function over trades that returns
 * an Insight when the pattern is statistically meaningful (min sample sizes +
 * a material gap to baseline), ranked by currency impact.
 */
export function buildInsights(trades: Trade[], summary: Summary, settings: Settings): Insight[] {
  const s = sortByExit(trades)
  if (s.length < 20) return []
  const out: Insight[] = []
  const baseR = summary.expectancyR
  const avgRisk = s.reduce((a, t) => a + t.risk, 0) / s.length
  const clean = s.filter((t) => t.followedPlan)
  const ids = (ts: Trade[]) => ts.map((t) => t.id)

  // ───────── Revenge trading (behavioural, detected from timestamps, not tags)
  {
    const quick: Trade[] = []
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1]
      const cur = s[i]
      const gap = (toDate(cur.entryTime).getTime() - toDate(prev.exitTime).getTime()) / 60000
      if (prev.pnl < 0 && gap >= 0 && gap <= 15 && dayKey(prev.exitTime) === dayKey(cur.entryTime)) quick.push(cur)
    }
    if (quick.length >= 10) {
      const st = statOf('', quick)
      const sizeUp = quick.reduce((a, t) => a + t.risk, 0) / quick.length / avgRisk
      if (st.avgR < baseR - 0.2) {
        out.push({
          id: 'revenge',
          kind: 'leak',
          severity: st.pnl < -0.1 * Math.abs(summary.netPnl) ? 3 : 2,
          category: 'Psychology',
          title: 'Revenge trading after losses',
          detail: `${quick.length} trades were opened within 15 minutes of a losing exit. They average ${fmtR(st.avgR)} vs your baseline ${fmtR(baseR)}, with ${sizeUp > 1.05 ? `${Math.round((sizeUp - 1) * 100)}% larger size` : 'similar size'} and a ${fmtPct(st.winRate)} win rate.`,
          impact: Math.min(st.pnl, (st.avgR - baseR) * avgRisk * quick.length),
          metric: { label: 'Win rate', value: fmtPct(st.winRate) },
          action: 'Hard rule: after any loss, stand up and wait 15 minutes. Add a platform-level cool-down if your broker supports it.',
          tradeIds: ids(quick),
        })
      }
    }
  }

  // ───────── Losing setups
  for (const g of groupStats(s, (t) => t.setup)) {
    if (g.count >= 15 && g.avgR < 0 && g.count < s.length * 0.9) {   // a "setup" that is (almost) every trade says nothing
      out.push({
        id: `setup-${g.key}`,
        kind: 'leak',
        severity: g.pnl < -0.08 * Math.abs(summary.netPnl) ? 3 : 2,
        category: 'Strategy',
        title: `“${g.key}” has negative expectancy`,
        detail: `${g.count} trades, ${fmtPct(g.winRate)} win rate, profit factor ${g.profitFactor.toFixed(2)}. This setup is a net drag on the account.`,
        impact: g.pnl,
        metric: { label: 'Expectancy', value: fmtR(g.avgR) },
        action: 'Pause it or paper-trade it until you can define stricter entry criteria. Reallocate that risk to your best setup.',
        tradeIds: ids(s.filter((t) => t.setup === g.key)),
      })
    }
  }

  // ───────── Emotional states
  for (const g of groupStats(s.filter((t) => t.logged !== false), (t) => t.emotion)) {
    if (g.key === 'Revenge') continue
    if (g.count >= 15 && g.avgR < baseR - 0.35 && g.avgR < 0.1) {
      const ts = s.filter((t) => t.emotion === g.key)
      out.push({
        id: `emotion-${g.key}`,
        kind: 'leak',
        severity: g.pnl < 0 ? 2 : 1,
        category: 'Psychology',
        title: `Trading while “${g.key}”`,
        detail: `When you tag yourself ${g.key.toLowerCase()}, you average ${fmtR(g.avgR)} per trade (${fmtPct(g.winRate)} win rate) across ${g.count} trades.`,
        impact: Math.min(g.pnl, (g.avgR - baseR) * avgRisk * g.count),
        metric: { label: 'Avg R', value: fmtR(g.avgR) },
        action: g.key === 'FOMO' ? 'If the move already happened without you, it is not your trade. Wait for the next pullback or skip.' : g.key === 'Bored' ? 'Midday boredom is not a setup. Set a “no trades 11:30–13:30 unless A+” rule.' : 'Add a pre-trade emotion check. If you are not Calm or Focused, cut size in half.',
        tradeIds: ids(ts),
      })
    }
  }

  // ───────── Weekday
  {
    const gs = groupStats(s, (t) => WEEKDAYS[toDate(t.entryTime).getDay()]).filter((g) => g.count >= 25)
    const worst = gs.sort((a, b) => a.avgR - b.avgR)[0]
    if (worst && worst.avgR < baseR * 0.55) {
      out.push({
        id: `weekday-${worst.key}`,
        kind: 'leak',
        severity: worst.avgR < 0 ? 2 : 1,
        category: 'Timing',
        title: `${LONG_DAY[worst.key] ?? worst.key}s underperform`,
        detail: `${worst.key} trades return ${fmtR(worst.avgR)} on average — ${Math.round((1 - worst.avgR / baseR) * 100)}% below your other days.`,
        impact: (worst.avgR - baseR) * avgRisk * worst.count,
        metric: { label: `${worst.key} avg`, value: fmtR(worst.avgR) },
        action: `Trade ${LONG_DAY[worst.key] ?? worst.key}s with half size, or only take your top setup on that day.`,
        tradeIds: ids(s.filter((t) => WEEKDAYS[toDate(t.entryTime).getDay()] === worst.key)),
      })
    }
  }

  // ───────── Friday afternoon (specific, very common leak)
  {
    const fri = s.filter((t) => {
      const d = toDate(t.entryTime)
      return !allDay && d.getDay() === 5 && d.getHours() * 60 + d.getMinutes() >= 13 * 60 + 30
    })
    const st = statOf('', fri)
    if (fri.length >= 12 && st.avgR < baseR - 0.4) {
      out.push({
        id: 'friday-pm',
        kind: 'leak',
        severity: st.pnl < 0 ? 2 : 1,
        category: 'Timing',
        title: 'Friday afternoons are expensive',
        detail: `${fri.length} trades after 13:30 on Fridays: ${fmtPct(st.winRate)} win rate, ${fmtR(st.avgR)} per trade. Liquidity thins and you trade it anyway.`,
        impact: Math.min(st.pnl, (st.avgR - baseR) * avgRisk * fri.length),
        metric: { label: 'Fri PM win rate', value: fmtPct(st.winRate) },
        action: 'Make Friday 13:30 your weekly review time instead of trading time.',
        tradeIds: ids(fri),
      })
    }
  }

  // ───────── Hour of day
  {
    const gs = groupStats(s, hourBucket).filter((g) => g.count >= 20)
    const worst = [...gs].sort((a, b) => a.avgR - b.avgR)[0]
    const best = [...gs].sort((a, b) => b.avgR - a.avgR)[0]
    if (worst && worst.avgR < baseR - 0.3) {
      out.push({
        id: `hour-${worst.key}`,
        kind: 'leak',
        severity: worst.avgR < 0 ? 2 : 1,
        category: 'Timing',
        title: `Your ${worst.key === 'Pre' ? 'pre-market' : worst.key} hours are a weak spot`,
        detail: `${worst.count} trades opened in this window average ${fmtR(worst.avgR)} with a ${fmtPct(worst.winRate)} win rate.`,
        impact: Math.min(worst.pnl, (worst.avgR - baseR) * avgRisk * worst.count),
        metric: { label: 'Avg R', value: fmtR(worst.avgR) },
        action: 'Block this hour in your trading plan for the next 20 sessions and measure the difference.',
        tradeIds: ids(s.filter((t) => hourBucket(t) === worst.key)),
      })
    }
    if (best && best.avgR > baseR + 0.2) {
      out.push({
        id: `hour-best-${best.key}`,
        kind: 'strength',
        severity: 2,
        category: 'Timing',
        title: `${best.key === 'Pre' ? 'Pre-market' : best.key} is your golden hour`,
        detail: `${best.count} trades, ${fmtPct(best.winRate)} win rate and ${fmtR(best.avgR)} per trade. This is where your edge lives.`,
        impact: best.pnl,
        metric: { label: 'Avg R', value: fmtR(best.avgR) },
        action: 'Be fully prepared and at the desk for this window every day. Consider sizing up slightly here.',
        tradeIds: ids(s.filter((t) => hourBucket(t) === best.key)),
      })
    }
  }

  // ───────── Mistake costs (each mistake costed by the mechanism that makes it expensive)
  {
    const cleanR = clean.length ? clean.reduce((a, t) => a + rOf(t), 0) / clean.length : baseR
    const mistakeGroups = groupStats(s.filter((t) => t.mistakes.length), (t) => t.mistakes)
    const costed = mistakeGroups.map((g) => {
      const ts = s.filter((t) => t.mistakes.includes(g.key as never))
      const risk = ts.reduce((a, t) => a + t.risk, 0) / Math.max(1, ts.length)
      let cost: number
      if (g.key === 'Moved stop' || g.key === 'Averaged down') cost = ts.reduce((a, t) => a + Math.min(0, t.pnl + t.risk), 0)
      else if (g.key === 'Oversized') cost = Math.min(0, ts.reduce((a, t) => a + t.pnl * Math.max(0, 1 - avgRisk / t.risk), 0)) + Math.min(0, (g.avgR - cleanR) * avgRisk * g.count * 0.5)
      else cost = Math.min(0, (g.avgR - cleanR) * risk * g.count)
      return { g, ts, cost }
    })
    for (const { g, ts, cost } of costed.sort((a, b) => a.cost - b.cost).slice(0, 3)) {
      if (g.count < 8 || cost > -0.01 * Math.abs(summary.netPnl)) continue
      out.push({
        id: `mistake-${g.key}`,
        kind: 'leak',
        severity: cost < -0.08 * Math.abs(summary.netPnl) ? 3 : 2,
        category: g.key === 'Moved stop' || g.key === 'Oversized' || g.key === 'Averaged down' ? 'Risk' : 'Execution',
        title: `Mistake: ${g.key.toLowerCase()}`,
        detail: `Tagged on ${g.count} trades (${fmtR(g.avgR)} avg vs ${fmtR(cleanR)} on clean trades). ${g.key === 'Moved stop' || g.key === 'Averaged down' ? 'Losses beyond your planned −1R' : g.key === 'Oversized' ? 'The extra size on these trades' : 'The gap to your rule-following trades'} cost roughly ${Math.abs(Math.round(cost)).toLocaleString()}.`,
        impact: cost,
        metric: { label: 'Occurrences', value: String(g.count) },
        action: MISTAKE_ACTIONS[g.key] ?? 'Write the rule on a sticky note on your monitor and review every occurrence on the weekend.',
        tradeIds: ids(ts),
      })
    }
  }

  // ───────── Holding losers longer than winners
  if (summary.avgHoldLoss > summary.avgHoldWin * 1.3 && summary.losses > 20) {
    const ratio = summary.avgHoldLoss / summary.avgHoldWin
    const longLosers = s.filter((t) => t.pnl < 0 && (toDate(t.exitTime).getTime() - toDate(t.entryTime).getTime()) / 60000 > summary.avgHoldWin * 2)
    out.push({
      id: 'hold-losers',
      kind: 'leak',
      severity: ratio > 1.7 ? 2 : 1,
      category: 'Execution',
      title: 'You hold losers longer than winners',
      detail: `Losing trades last ${ratio.toFixed(1)}× longer than winners (${Math.round(summary.avgHoldLoss)}m vs ${Math.round(summary.avgHoldWin)}m) — the classic disposition effect: hoping losers come back, cutting winners early.`,
      impact: longLosers.reduce((a, t) => a + Math.min(0, t.pnl + t.risk * 0.9), 0),
      metric: { label: 'Hold ratio', value: `${ratio.toFixed(1)}×` },
      action: 'Use a time stop: if a trade is not working within your average winner’s duration, get out.',
      tradeIds: ids(longLosers),
    })
  }

  // ───────── Overtrading
  {
    const byDay = new Map<string, Trade[]>()
    for (const t of s) {
      const k = dayKey(t.entryTime)
      if (!byDay.has(k)) byDay.set(k, [])
      byDay.get(k)!.push(t)
    }
    const late: Trade[] = []
    for (const ts of byDay.values()) {
      ts.sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1))
      late.push(...ts.slice(settings.maxTradesPerDay - 1))
    }
    const st = statOf('', late)
    if (late.length >= 12 && st.avgR < baseR - 0.3) {
      out.push({
        id: 'overtrading',
        kind: 'leak',
        severity: st.pnl < 0 ? 2 : 1,
        category: 'Psychology',
        title: `Overtrading after trade #${settings.maxTradesPerDay - 1}`,
        detail: `Trades #${settings.maxTradesPerDay} and later in a session average ${fmtR(st.avgR)} (${late.length} trades). Your first trades of the day carry your edge.`,
        impact: Math.min(st.pnl, (st.avgR - baseR) * avgRisk * late.length),
        metric: { label: 'Late-session avg', value: fmtR(st.avgR) },
        action: `Cap yourself at ${settings.maxTradesPerDay - 1} trades per day. Quality over quantity.`,
        tradeIds: ids(late),
      })
    }
  }

  // ───────── Daily loss limit breaches
  {
    const days = dailyStats(s)
    const breaches = days.filter((d) => d.pnl < -settings.maxDailyLoss)
    if (breaches.length >= 2) {
      const set = new Set(breaches.map((b) => b.date))
      const ts = s.filter((t) => set.has(dayKey(t.exitTime)))
      const excess = breaches.reduce((a, d) => a + (d.pnl + settings.maxDailyLoss), 0)
      out.push({
        id: 'daily-limit',
        kind: 'leak',
        severity: breaches.length > 6 ? 3 : 2,
        category: 'Risk',
        title: 'Daily loss limit breached',
        detail: `You broke your ${settings.maxDailyLoss.toLocaleString()} max daily loss on ${breaches.length} days. Losses beyond the limit add up to ${Math.abs(Math.round(excess)).toLocaleString()}.`,
        impact: excess,
        metric: { label: 'Breaches', value: String(breaches.length) },
        action: 'Set the max daily loss as a hard lock in your broker. When it hits, the day is over — no exceptions.',
        tradeIds: ids(ts),
      })
    }
  }

  // ───────── Winners that turned into losers
  {
    const gaveBack = s.filter((t) => t.pnl < 0 && t.mfe >= 1)
    if (gaveBack.length >= 10) {
      out.push({
        id: 'gave-back',
        kind: 'leak',
        severity: 1,
        category: 'Execution',
        title: 'Winners that turned into losers',
        detail: `${gaveBack.length} losing trades were at least +1R in profit at some point. A break-even stop rule would have saved most of them.`,
        impact: gaveBack.reduce((a, t) => a + t.pnl, 0),
        metric: { label: 'Trades', value: String(gaveBack.length) },
        action: 'Move your stop to break-even (or take ⅓ off) once a trade reaches +1R.',
        tradeIds: ids(gaveBack),
      })
    }
  }

  // ───────── Profit capture (MFE)
  if (summary.avgMfeCapture < 0.6 && summary.wins > 20) {
    const winners = s.filter((t) => t.pnl > 0 && t.mfe > rOf(t) + 0.8)
    out.push({
      id: 'capture',
      kind: 'leak',
      severity: 1,
      category: 'Execution',
      title: 'Leaving money on the table',
      detail: `On winning trades you capture ${fmtPct(summary.avgMfeCapture)} of the maximum favourable move. ${winners.length} winners ran ≥0.8R further than your exit.`,
      impact: -winners.reduce((a, t) => a + (t.mfe - rOf(t)) * t.risk * 0.35, 0),
      metric: { label: 'MFE capture', value: fmtPct(summary.avgMfeCapture) },
      action: 'Scale out instead of all-out: take ½ at target, trail the rest under structure.',
      tradeIds: ids(winners),
    })
  }

  // ───────── Holding-time sweet spot
  {
    const gs = groupStats(s, holdBucket).filter((g) => g.count >= 20)
    const best = [...gs].sort((a, b) => b.avgR - a.avgR)[0]
    if (best && best.avgR > baseR + 0.25) {
      out.push({
        id: 'hold-best',
        kind: 'strength',
        severity: 1,
        category: 'Execution',
        title: `Sweet spot: ${best.key} holds`,
        detail: `Trades held ${best.key} return ${fmtR(best.avgR)} on average (${best.count} trades).`,
        impact: best.pnl,
        metric: { label: 'Avg R', value: fmtR(best.avgR) },
        action: 'Plan targets that realistically play out in this timeframe.',
        tradeIds: ids(s.filter((t) => holdBucket(t) === best.key)),
      })
    }
    void HOLD_ORDER
  }

  // ───────── Strengths: best setup, best emotional state, improvement trend
  {
    const best = groupStats(s, (t) => t.setup)
      .filter((g) => g.count >= 20)
      .sort((a, b) => b.totalR - a.totalR)[0]
    if (best && best.avgR > 0) {
      out.push({
        id: `best-setup-${best.key}`,
        kind: 'strength',
        severity: 3,
        category: 'Strategy',
        title: `“${best.key}” is your A+ edge`,
        detail: `${best.count} trades, ${fmtPct(best.winRate)} win rate, profit factor ${best.profitFactor.toFixed(2)} and ${best.totalR.toFixed(0)}R in total.`,
        impact: best.pnl,
        metric: { label: 'Expectancy', value: fmtR(best.avgR) },
        action: 'Make this your bread and butter. Build a playbook page with your 10 best examples of it.',
        tradeIds: ids(s.filter((t) => t.setup === best.key)),
      })
    }
    const calm = s.filter((t) => t.logged !== false && (t.emotion === 'Calm' || t.emotion === 'Focused'))
    const st = statOf('', calm)
    if (calm.length > 30 && st.avgR > baseR) {
      out.push({
        id: 'calm',
        kind: 'strength',
        severity: 2,
        category: 'Psychology',
        title: 'Calm & focused is where you print',
        detail: `In a calm or focused state you average ${fmtR(st.avgR)} with a ${fmtPct(st.winRate)} win rate across ${calm.length} trades.`,
        impact: st.pnl,
        metric: { label: 'Avg R', value: fmtR(st.avgR) },
        action: 'Protect this state: pre-market routine, no social media, and walk away after 2 losses.',
        tradeIds: ids(calm),
      })
    }
    if (s.length >= 160) {
      const first = statOf('', s.slice(0, 80))
      const lastN = statOf('', s.slice(-80))
      const adhFirst = s.slice(0, 80).filter((t) => t.followedPlan).length / 80
      const adhLast = s.slice(-80).filter((t) => t.followedPlan).length / 80
      if (adhLast > adhFirst + 0.05 || lastN.avgR > first.avgR + 0.1) {
        out.push({
          id: 'improving',
          kind: 'habit',
          severity: 2,
          category: 'Psychology',
          title: 'You are getting better',
          detail: `Plan adherence moved from ${fmtPct(adhFirst)} → ${fmtPct(adhLast)} and expectancy from ${fmtR(first.avgR)} → ${fmtR(lastN.avgR)} comparing your first and last 80 trades.`,
          impact: lastN.pnl,
          metric: { label: 'Adherence', value: fmtPct(adhLast) },
          action: 'Keep journaling every trade — the data shows it is working.',
          tradeIds: ids(s.slice(-80)),
        })
      }
    }
  }

  // ───────── Sweden: what the coin did in the hour after you sold (from the recorded pump.fun trades)
  {
    const w = s.filter((t) => t.afterHi != null && t.costBasis)
    const wins = w.filter((t) => t.pnl > 0)
    const ran = wins.filter((t) => (t.afterHi ?? 0) >= 0.5)
    if (ran.length >= 5 && ran.length / wins.length >= 0.3) {
      const left = ran.reduce((a, t) => a + ((t.costBasis ?? 0) + t.pnl) * Math.min(1, t.afterHi ?? 0) * 0.5, 0)
      out.push({
        id: 'after-ran',
        kind: 'leak',
        severity: ran.length / wins.length >= 0.5 ? 3 : 2,
        category: 'Execution',
        title: 'Your winners kept running after you sold',
        detail: `${ran.length} of ${wins.length} winning trades (${fmtPct(ran.length / wins.length)}) went at least +50% higher within an hour of your exit (median +${Math.round(median(ran.map((t) => t.afterHi ?? 0)) * 100)}%). Catching half of that move would have added about ${Math.abs(Math.round(left * 100) / 100).toLocaleString()}.`,
        impact: -left,
        metric: { label: 'Ran +50% after exit', value: fmtPct(ran.length / wins.length) },
        action: 'Sell part at your target and keep a runner with a trailing stop, instead of selling everything at once.',
        tradeIds: ids(ran),
      })
    }
    const losers = w.filter((t) => t.pnl < 0)
    const back = losers.filter((t) => {
      const ret = t.pnl / (t.costBasis || 1)
      return (1 + (t.afterHi ?? 0)) * (1 + ret) >= 1.1          // back 10 % above your entry within the hour
    })
    if (back.length >= 5 && back.length / losers.length >= 0.3) {
      const cost = back.reduce((a, t) => a + t.pnl, 0)
      out.push({
        id: 'after-shaken',
        kind: 'leak',
        severity: 2,
        category: 'Risk',
        title: 'Shaken out: losers that came back',
        detail: `${back.length} of ${losers.length} losing trades were back at least 10% above your entry within an hour after you sold. Those trades lost ${Math.abs(Math.round(cost * 100) / 100).toLocaleString()} in total. Either your stop is too tight for these coins' swings, or the entries are too early.`,
        impact: cost * 0.5,
        metric: { label: 'Came back', value: fmtPct(back.length / losers.length) },
        action: 'Compare the size of the dip that stopped you out with the coin\'s normal swings; a wider stop with a smaller position keeps the same risk.',
        tradeIds: ids(back),
      })
    }
    const dumped = wins.filter((t) => (t.afterLo ?? 0) <= -0.5)
    if (dumped.length >= 5) {
      out.push({
        id: 'after-dumped',
        kind: 'strength',
        severity: 2,
        category: 'Execution',
        title: 'Good exits before the dump',
        detail: `${dumped.length} of your winners fell 50% or more within an hour after you sold. Your exit timing protected those profits.`,
        impact: dumped.reduce((a, t) => a + t.pnl, 0),
        metric: { label: 'Dumped after exit', value: String(dumped.length) },
        action: 'Write down what told you to sell on those trades and make it a rule.',
        tradeIds: ids(dumped),
      })
    }
  }

  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'leak' ? -1 : b.kind === 'leak' ? 1 : a.kind === 'strength' ? -1 : 1
    return a.kind === 'leak' ? a.impact - b.impact : b.impact - a.impact
  })
}

const LONG_DAY: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }

const MISTAKE_ACTIONS: Record<string, string> = {
  'Moved stop': 'Your stop is decided before entry. Use bracket orders so the stop is live the moment you are filled.',
  Oversized: 'Pre-calculate size with a position-size calculator. Never exceed 1R of planned risk, especially after a loss.',
  'Chased entry': 'Use limit orders at your level. If it runs without you, it was not your trade.',
  'Early exit': 'Let the stop and target do the work. Take a partial if you must, but keep a runner.',
  'No setup': 'If it is not in your playbook, it is gambling. Write the setup name before every entry.',
  'Ignored plan': 'Read your plan aloud before the open and score adherence after every trade.',
  'Averaged down': 'Adding to losers is how accounts blow up. Only add to winners.',
  'Late entry': 'Set alerts at levels in pre-market so you are ready when price arrives.',
}

/** Equity curve if a given set of trades had never been taken. */
export function whatIf(trades: Trade[], excludeIds: Set<string>) {
  return sortByExit(trades).filter((t) => !excludeIds.has(t.id))
}
