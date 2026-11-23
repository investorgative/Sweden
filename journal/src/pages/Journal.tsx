import { useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowDown, ArrowUp, Download, Search, ShieldCheck, TriangleAlert, Upload, X, Rows3, CalendarRange, BookOpen } from 'lucide-react'
import { useAnalytics } from '@/store/analytics'
import { useJournal } from '@/store/useJournal'
import { useUI } from '@/store/useUI'
import { Card, Money, Pill, Segmented, SectionTitle, Button, cx, Empty, Modal } from '@/components/ui/primitives'
import { TradePath } from '@/components/charts/TradePath'
import { dateLong, duration, money, pct, price, rFmt, time, dateShort } from '@/lib/format'
import { holdMinutes, rOf, statOf, dayKey } from '@/lib/stats'
import { toCsv, fromCsv } from '@/lib/csv'
import { download } from '@/lib/share'
import type { Trade } from '@/data/types'

type SortKey = 'date' | 'symbol' | 'pnl' | 'r' | 'hold' | 'setup'

const COLS = (
  <colgroup>
    <col className="w-[92px]" />
    <col className="w-[150px]" />
    <col className="hidden md:table-column" />
    <col className="hidden w-[190px] lg:table-column" />
    <col className="hidden w-[80px] xl:table-column" />
    <col className="hidden w-[230px] lg:table-column" />
    <col className="hidden w-[120px] sm:table-column" />
    <col className="w-[84px]" />
    <col className="w-[120px]" />
  </colgroup>
)

export function Journal() {
  const { trades } = useAnalytics()
  const filters = useJournal((s) => s.filters)
  const setFilters = useJournal((s) => s.setFilters)
  const importTrades = useJournal((s) => s.importTrades)
  const openTrade = useUI((s) => s.openTrade)
  const drill = useUI((s) => s.drill)
  const setDrill = useUI((s) => s.setDrill)
  const [q, setQ] = useState('')
  const [result, setResult] = useState<'all' | 'win' | 'loss'>('all')
  const [plan, setPlan] = useState<'all' | 'kept' | 'broke'>('all')
  const [setup, setSetup] = useState<string>('')
  const [view, setView] = useState<'days' | 'table'>('days')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'date', dir: -1 })
  const [limit, setLimit] = useState(40)
  const [imp, setImp] = useState<{ trades: Trade[]; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup))].sort(), [trades])

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim()
    const drillSet = drill ? new Set(drill.ids) : null
    let out = trades.filter((t) => {
      if (drillSet && !drillSet.has(t.id)) return false
      if (result === 'win' && t.pnl <= 0) return false
      if (result === 'loss' && t.pnl >= 0) return false
      if (plan === 'kept' && (!t.followedPlan || t.logged === false)) return false
      if (plan === 'broke' && (t.followedPlan || t.logged === false)) return false
      if (setup && t.setup !== setup) return false
      if (ql && !(t.symbol.toLowerCase().includes(ql) || t.setup.toLowerCase().includes(ql) || t.notes.toLowerCase().includes(ql) || t.tags.some((x) => x.toLowerCase().includes(ql)) || t.mistakes.some((x) => x.toLowerCase().includes(ql)) || t.emotion.toLowerCase().includes(ql))) return false
      return true
    })
    const val = (t: Trade): number | string => {
      switch (sort.k) {
        case 'symbol':
          return t.symbol
        case 'setup':
          return t.setup
        case 'pnl':
          return t.pnl
        case 'r':
          return rOf(t)
        case 'hold':
          return holdMinutes(t)
        default:
          return t.exitTime
      }
    }
    out = [...out].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
    return out
  }, [trades, q, result, plan, setup, sort, drill])

  const st = statOf('', filtered)
  const shown = filtered.slice(0, limit)
  const groups = useMemo(() => {
    if (view !== 'days') return []
    const m = new Map<string, Trade[]>()
    for (const t of shown) {
      const k = dayKey(t.exitTime)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(t)
    }
    return [...m.entries()]
  }, [shown, view])

  const activeChips = [
    ...filters.symbols.map((s) => ({ label: s, clear: () => setFilters({ symbols: filters.symbols.filter((x) => x !== s) }) })),
    ...filters.setups.map((s) => ({ label: s, clear: () => setFilters({ setups: filters.setups.filter((x) => x !== s) }) })),
    ...(filters.side !== 'all' ? [{ label: filters.side, clear: () => setFilters({ side: 'all' }) }] : []),
    ...(drill ? [{ label: drill.label, clear: () => setDrill(null) }] : []),
  ]

  const onFile = async (f: File) => {
    const text = await f.text()
    setImp(fromCsv(text))
  }

  const SortBtn = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <button onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cx('inline-flex items-center gap-1 hover:text-ink', right && 'flex-row-reverse', sort.k === k && 'text-gold')}>
      {children}
      {sort.k === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  )

  const row = (t: Trade, i: number) => {
    const r = rOf(t)
    return (
      <motion.tr
        key={t.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: Math.min(0.3, i * 0.012) }}
        onClick={() => openTrade(t.id)}
        className="group cursor-pointer border-b border-line/60 text-[13px] transition-colors last:border-0 hover:bg-white/[0.025]"
      >
        <td className="py-3 pl-5 pr-3 text-ink-3">
          <div className="text-ink-2">{view === 'table' ? dateShort(t.exitTime) : time(t.entryTime)}</div>
          {view === 'table' && <div className="text-[11px] text-ink-4">{time(t.entryTime)}</div>}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <span className={cx('h-6 w-1 rounded-full', t.side === 'long' ? 'bg-profit/70' : 'bg-loss/70')} />
            <div>
              <div className="font-semibold">{t.symbol}</div>
              <div className="text-[11px] capitalize text-ink-4">
                {t.side} · {t.assetClass}
              </div>
            </div>
          </div>
        </td>
        <td className="hidden truncate px-3 py-3 text-ink-2 md:table-cell">{t.setup}</td>
        <td className="num hidden px-3 py-3 text-ink-3 lg:table-cell">
          {price(t.entryPrice)} → {price(t.exitPrice)}
        </td>
        <td className="num hidden px-3 py-3 text-ink-3 xl:table-cell">{duration(holdMinutes(t))}</td>
        <td className="hidden px-3 py-3 lg:table-cell">
          <div className="flex flex-wrap items-center gap-1">
            {t.logged === false ? null : t.followedPlan ? <ShieldCheck size={14} className="text-profit/80" /> : <TriangleAlert size={14} className="text-loss/80" />}
            <span className="text-[11.5px] text-ink-3">{t.emotion}</span>
            {t.mistakes.slice(0, 1).map((m) => (
              <Pill key={m} tone="loss" className="text-[10px]">
                {m}
              </Pill>
            ))}
          </div>
        </td>
        <td className="hidden w-[110px] px-3 py-3 sm:table-cell">{t.path && <TradePath path={t.path} height={28} compact />}</td>
        <td className={cx('num px-3 py-3 text-right text-[12.5px]', r >= 0 ? 'text-profit/80' : 'text-loss/80')}>{rFmt(r, 2)}</td>
        <td className="py-3 pl-3 pr-5 text-right">
          <Money value={t.pnl} sign colored className="font-semibold" />
        </td>
      </motion.tr>
    )
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Every trade tells a story"
        title="Journal"
        right={
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Import CSV
            </Button>
            <Button variant="outline" onClick={() => download(new Blob([toCsv(filtered)], { type: 'text/csv' }), `aurum-trades-${new Date().toISOString().slice(0, 10)}.csv`)}>
              <Download size={14} /> Export
            </Button>
          </div>
        }
      />

      {/* filter bar */}
      <Card className="p-4 sm:p-5" noAnim>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol, setup, tag, emotion, mistake or note…" className="focus-ring w-full rounded-full border border-line bg-bg-1 py-2.5 pl-10 pr-4 text-[13px] placeholder:text-ink-4" />
          </div>
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
            <Segmented layoutId="j-result" size="sm" value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'win', label: 'Winners' }, { value: 'loss', label: 'Losers' }]} />
            <Segmented layoutId="j-plan" size="sm" value={plan} onChange={setPlan} options={[{ value: 'all', label: 'Any' }, { value: 'kept', label: 'Plan kept' }, { value: 'broke', label: 'Rules broken' }]} />
            <select value={setup} onChange={(e) => setSetup(e.target.value)} className="focus-ring rounded-full border border-line bg-bg-1 px-3 py-1.5 text-xs text-ink-2">
              <option value="">All setups</option>
              {setups.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <Segmented layoutId="j-side" size="sm" value={filters.side} onChange={(side) => setFilters({ side })} options={[{ value: 'all', label: 'L+S' }, { value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />
          </div>
        </div>
        <AnimatePresence>
          {activeChips.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 flex flex-wrap items-center gap-2 overflow-hidden">
              <span className="text-[11px] text-ink-4">Filtered by</span>
              {activeChips.map((c) => (
                <button key={c.label} onClick={c.clear} className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] capitalize text-gold hover:bg-gold/20">
                  {c.label} <X size={11} />
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* selection stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-5">
          {[
            { l: 'Trades', v: <span className="num">{st.count}</span> },
            { l: 'Net P&L', v: <Money value={st.pnl} sign colored /> },
            { l: 'Win rate', v: <span className="num">{pct(st.winRate)}</span> },
            { l: 'Profit factor', v: <span className="num">{st.profitFactor >= 99 ? '∞' : st.profitFactor.toFixed(2)}</span> },
            { l: 'Avg R', v: <span className={cx('num', st.avgR >= 0 ? 'text-profit' : 'text-loss')}>{rFmt(st.avgR)}</span> },
          ].map((x) => (
            <div key={x.l}>
              <div className="text-[11px] text-ink-4">{x.l}</div>
              <div className="mt-0.5 text-[15px] font-semibold">{x.v}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Segmented
          layoutId="j-view"
          value={view}
          onChange={(v) => (setView(v), v === 'days' && setSort({ k: 'date', dir: -1 }))}
          options={[
            { value: 'days', label: <span className="inline-flex items-center gap-1.5"><CalendarRange size={13} /> By day</span> },
            { value: 'table', label: <span className="inline-flex items-center gap-1.5"><Rows3 size={13} /> Table</span> },
          ]}
        />
        <span className="text-xs text-ink-4">
          Showing {shown.length} of {filtered.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Empty icon={<BookOpen size={20} />} title="No trades match" text="Loosen the filters or log a new trade with the gold button (or press N)." />
        </Card>
      ) : view === 'table' ? (
        <Card className="overflow-hidden" noAnim>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              {COLS}
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-4">
                  <th className="py-3 pl-5 pr-3 font-medium"><SortBtn k="date">Date</SortBtn></th>
                  <th className="px-3 py-3 font-medium"><SortBtn k="symbol">Symbol</SortBtn></th>
                  <th className="hidden px-3 py-3 font-medium md:table-cell"><SortBtn k="setup">Setup</SortBtn></th>
                  <th className="hidden px-3 py-3 font-medium lg:table-cell">Entry → Exit</th>
                  <th className="hidden px-3 py-3 font-medium xl:table-cell"><SortBtn k="hold">Hold</SortBtn></th>
                  <th className="hidden px-3 py-3 font-medium lg:table-cell">Psychology</th>
                  <th className="hidden px-3 py-3 font-medium sm:table-cell">Path</th>
                  <th className="px-3 py-3 text-right font-medium"><SortBtn k="r" right>R</SortBtn></th>
                  <th className="py-3 pl-3 pr-5 text-right font-medium"><SortBtn k="pnl" right>P&amp;L</SortBtn></th>
                </tr>
              </thead>
              <tbody>{shown.map(row)}</tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([day, ts]) => {
            const ds = statOf(day, ts)
            return (
              <Card key={day} className="overflow-hidden" noAnim>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white/[0.015] px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className={cx('h-2 w-2 rounded-full', ds.pnl >= 0 ? 'bg-profit shadow-[0_0_8px_#4fdc9c]' : 'bg-loss shadow-[0_0_8px_#ff6b7f]')} />
                    <span className="font-display text-xl">{dateLong(day + 'T12:00')}</span>
                    <span className="text-xs text-ink-4">
                      {ds.count} trades · {ds.wins}W {ds.losses}L
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={cx('num text-xs', ds.totalR >= 0 ? 'text-profit/80' : 'text-loss/80')}>{rFmt(ds.totalR, 1)}</span>
                    <Money value={ds.pnl} sign colored className="font-semibold" />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    {COLS}
                    <tbody>{ts.map(row)}</tbody>
                  </table>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {limit < filtered.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((l) => l + 60)}>
            Load more ({filtered.length - limit} remaining)
          </Button>
        </div>
      )}

      <Modal open={!!imp} onClose={() => setImp(null)} title="Import trades" width={560}>
        {imp && (
          <div className="space-y-4 p-6 text-sm">
            <p className="text-ink-2">
              Found <span className="font-semibold text-ink">{imp.trades.length}</span> trades
              {imp.trades.length > 0 && (
                <>
                  {' '}
                  with a combined P&amp;L of <Money value={imp.trades.reduce((s, t) => s + t.pnl, 0)} sign colored />
                </>
              )}
              . Columns are matched automatically (symbol, side, entry/exit time &amp; price, quantity, fees, P&amp;L, stop, setup, notes…).
            </p>
            {imp.errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-xl border border-loss/20 bg-loss/5 p-3 text-xs text-loss">
                {imp.errors.slice(0, 20).map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button onClick={() => setImp(null)}>Cancel</Button>
              <Button variant="outline" disabled={!imp.trades.length} onClick={() => (importTrades(imp.trades, 'append'), setImp(null))}>
                Append to journal
              </Button>
              <Button variant="gold" disabled={!imp.trades.length} onClick={() => (importTrades(imp.trades, 'replace'), setImp(null))}>
                Replace demo data
              </Button>
            </div>
            <p className="text-[11px] text-ink-4">Tip: amounts like {money(-1234.5)} or (1,234.50) are understood. Use | to separate multiple tags/mistakes.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
