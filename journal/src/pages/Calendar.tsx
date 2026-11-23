import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAnalytics } from '@/store/analytics'
import { useUI } from '@/store/useUI'
import { Card, CardHeader, Money, SectionTitle, cx, Pill } from '@/components/ui/primitives'
import { MonthCalendar, YearHeatmap } from '@/components/charts/MonthCalendar'
import { EquityChart } from '@/components/charts/EquityChart'
import { dateLong, pct, rFmt, time, money } from '@/lib/format'
import { dayKey, equityCurve, rOf, statOf } from '@/lib/stats'

export function CalendarPage() {
  const { days, trades, summary } = useAnalytics()
  const openTrade = useUI((s) => s.openTrade)
  const [sel, setSel] = useState<string | null>(days[days.length - 1]?.date ?? null)
  const dayTrades = useMemo(() => trades.filter((t) => dayKey(t.exitTime) === sel), [trades, sel])
  const ds = statOf(sel ?? '', dayTrades)
  const intraday = useMemo(() => equityCurve(dayTrades, 0), [dayTrades])

  const weeks = useMemo(() => {
    const m = new Map<string, { key: string; pnl: number; days: number; green: number; trades: number }>()
    for (const d of days) {
      const dt = new Date(d.date + 'T12:00')
      const mon = new Date(dt)
      mon.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
      const k = mon.toISOString().slice(0, 10)
      if (!m.has(k)) m.set(k, { key: k, pnl: 0, days: 0, green: 0, trades: 0 })
      const w = m.get(k)!
      w.pnl += d.pnl
      w.days++
      w.trades += d.trades
      if (d.pnl > 0) w.green++
    }
    return [...m.values()].reverse().slice(0, 10)
  }, [days])
  const maxW = Math.max(1, ...weeks.map((w) => Math.abs(w.pnl)))

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Consistency is a habit" title="Calendar">
        {summary.greenDays} green and {summary.redDays} red sessions · {pct(summary.dayWinRate, 0)} of days profitable.
      </SectionTitle>

      <Card className="p-5 sm:p-6">
        <div className="mb-4 text-[13px] text-ink-2">Last 12 months</div>
        <YearHeatmap days={days} onSelect={setSel} />
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="p-5 sm:p-6 xl:col-span-7">
          <MonthCalendar days={days} onSelect={setSel} selected={sel} />
        </Card>

        <Card className="xl:col-span-5">
          <AnimatePresence mode="wait">
            <motion.div key={sel} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.25 }}>
              {sel && dayTrades.length ? (
                <div>
                  <div className="p-5 sm:p-6">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-gold/80">Session recap</div>
                    <div className="mt-1 font-display text-3xl">{dateLong(sel + 'T12:00')}</div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div>
                        <div className="text-[11px] text-ink-4">Net</div>
                        <Money value={ds.pnl} sign colored className="text-xl font-semibold" />
                      </div>
                      <div>
                        <div className="text-[11px] text-ink-4">Win rate</div>
                        <div className="num text-xl font-semibold">{pct(ds.winRate, 0)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-ink-4">R</div>
                        <div className={cx('num text-xl font-semibold', ds.totalR >= 0 ? 'text-profit' : 'text-loss')}>{rFmt(ds.totalR, 1)}</div>
                      </div>
                    </div>
                  </div>
                  {intraday.length > 2 && (
                    <div className="px-2">
                      <EquityChart curve={intraday} height={150} showDrawdown={false} baseline={0} />
                    </div>
                  )}
                  <div className="divide-y divide-line px-3 pb-3">
                    {dayTrades.map((t) => (
                      <button key={t.id} onClick={() => openTrade(t.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.03]">
                        <span className="num w-11 text-xs text-ink-4">{time(t.entryTime)}</span>
                        <span className={cx('h-5 w-1 rounded-full', t.side === 'long' ? 'bg-profit/70' : 'bg-loss/70')} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{t.symbol}</div>
                          <div className="truncate text-[11px] text-ink-4">
                            {t.setup} · {t.emotion}
                          </div>
                        </div>
                        {!t.followedPlan && <Pill tone="loss">{t.mistakes[0] ?? 'Rule'}</Pill>}
                        <div className="text-right">
                          <Money value={t.pnl} sign colored className="block text-sm font-semibold" />
                          <span className="num text-[10.5px] text-ink-4">{rFmt(rOf(t), 1)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid h-full min-h-[300px] place-items-center p-8 text-center text-sm text-ink-3">Select a trading day to see its recap.</div>
              )}
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>

      <Card>
        <CardHeader title="Weekly report card" subtitle="Last 10 weeks" />
        <div className="space-y-2 p-5">
          {weeks.map((w, i) => (
            <motion.div key={w.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="grid grid-cols-[110px_1fr_auto] items-center gap-4 text-[12.5px] sm:grid-cols-[130px_1fr_140px_auto]">
              <span className="text-ink-3">Week of {dateLong(w.key + 'T12:00').replace(/, \d{4}/, '')}</span>
              <div className="relative h-2 rounded-full bg-white/[0.04]">
                <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
                <motion.div
                  className={cx('absolute top-0 h-full rounded-full', w.pnl >= 0 ? 'bg-profit' : 'bg-loss')}
                  style={w.pnl >= 0 ? { left: '50%' } : { right: '50%' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(Math.abs(w.pnl) / maxW) * 50}%` }}
                  transition={{ duration: 0.9, delay: i * 0.03 }}
                />
              </div>
              <span className="hidden text-ink-4 sm:block">
                {w.green}/{w.days} green · {w.trades} trades
              </span>
              <span className={cx('num w-20 text-right font-semibold', w.pnl >= 0 ? 'text-profit' : 'text-loss')}>
                <Money value={w.pnl} sign compact />
              </span>
            </motion.div>
          ))}
        </div>
        <div className="px-5 pb-5 text-[11px] text-ink-4">Best week: {money(Math.max(...weeks.map((w) => w.pnl)), { sign: true })}</div>
      </Card>
    </div>
  )
}
