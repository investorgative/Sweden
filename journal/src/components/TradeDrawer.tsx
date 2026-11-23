import { ChevronLeft, ChevronRight, Pencil, Trash2, X, Star, ShieldCheck, TriangleAlert, Clock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Drawer, Pill, Money, cx, Button } from './ui/primitives'
import { useUI } from '@/store/useUI'
import { useJournal } from '@/store/useJournal'
import { useAnalytics } from '@/store/analytics'
import { TradePath } from './charts/TradePath'
import { dateLong, duration, money, pct, price, rFmt, time } from '@/lib/format'
import { holdMinutes, rOf } from '@/lib/stats'

export function TradeDrawer() {
  const id = useUI((s) => s.openTradeId)
  const openTrade = useUI((s) => s.openTrade)
  const editTrade = useUI((s) => s.editTrade)
  const deleteTrade = useJournal((s) => s.deleteTrade)
  const { all } = useAnalytics()
  const [confirm, setConfirm] = useState(false)
  const idx = useMemo(() => all.findIndex((t) => t.id === id), [all, id])
  const t = idx >= 0 ? all[idx] : null
  const close = () => {
    setConfirm(false)
    openTrade(null)
  }
  const r = t ? rOf(t) : 0
  const targetR = t && t.targetPrice && t.risk ? Math.abs(t.targetPrice - t.entryPrice) / Math.abs(t.entryPrice - t.stopPrice) : undefined

  return (
    <Drawer open={!!t} onClose={close}>
      {t && (
        <div>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg-1/90 px-6 py-4 backdrop-blur">
            <div className="flex items-center gap-1">
              <button disabled={idx <= 0} onClick={() => openTrade(all[idx - 1].id)} className="rounded-full p-2 text-ink-3 hover:bg-white/5 hover:text-ink disabled:opacity-30" aria-label="Previous trade">
                <ChevronLeft size={18} />
              </button>
              <button disabled={idx >= all.length - 1} onClick={() => openTrade(all[idx + 1].id)} className="rounded-full p-2 text-ink-3 hover:bg-white/5 hover:text-ink disabled:opacity-30" aria-label="Next trade">
                <ChevronRight size={18} />
              </button>
              <span className="ml-2 font-mono text-[11px] text-ink-4">
                {t.id} · {idx + 1}/{all.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => editTrade(t.id)} className="rounded-full p-2 text-ink-3 hover:bg-white/5 hover:text-ink" aria-label="Edit">
                <Pencil size={16} />
              </button>
              <button onClick={() => setConfirm(true)} className="rounded-full p-2 text-ink-3 hover:bg-loss/10 hover:text-loss" aria-label="Delete">
                <Trash2 size={16} />
              </button>
              <button onClick={close} className="rounded-full p-2 text-ink-3 hover:bg-white/5 hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          {confirm && (
            <div className="mx-6 mt-4 flex items-center justify-between rounded-2xl border border-loss/30 bg-loss/10 p-4 text-sm">
              <span>{t.source === 'wallet' ? 'Hide this wallet trade from the journal? (Settings > Data brings hidden trades back.)' : 'Delete this trade permanently?'}</span>
              <div className="flex gap-2">
                <Button onClick={() => setConfirm(false)}>Cancel</Button>
                <Button variant="danger" onClick={() => (deleteTrade(t.id), close())}>
                  {t.source === 'wallet' ? 'Hide' : 'Delete'}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-6 p-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {t.image && <img src={t.image} alt="" className="h-12 w-12 rounded-xl object-cover" referrerPolicy="no-referrer" />}
                <span className="font-display text-5xl leading-none">{t.symbol}</span>
                <Pill tone={t.side === 'long' ? 'profit' : 'loss'}>{t.side.toUpperCase()}</Pill>
                <Pill>{t.assetClass}</Pill>
                <Pill tone="gold">{t.setup}</Pill>
              </div>
              <div className="mt-2 text-sm text-ink-3">
                {t.name && <span className="text-ink-2">{t.name} · </span>}
                {dateLong(t.entryTime)} · {time(t.entryTime)} → {t.open ? 'now' : time(t.exitTime)} · {t.open ? 'holding for' : 'held'} {duration(holdMinutes(t))}
                {t.ageS != null && <> · bought {duration(t.ageS / 60)} after launch</>}
                {t.buys != null && <> · {t.buys} buy{t.buys === 1 ? '' : 's'} / {t.sells} sell{t.sells === 1 ? '' : 's'}</>}
              </div>
              {t.mint && (
                <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                  <a className="rounded-full border border-line px-3 py-1 text-ink-2 hover:border-gold/40 hover:text-ink" href={`../#coin/${t.mint}`}>Coin in Sweden</a>
                  <a className="rounded-full border border-line px-3 py-1 text-ink-2 hover:border-gold/40 hover:text-ink" href={`https://axiom.trade/t/${t.mint}`} target="_blank" rel="noreferrer">Axiom</a>
                  <button className="rounded-full border border-line px-3 py-1 text-ink-2 hover:border-gold/40 hover:text-ink" onClick={() => void navigator.clipboard?.writeText(t.mint!)}>Copy CA</button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="card p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-3">Net P&amp;L</div>
                <Money value={t.pnl} sign colored className="mt-1 block text-2xl font-semibold" />
              </div>
              <div className="card p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-3">R-multiple</div>
                <div className={cx('num mt-1 text-2xl font-semibold', r >= 0 ? 'text-profit' : 'text-loss')}>{rFmt(r)}</div>
              </div>
              <div className="card p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-3">Risk</div>
                <Money value={t.risk} className="mt-1 block text-2xl font-semibold text-ink-2" />
              </div>
            </div>

            {t.path && (
              <div className="card p-4">
                <div className="mb-2 flex items-center justify-between text-[13px] text-ink-2">
                  <span>Trade replay</span>
                  <span className="text-[11px] text-ink-3">{t.source === 'wallet' ? 'market cap in R (1R = your planned stop) · entry to exit' : 'in R · entry to exit'}</span>
                </div>
                <TradePath path={t.path} target={targetR} height={200} />
              </div>
            )}

            {t.open && (
              <div className="rounded-2xl border border-info/30 bg-info/[0.06] px-4 py-3 text-[12.5px] text-ink-2">
                Still open: valued at today's price{t.priced === false ? ' - no price known for this coin (probably dead), so it counts as 0' : ''}. It becomes a normal trade once you sell.
              </div>
            )}
            {t.source === 'wallet' && !t.open && !t.path && (
              <div className="rounded-2xl border border-line px-4 py-3 text-[12px] text-ink-3">
                No price path for this trade: the coin was no longer in the terminal's memory when it was closed (or the trade is from before the journal). MAE / MFE are estimated from the result.
              </div>
            )}
            {t.afterHi != null && (
              <div className="card p-4 text-[13px]">
                <div className="text-[11px] uppercase tracking-wider text-ink-3">The hour after you sold</div>
                <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
                  <span>
                    peak <b className={cx('num', (t.afterHi ?? 0) > 0 ? 'text-profit' : 'text-ink-2')}>{pct(t.afterHi ?? 0, 0, true)}</b>
                  </span>
                  <span>
                    low <b className={cx('num', (t.afterLo ?? 0) < 0 ? 'text-loss' : 'text-ink-2')}>{pct(t.afterLo ?? 0, 0, true)}</b>
                  </span>
                  <span className="text-ink-3">
                    {(t.afterHi ?? 0) >= 0.5 ? 'it kept running - a runner would have paid' : (t.afterLo ?? 0) <= -0.5 ? 'it dumped - good exit' : 'no big move either way'}
                  </span>
                </div>
              </div>
            )}

            <div className="card grid grid-cols-2 gap-x-6 p-5 text-[13px] sm:grid-cols-3">
              {[
                ...(t.source === 'wallet'
                  ? [
                      ['Entry mcap', money(t.entryPrice, { compact: true })],
                      [t.open ? 'Mcap now' : 'Exit mcap', money(t.exitPrice, { compact: true })],
                      ['Stop mcap', money(t.stopPrice, { compact: true })],
                      ['Target mcap', t.targetPrice ? money(t.targetPrice, { compact: true }) : '—'],
                    ]
                  : [
                      ['Entry', price(t.entryPrice)],
                      ['Exit', price(t.exitPrice)],
                      ['Stop', price(t.stopPrice)],
                      ['Target', t.targetPrice ? price(t.targetPrice) : '—'],
                    ]),
                [t.source === 'wallet' ? 'Tokens' : 'Quantity', Math.round(t.quantity).toLocaleString()],
                [t.source === 'wallet' ? 'Network fees' : 'Fees', t.fees.toFixed(t.fees < 1 ? 4 : 2)],
                ['MAE', rFmt(t.mae)],
                ['MFE', rFmt(t.mfe)],
                ['Captured', t.mfe > 0 && r > 0 ? `${Math.round((r / t.mfe) * 100)}%` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="border-b border-line py-2.5">
                  <div className="text-[11px] text-ink-3">{k}</div>
                  <div className="num mt-0.5 font-medium">{v}</div>
                </div>
              ))}
            </div>

            <div className="card space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div className="text-[13px] text-ink-2">Psychology & execution</div>
                <div className={cx('flex', t.logged === false && 'hidden')}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={15} className={n <= t.rating ? 'fill-gold text-gold' : 'text-ink-4'} />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {t.logged === false ? (
                  <Pill>Not logged yet - press the pencil to add emotion, plan, mistakes</Pill>
                ) : (
                  <Pill tone={['Calm', 'Focused', 'Confident'].includes(t.emotion) ? 'info' : 'loss'}>Felt {t.emotion.toLowerCase()}</Pill>
                )}
                {t.logged === false ? null : t.followedPlan ? (
                  <Pill tone="profit">
                    <ShieldCheck size={11} /> Followed plan
                  </Pill>
                ) : (
                  <Pill tone="loss">
                    <TriangleAlert size={11} /> Broke rules
                  </Pill>
                )}
                {t.mistakes.map((m) => (
                  <Pill key={m} tone="loss">
                    {m}
                  </Pill>
                ))}
                {t.tags.map((m) => (
                  <Pill key={m}>#{m}</Pill>
                ))}
              </div>
              {t.notes ? (
                <blockquote className="border-l-2 border-gold/40 pl-4 font-display text-xl italic leading-snug text-ink">“{t.notes}”</blockquote>
              ) : (
                <div className="flex items-center gap-2 text-xs text-ink-4">
                  <Clock size={12} /> No notes yet — journaling every trade earns XP.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}
