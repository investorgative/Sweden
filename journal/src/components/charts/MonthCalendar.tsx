import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMemo, useState } from 'react'
import type { DayStat } from '@/data/types'
import { MONTHS, money } from '@/lib/format'
import { cx, usePrivacy } from '@/components/ui/primitives'
import { allDay } from '@/lib/stats'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function key(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function MonthCalendar({ days, initial, compact, onSelect, selected }: { days: DayStat[]; initial?: Date; compact?: boolean; onSelect?: (d: string) => void; selected?: string | null }) {
  const privacy = usePrivacy()
  const map = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const start = initial ?? (days.length ? new Date(days[days.length - 1].date + 'T12:00:00') : new Date())
  const [cursor, setCursor] = useState(new Date(start.getFullYear(), start.getMonth(), 1))
  const [dir, setDir] = useState(0)
  const max = Math.max(1, ...days.map((d) => Math.abs(d.pnl)))

  const weeks = useMemo(() => {
    const first = new Date(cursor)
    const offset = (first.getDay() + 6) % 7
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - offset)
    const out: Date[][] = []
    const d = new Date(gridStart)
    for (let w = 0; w < 6; w++) {
      const week: Date[] = []
      for (let i = 0; i < 7; i++) {
        week.push(new Date(d))
        d.setDate(d.getDate() + 1)
      }
      if (w >= 4 && week[0].getMonth() !== cursor.getMonth()) break
      out.push(week)
    }
    return out
  }, [cursor])

  const monthDays = days.filter((d) => d.date.startsWith(key(cursor).slice(0, 7)))
  const monthPnl = monthDays.reduce((s, d) => s + d.pnl, 0)
  const greens = monthDays.filter((d) => d.pnl > 0).length

  const move = (n: number) => {
    setDir(n)
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1))
  }

  const five = compact && !allDay
  const cols = five ? DOW.slice(0, 5) : DOW
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="font-display text-2xl leading-none">
            {MONTHS[cursor.getMonth()]} <span className="text-ink-3">{cursor.getFullYear()}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-3">
            <span className={cx('num font-medium', monthPnl >= 0 ? 'text-profit' : 'text-loss', privacy && 'privacy-blur')}>{money(monthPnl, { sign: true })}</span>·
            <span>
              {greens}/{monthDays.length} green days
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => move(-1)} className="rounded-full border border-line p-1.5 text-ink-3 hover:border-line-2 hover:text-ink" aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => move(1)} className="rounded-full border border-line p-1.5 text-ink-3 hover:border-line-2 hover:text-ink" aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className={cx('grid gap-1.5', five ? 'grid-cols-5' : compact ? 'grid-cols-7' : 'grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)]')}>
        {cols.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] uppercase tracking-wider text-ink-4">
            {d}
          </div>
        ))}
        {!compact && <div className="pb-1 text-center text-[10px] uppercase tracking-wider text-ink-4">Week</div>}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={key(cursor)} initial={{ opacity: 0, x: dir * 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -20 }} transition={{ duration: 0.25 }} className="space-y-1.5">
          {weeks.map((week, wi) => {
            const wk = week.map((d) => map.get(key(d))).filter(Boolean) as DayStat[]
            const wkPnl = wk.reduce((s, d) => s + d.pnl, 0)
            const shown = five ? week.slice(0, 5) : week
            return (
              <div key={wi} className={cx('grid gap-1.5', five ? 'grid-cols-5' : compact ? 'grid-cols-7' : 'grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)]')}>
                {shown.map((d) => {
                  const k = key(d)
                  const st = map.get(k)
                  const inMonth = d.getMonth() === cursor.getMonth()
                  const inten = st ? 0.12 + 0.6 * Math.min(1, Math.abs(st.pnl) / max) ** 0.7 : 0
                  const bg = st ? (st.pnl >= 0 ? `rgba(79,220,156,${inten})` : `rgba(255,107,127,${inten})`) : undefined
                  return (
                    <button
                      key={k}
                      onClick={() => st && onSelect?.(k)}
                      className={cx(
                        'relative flex flex-col justify-between rounded-xl border text-left transition',
                        compact ? 'aspect-[1.25] p-1.5' : 'aspect-square p-2 sm:aspect-[1.15]',
                        inMonth ? 'border-line' : 'border-transparent opacity-30',
                        st ? 'hover:-translate-y-0.5 hover:border-line-2' : 'cursor-default bg-white/[0.015]',
                        selected === k && 'ring-1 ring-gold',
                      )}
                      style={{ background: bg }}
                    >
                      <span className="text-[10px] text-ink-3">{d.getDate()}</span>
                      {st && (
                        <span className="min-w-0">
                          <span className={cx('num block truncate font-semibold', compact ? 'text-[10px]' : 'text-[11px] sm:text-[12.5px]', st.pnl >= 0 ? 'text-[#b9ffdc]' : 'text-[#ffd0d6]', privacy && 'privacy-blur')}>
                            {money(st.pnl, { compact: true, sign: true })}
                          </span>
                          {!compact && <span className="hidden text-[10px] text-ink-2/70 sm:block">{st.trades} trades</span>}
                        </span>
                      )}
                    </button>
                  )
                })}
                {!compact && (
                  <div className="flex flex-col justify-center rounded-xl border border-dashed border-line px-2 text-right">
                    <span className="text-[10px] text-ink-4">W{wi + 1}</span>
                    <span className={cx('num text-[11px] font-semibold sm:text-[12.5px]', wkPnl > 0 ? 'text-profit' : wkPnl < 0 ? 'text-loss' : 'text-ink-4', privacy && 'privacy-blur')}>{wk.length ? money(wkPnl, { compact: true, sign: true }) : '—'}</span>
                  </div>
                )}
              </div>
            )
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Year heatmap (GitHub-style) */
export function YearHeatmap({ days, onSelect }: { days: DayStat[]; onSelect?: (d: string) => void }) {
  const privacy = usePrivacy()
  const [hover, setHover] = useState<DayStat | null>(null)
  const map = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const end = days.length ? new Date(days[days.length - 1].date + 'T12:00:00') : new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const max = Math.max(1, ...days.map((d) => Math.abs(d.pnl)))
  const cols: Date[][] = []
  const d = new Date(start)
  while (d <= end) {
    const col: Date[] = []
    for (let i = 0; i < 7; i++) {
      col.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    cols.push(col)
  }
  return (
    <div>
      <div className="no-scrollbar overflow-x-auto">
        <div className="grid min-w-[640px] gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              <div className="h-4 overflow-visible whitespace-nowrap text-[9px] text-ink-4">{col[0].getDate() <= 7 ? MONTHS[col[0].getMonth()] : ''}</div>
              {col.map((day) => {
                const st = map.get(key(day))
                const inten = st ? 0.18 + 0.82 * Math.min(1, Math.abs(st.pnl) / max) ** 0.6 : 0
                return (
                  <button
                    key={key(day)}
                    onMouseEnter={() => setHover(st ?? null)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => st && onSelect?.(st.date)}
                    className="aspect-square w-full rounded-[3px] transition-transform hover:scale-125"
                    style={{ background: st ? (st.pnl >= 0 ? `rgba(79,220,156,${inten})` : `rgba(255,107,127,${inten})`) : day > end ? 'transparent' : 'rgba(255,255,255,.035)' }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-5 items-center justify-between text-[11px] text-ink-3">
        <span>
          {hover ? (
            <>
              {hover.date} · <span className={cx('num', hover.pnl >= 0 ? 'text-profit' : 'text-loss', privacy && 'privacy-blur')}>{money(hover.pnl, { sign: true })}</span> · {hover.trades} trades
            </>
          ) : (
            'Hover a day'
          )}
        </span>
        <span className="flex items-center gap-1">
          Loss
          {[0.8, 0.45, 0.2].map((o) => (
            <span key={o} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `rgba(255,107,127,${o})` }} />
          ))}
          {[0.2, 0.45, 0.8].map((o) => (
            <span key={o} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `rgba(79,220,156,${o})` }} />
          ))}
          Profit
        </span>
      </div>
    </div>
  )
}
