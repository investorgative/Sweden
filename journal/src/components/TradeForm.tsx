import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Star, Check } from 'lucide-react'
import { Modal, Button, cx } from './ui/primitives'
import { useJournal } from '@/store/useJournal'
import { useUI } from '@/store/useUI'
import type { AssetClass, Emotion, Mistake, Side, Trade } from '@/data/types'
import { money, rFmt, dateLong, time } from '@/lib/format'

const EMOTIONS: Emotion[] = ['Calm', 'Focused', 'Confident', 'Anxious', 'FOMO', 'Revenge', 'Bored', 'Greedy']
const MISTAKES: Mistake[] = ['Moved stop', 'Chased entry', 'Oversized', 'Early exit', 'No setup', 'Ignored plan', 'Averaged down', 'Late entry']
const ASSETS: AssetClass[] = ['Stocks', 'Futures', 'Options', 'Forex', 'Crypto']

const pad = (n: number) => String(n).padStart(2, '0')
const nowLocal = (offsetMin = 0) => {
  const d = new Date(Date.now() + offsetMin * 60000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface FormState {
  symbol: string
  assetClass: AssetClass
  side: Side
  entryTime: string
  exitTime: string
  entryPrice: string
  exitPrice: string
  stopPrice: string
  quantity: string
  multiplier: string
  fees: string
  setup: string
  emotion: Emotion
  mistakes: Mistake[]
  tags: string
  rating: number
  notes: string
}

const empty = (): FormState => ({
  symbol: '',
  assetClass: 'Crypto',
  side: 'long',
  entryTime: nowLocal(-30),
  exitTime: nowLocal(),
  entryPrice: '',
  exitPrice: '',
  stopPrice: '',
  quantity: '',
  multiplier: '1',
  fees: '0',
  setup: '',
  emotion: 'Calm',
  mistakes: [],
  tags: '',
  rating: 4,
  notes: '',
})

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</span>
      {children}
    </label>
  )
}
const inputCls = 'focus-ring w-full rounded-xl border border-line bg-bg-1 px-3 py-2.5 text-sm text-ink placeholder:text-ink-4 transition hover:border-line-2 focus:border-gold/40'

export function TradeForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const trades = useJournal((s) => s.trades)
  const addTrade = useJournal((s) => s.addTrade)
  const updateTrade = useJournal((s) => s.updateTrade)
  const editId = useUI((s) => s.editTradeId)
  const setEdit = useUI((s) => s.editTrade)
  const editing = editId ? trades.find((t) => t.id === editId) : undefined
  const isOpen = open || !!editing
  const [f, setF] = useState<FormState>(empty)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (editing) {
      setF({
        symbol: editing.symbol,
        assetClass: editing.assetClass,
        side: editing.side,
        entryTime: editing.entryTime.slice(0, 16),
        exitTime: editing.exitTime.slice(0, 16),
        entryPrice: String(editing.entryPrice),
        exitPrice: String(editing.exitPrice),
        stopPrice: String(editing.stopPrice),
        quantity: String(editing.quantity),
        multiplier: String(editing.multiplier ?? 1),
        fees: String(editing.fees),
        setup: editing.setup,
        emotion: editing.emotion === 'Not logged' ? 'Calm' : editing.emotion,
        mistakes: editing.mistakes,
        tags: editing.tags.join(', '),
        rating: editing.rating,
        notes: editing.notes,
      })
    } else if (open) setF(empty())
    setSaved(false)
  }, [editing, open])

  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup))].sort(), [trades])
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades])

  const calc = useMemo(() => {
    const e = parseFloat(f.entryPrice)
    const x = parseFloat(f.exitPrice)
    const s = parseFloat(f.stopPrice)
    const q = parseFloat(f.quantity)
    const m = parseFloat(f.multiplier) || 1
    const fee = parseFloat(f.fees) || 0
    if (![e, x, q].every(isFinite)) return null
    const dir = f.side === 'long' ? 1 : -1
    const pnl = (x - e) * dir * q * m - fee
    const risk = isFinite(s) ? Math.abs(e - s) * q * m : 0
    return { pnl, risk, r: risk ? pnl / risk : 0 }
  }, [f])

  const close = () => {
    setEdit(null)
    onClose()
  }

  const wallet = editing?.source === 'wallet'

  const submit = () => {
    if (wallet && editing) {
      // a wallet trade: the numbers come from the chain, only your own entries are saved
      updateTrade({
        ...editing,
        setup: f.setup.trim() || editing.setup,
        tags: f.tags.split(',').map((s) => s.trim()).filter(Boolean),
        mistakes: f.mistakes,
        emotion: f.emotion,
        rating: f.rating,
        followedPlan: f.mistakes.length === 0,
        notes: f.notes,
      })
      setSaved(true)
      setTimeout(close, 650)
      return
    }
    if (!calc || !f.symbol) return
    const r = calc.r
    const t: Trade = {
      id: editing?.id ?? `U${Date.now().toString(36)}`,
      symbol: f.symbol.toUpperCase().trim(),
      assetClass: f.assetClass,
      side: f.side,
      entryTime: `${f.entryTime}:00`.slice(0, 19),
      exitTime: `${f.exitTime}:00`.slice(0, 19),
      entryPrice: parseFloat(f.entryPrice),
      exitPrice: parseFloat(f.exitPrice),
      stopPrice: parseFloat(f.stopPrice) || parseFloat(f.entryPrice),
      quantity: parseFloat(f.quantity),
      multiplier: parseFloat(f.multiplier) || 1,
      fees: parseFloat(f.fees) || 0,
      pnl: +calc.pnl.toFixed(2),
      risk: +calc.risk.toFixed(2),
      mae: editing?.mae ?? Math.min(0, r),
      mfe: editing?.mfe ?? Math.max(0, r),
      setup: f.setup.trim() || 'Unlabeled',
      tags: f.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      mistakes: f.mistakes,
      emotion: f.emotion,
      rating: f.rating,
      followedPlan: f.mistakes.length === 0,
      notes: f.notes,
      path: editing?.path,
    }
    if (editing) updateTrade(t)
    else addTrade(t)
    setSaved(true)
    setTimeout(close, 650)
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))

  return (
    <Modal open={isOpen} onClose={close} width={760} title={editing ? 'Edit trade' : 'Log a trade'}>
      <div className="space-y-6 p-6">
        {wallet && editing && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-bg-1 p-4 text-sm">
            <div>
              <div className="font-medium">{editing.symbol} <span className="text-ink-3">· from your wallet</span></div>
              <div className="text-[12px] text-ink-3">{dateLong(editing.entryTime)} · {time(editing.entryTime)} → {time(editing.exitTime)} · the numbers come from the chain</div>
            </div>
            <div className={cx('num text-xl font-semibold', editing.pnl >= 0 ? 'text-profit' : 'text-loss')}>{money(editing.pnl, { sign: true })}</div>
          </div>
        )}
        {wallet ? (
          <Field label="Setup">
            <input list="setups" className={inputCls} value={f.setup} onChange={(e) => set('setup', e.target.value)} placeholder="Own pick" />
            <datalist id="setups">{setups.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Symbol" className="col-span-2 sm:col-span-1">
            <input list="symbols" className={inputCls} value={f.symbol} onChange={(e) => set('symbol', e.target.value)} placeholder="BONK" autoFocus />
            <datalist id="symbols">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Asset">
            <select className={inputCls} value={f.assetClass} onChange={(e) => set('assetClass', e.target.value as AssetClass)}>
              {ASSETS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="Direction" className="col-span-2 sm:col-span-2">
            <div className="grid grid-cols-2 gap-2">
              {(['long', 'short'] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => set('side', s)}
                  className={cx(
                    'focus-ring rounded-xl border py-2.5 text-sm font-medium capitalize transition',
                    f.side === s ? (s === 'long' ? 'border-profit/40 bg-profit/10 text-profit' : 'border-loss/40 bg-loss/10 text-loss') : 'border-line text-ink-3 hover:text-ink',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Entry time" className="col-span-2">
            <input type="datetime-local" className={inputCls} value={f.entryTime} onChange={(e) => set('entryTime', e.target.value)} />
          </Field>
          <Field label="Exit time" className="col-span-2">
            <input type="datetime-local" className={inputCls} value={f.exitTime} onChange={(e) => set('exitTime', e.target.value)} />
          </Field>
          <Field label="Entry price">
            <input inputMode="decimal" className={inputCls} value={f.entryPrice} onChange={(e) => set('entryPrice', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Exit price">
            <input inputMode="decimal" className={inputCls} value={f.exitPrice} onChange={(e) => set('exitPrice', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Stop loss">
            <input inputMode="decimal" className={inputCls} value={f.stopPrice} onChange={(e) => set('stopPrice', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Quantity">
            <input inputMode="decimal" className={inputCls} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="100" />
          </Field>
          <Field label="Multiplier">
            <input inputMode="decimal" className={inputCls} value={f.multiplier} onChange={(e) => set('multiplier', e.target.value)} />
          </Field>
          <Field label="Fees">
            <input inputMode="decimal" className={inputCls} value={f.fees} onChange={(e) => set('fees', e.target.value)} />
          </Field>
          <Field label="Setup" className="col-span-2">
            <input list="setups" className={inputCls} value={f.setup} onChange={(e) => set('setup', e.target.value)} placeholder="Opening Range Breakout" />
            <datalist id="setups">{setups.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
        )}

        {/* live preview */}
        {!wallet && (
        <motion.div layout className="grid grid-cols-3 gap-3 rounded-2xl border border-line bg-bg-1 p-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Net P&amp;L</div>
            <div className={cx('num mt-1 text-xl font-semibold', calc ? (calc.pnl >= 0 ? 'text-profit' : 'text-loss') : 'text-ink-4')}>{calc ? money(calc.pnl, { sign: true }) : '—'}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Risk</div>
            <div className="num mt-1 text-xl font-semibold text-ink-2">{calc && calc.risk ? money(calc.risk) : '—'}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-3">R-multiple</div>
            <div className={cx('num mt-1 text-xl font-semibold', calc && calc.risk ? (calc.r >= 0 ? 'text-profit' : 'text-loss') : 'text-ink-4')}>{calc && calc.risk ? rFmt(calc.r) : '—'}</div>
          </div>
        </motion.div>
        )}

        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">How did you feel before entering?</div>
          <div className="flex flex-wrap gap-2">
            {EMOTIONS.map((e) => (
              <button
                key={e}
                onClick={() => set('emotion', e)}
                className={cx('focus-ring rounded-full border px-3 py-1.5 text-xs transition', f.emotion === e ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line text-ink-3 hover:text-ink')}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">Mistakes (leave empty if you followed your plan)</div>
          <div className="flex flex-wrap gap-2">
            {MISTAKES.map((m) => {
              const on = f.mistakes.includes(m)
              return (
                <button
                  key={m}
                  onClick={() => set('mistakes', on ? f.mistakes.filter((x) => x !== m) : [...f.mistakes, m])}
                  className={cx('focus-ring rounded-full border px-3 py-1.5 text-xs transition', on ? 'border-loss/40 bg-loss/10 text-loss' : 'border-line text-ink-3 hover:text-ink')}
                >
                  {m}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tags (comma separated)">
            <input className={inputCls} value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="A+ setup, Trend day" />
          </Field>
          <Field label="Execution rating">
            <div className="flex gap-1 py-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => set('rating', n)} className="focus-ring rounded p-0.5">
                  <Star size={24} className={n <= f.rating ? 'fill-gold text-gold' : 'text-ink-4'} />
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field label="Notes & lessons">
          <textarea rows={3} className={inputCls} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="What did you see? What would you do differently?" />
        </Field>

        <div className="flex items-center justify-end gap-3 border-t border-line pt-5">
          <Button onClick={close}>Cancel</Button>
          <Button variant="gold" onClick={submit} disabled={!wallet && (!calc || !f.symbol)}>
            {saved ? (
              <>
                <Check size={16} /> Saved
              </>
            ) : editing ? (
              'Save changes'
            ) : (
              'Add to journal'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
