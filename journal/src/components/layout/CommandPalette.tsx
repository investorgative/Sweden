import { AnimatePresence, motion } from 'framer-motion'
import { Search, CornerDownLeft, Plus, Eye } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAnalytics } from '@/store/analytics'
import { useJournal } from '@/store/useJournal'
import { useUI } from '@/store/useUI'
import { NAV } from './Layout'
import { cx } from '@/components/ui/primitives'
import { dateShort, money, rFmt } from '@/lib/format'
import { rOf } from '@/lib/stats'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  right?: string
  tone?: 'profit' | 'loss'
  run: () => void
}

export function CommandPalette({ open, onClose, onNewTrade }: { open: boolean; onClose: () => void; onNewTrade: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const nav = useNavigate()
  const { all } = useAnalytics()
  const openTrade = useUI((s) => s.openTrade)
  const togglePrivacy = useJournal((s) => s.togglePrivacy)
  const setFilters = useJournal((s) => s.setFilters)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const ql = q.toLowerCase().trim()
    const pages: Item[] = NAV.map((n) => ({ id: n.to, group: 'Go to', label: n.label, run: () => nav(n.to) }))
    pages.push({ id: '/settings', group: 'Go to', label: 'Settings', run: () => nav('/settings') })
    const actions: Item[] = [
      { id: 'new', group: 'Actions', label: 'Log a new trade', hint: 'N', run: onNewTrade },
      { id: 'privacy', group: 'Actions', label: 'Toggle privacy mode', hint: 'P', run: togglePrivacy },
    ]
    const symbols = [...new Set(all.map((t) => t.symbol))]
    const setups = [...new Set(all.map((t) => t.setup))]
    const filt = (s: string) => !ql || s.toLowerCase().includes(ql)
    const filterItems: Item[] = [
      ...symbols.filter(filt).map((s) => ({ id: `sym-${s}`, group: 'Filter by symbol', label: s, run: () => (setFilters({ symbols: [s] }), nav('/journal')) })),
      ...setups.filter(filt).map((s) => ({ id: `set-${s}`, group: 'Filter by setup', label: s, run: () => (setFilters({ setups: [s] }), nav('/analytics')) })),
    ]
    const trades: Item[] = ql
      ? all
          .filter((t) => t.symbol.toLowerCase().includes(ql) || t.setup.toLowerCase().includes(ql) || t.notes.toLowerCase().includes(ql) || t.id.toLowerCase() === ql)
          .slice(-8)
          .reverse()
          .map((t) => ({
            id: t.id,
            group: 'Trades',
            label: `${t.symbol} · ${t.side} · ${t.setup}`,
            hint: dateShort(t.exitTime),
            right: `${money(t.pnl, { sign: true })}  ${rFmt(rOf(t), 1)}`,
            tone: t.pnl >= 0 ? 'profit' : 'loss',
            run: () => openTrade(t.id),
          }))
      : []
    return [...actions.filter((a) => filt(a.label)), ...pages.filter((p) => filt(p.label)), ...trades, ...(ql ? filterItems.slice(0, 6) : [])]
  }, [q, all, nav, onNewTrade, togglePrivacy, setFilters, openTrade])

  useEffect(() => setSel(0), [q])

  const run = (it: Item) => {
    onClose()
    it.run()
  }

  let lastGroup = ''
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
          <motion.div
            initial={{ y: -12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -8, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            className="card relative w-full max-w-[620px] overflow-hidden bg-bg-2"
          >
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <Search size={18} className="text-gold" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)))
                  if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
                  if (e.key === 'Enter' && items[sel]) run(items[sel])
                  if (e.key === 'Escape') onClose()
                }}
                placeholder="Search trades, symbols, setups, notes or pages…"
                className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4"
              />
              <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-3">ESC</kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {items.length === 0 && <div className="p-8 text-center text-sm text-ink-3">Nothing found for “{q}”.</div>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null
                lastGroup = it.group
                return (
                  <div key={it.id}>
                    {header && <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-4">{header}</div>}
                    <button
                      onMouseEnter={() => setSel(i)}
                      onClick={() => run(it)}
                      className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors', sel === i ? 'bg-white/[0.06] text-ink' : 'text-ink-2')}
                    >
                      {it.id === 'new' ? <Plus size={15} className="text-gold" /> : it.id === 'privacy' ? <Eye size={15} className="text-gold" /> : <span className="h-1.5 w-1.5 rounded-full bg-ink-4" />}
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.hint && <span className="text-[11px] text-ink-4">{it.hint}</span>}
                      {it.right && <span className={cx('num text-xs', it.tone === 'profit' ? 'text-profit' : 'text-loss')}>{it.right}</span>}
                      {sel === i && <CornerDownLeft size={13} className="text-ink-3" />}
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
