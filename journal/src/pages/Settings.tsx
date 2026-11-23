import { useState, type ReactNode } from 'react'
import { Download, RotateCcw, Trash2, Keyboard, Database, User, Shield, House, Eye, Users } from 'lucide-react'
import { useJournal } from '@/store/useJournal'
import { Card, SectionTitle, Button, Modal } from '@/components/ui/primitives'
import { download } from '@/lib/share'
import { toCsv } from '@/lib/csv'

const input = 'focus-ring w-full rounded-xl border border-line bg-bg-1 px-3 py-2.5 text-sm text-ink transition hover:border-line-2'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-4 last:border-0 sm:grid-cols-[1fr_280px] sm:items-center sm:gap-6">
      <div>
        <div className="text-[13.5px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] text-ink-4">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="px-5 py-2 sm:px-6">
      <div className="flex items-center gap-2 border-b border-line py-4 text-[13px] font-medium text-ink-2">
        <span className="text-gold">{icon}</span>
        {title}
      </div>
      {children}
    </Card>
  )
}

export function SettingsPage() {
  const s = useJournal((st) => st.settings)
  const update = useJournal((st) => st.updateSettings)
  const trades = useJournal((st) => st.trades)
  const isDemo = useJournal((st) => st.isDemo)
  const resetDemo = useJournal((st) => st.resetDemo)
  const setDemo = useJournal((st) => st.setDemo)
  const hidden = useJournal((st) => st.hidden)
  const restoreHidden = useJournal((st) => st.restoreHidden)
  const solUsd = useJournal((st) => st.solUsd)
  const clearAll = useJournal((st) => st.clearAll)
  const [confirm, setConfirm] = useState<'reset' | 'clear' | null>(null)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionTitle eyebrow="Make it yours" title="Settings" />

      <Section icon={<User size={15} />} title="Profile">
        <Row label="Display name">
          <input className={input} value={s.traderName} onChange={(e) => update({ traderName: e.target.value })} />
        </Row>
        <Row label="Handle" hint="Used on share cards">
          <input className={input} value={s.handle} onChange={(e) => update({ handle: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() })} />
        </Row>
      </Section>

      <Section icon={<Shield size={15} />} title="Account & risk rules">
        <Row label="Currency" hint={`USD: trades paid in USDC exactly, SOL at today's price ($${solUsd.toFixed(0)}). SOL: in ◎.`}>
          <select className={input} value={s.currency === 'SOL' ? 'SOL' : 'USD'} onChange={(e) => update({ currency: e.target.value })}>
            <option value="USD">USD ($)</option>
            <option value="SOL">SOL (◎)</option>
          </select>
        </Row>
        <Row label="Planned stop loss (%)" hint="1R = this drop from your entry. Used for R-multiples, MAE / MFE and the stop line on each trade.">
          <input type="number" min={5} max={95} className={`${input} num`} value={s.stopPct} onChange={(e) => update({ stopPct: Math.min(95, Math.max(5, +e.target.value || 30)) })} />
        </Row>
        <Row label="Planned take profit (%)" hint="The target line on each trade">
          <input type="number" min={5} className={`${input} num`} value={s.targetPct} onChange={(e) => update({ targetPct: Math.max(5, +e.target.value || 50) })} />
        </Row>
        <Row label="Starting balance" hint="Equity before your first journaled trade">
          <input type="number" className={`${input} num`} value={s.startingBalance} onChange={(e) => update({ startingBalance: +e.target.value || 0 })} />
        </Row>
        <Row label="Max daily loss" hint="Breaches are flagged in the Edge Report">
          <input type="number" className={`${input} num`} value={s.maxDailyLoss} onChange={(e) => update({ maxDailyLoss: Math.max(0, +e.target.value || 0) })} />
        </Row>
        <Row label="Max trades per day" hint="Trades beyond this are analysed for overtrading">
          <input type="number" min={1} className={`${input} num`} value={s.maxTradesPerDay} onChange={(e) => update({ maxTradesPerDay: Math.max(1, +e.target.value || 1) })} />
        </Row>
      </Section>

      <Section icon={<House size={15} />} title="Dream goal">
        <Row label="Goal name">
          <input className={input} value={s.goalName} onChange={(e) => update({ goalName: e.target.value })} />
        </Row>
        <Row label="Net profit required" hint="The house is 100% built at this cumulative profit">
          <input type="number" className={`${input} num`} value={s.goalAmount} onChange={(e) => update({ goalAmount: Math.max(1, +e.target.value || 0) })} />
        </Row>
      </Section>

      <Section icon={<Users size={15} />} title="Trading circle">
        <Row label="Share my score with friends" hint="Others on this terminal who also share see your name, trader score, level, win rate, streak and achievements - never amounts or coins.">
          <label className="flex items-center gap-2 text-sm text-ink-2 sm:justify-self-end">
            <input type="checkbox" checked={!!s.shareCircle} onChange={(e) => update({ shareCircle: e.target.checked })} /> share
          </label>
        </Row>
      </Section>

      <Section icon={<Database size={15} />} title="Data">
        <Row label="Export" hint={`${trades.length} trades · your entries are stored with your Sweden account on the Pi`}>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => download(new Blob([toCsv(trades)], { type: 'text/csv' }), 'aurum-trades.csv')}>
              <Download size={14} /> CSV
            </Button>
            <Button variant="outline" onClick={() => download(new Blob([JSON.stringify({ settings: s, trades }, null, 2)], { type: 'application/json' }), 'aurum-backup.json')}>
              <Download size={14} /> JSON
            </Button>
          </div>
        </Row>
        <Row label="Hidden wallet trades" hint={`${hidden.length} hidden`}>
          <Button variant="outline" onClick={restoreHidden} disabled={!hidden.length}>
            <RotateCcw size={14} /> Show them again
          </Button>
        </Row>
        <Row label="Demo journal" hint={isDemo ? 'You are looking at the demo (nothing is saved)' : 'Look at a made-up trader with 15 months of data (view only)'}>
          <Button variant="outline" onClick={() => setDemo(!isDemo)}>
            <Eye size={14} /> {isDemo ? 'Back to my trades' : 'Show the demo'}
          </Button>
        </Row>
        <Row label="Start fresh" hint="Hide every wallet trade and delete the trades logged by hand">
          <Button variant="danger" onClick={() => setConfirm('clear')}>
            <Trash2 size={14} /> Clear all trades
          </Button>
        </Row>
      </Section>

      <Section icon={<Keyboard size={15} />} title="Keyboard shortcuts">
        {[
          ['⌘ K / Ctrl K', 'Command palette & search'],
          ['N', 'Log a new trade'],
          ['P', 'Toggle privacy mode (blur amounts)'],
          ['Esc', 'Close dialogs and drawers'],
        ].map(([k, d]) => (
          <Row key={k} label={d}>
            <kbd className="justify-self-start rounded-lg border border-line bg-bg-2 px-2.5 py-1 font-mono text-xs text-ink-2 sm:justify-self-end">{k}</kbd>
          </Row>
        ))}
      </Section>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'reset' ? 'Show the demo?' : 'Clear all trades?'} width={460}>
        <div className="space-y-5 p-6 text-sm text-ink-2">
          <p>{confirm === 'reset' ? 'Shows the generated demo journal (view only).' : 'Wallet trades are hidden (they can be shown again), hand-logged trades are deleted. Export first if you want a backup.'}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => (confirm === 'reset' ? resetDemo() : clearAll(), setConfirm(null))}>
              {confirm === 'reset' ? 'Reset' : 'Clear everything'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
