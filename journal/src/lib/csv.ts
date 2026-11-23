import type { AssetClass, Emotion, Mistake, Side, Trade } from '@/data/types'

const COLUMNS: (keyof Trade)[] = ['id', 'symbol', 'assetClass', 'side', 'entryTime', 'exitTime', 'entryPrice', 'exitPrice', 'stopPrice', 'targetPrice', 'quantity', 'multiplier', 'fees', 'pnl', 'risk', 'mae', 'mfe', 'setup', 'tags', 'mistakes', 'emotion', 'rating', 'followedPlan', 'notes']

const esc = (v: unknown) => {
  const s = Array.isArray(v) ? v.join('|') : v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(trades: Trade[]) {
  return [COLUMNS.join(','), ...trades.map((t) => COLUMNS.map((c) => esc(t[c])).join(','))].join('\n')
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  row.push(cur)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

const ALIASES: Record<string, string[]> = {
  symbol: ['symbol', 'ticker', 'instrument', 'market', 'contract'],
  side: ['side', 'direction', 'type', 'action', 'buy/sell'],
  entryTime: ['entrytime', 'entry time', 'entry date', 'open time', 'opened', 'open date', 'date', 'datetime', 'time'],
  exitTime: ['exittime', 'exit time', 'exit date', 'close time', 'closed', 'close date'],
  entryPrice: ['entryprice', 'entry price', 'entry', 'open price', 'avg entry', 'buy price'],
  exitPrice: ['exitprice', 'exit price', 'exit', 'close price', 'avg exit', 'sell price'],
  stopPrice: ['stopprice', 'stop', 'stop loss', 'sl', 'stop price'],
  targetPrice: ['targetprice', 'target', 'take profit', 'tp'],
  quantity: ['quantity', 'qty', 'size', 'shares', 'contracts', 'volume', 'lots'],
  multiplier: ['multiplier', 'point value', 'contract size'],
  fees: ['fees', 'commission', 'commissions', 'fee'],
  pnl: ['pnl', 'p&l', 'net p&l', 'profit', 'net profit', 'realized p&l', 'net pnl', 'profit/loss'],
  setup: ['setup', 'strategy', 'playbook'],
  notes: ['notes', 'note', 'comment', 'comments'],
  tags: ['tags', 'tag'],
  mistakes: ['mistakes', 'mistake'],
  emotion: ['emotion', 'mood', 'feeling'],
  assetClass: ['assetclass', 'asset class', 'asset', 'instrument type'],
  rating: ['rating', 'grade'],
  mae: ['mae'],
  mfe: ['mfe'],
  risk: ['risk'],
}

export function fromCsv(text: string): { trades: Trade[]; errors: string[] } {
  const rows = parseRows(text.trim())
  if (rows.length < 2) return { trades: [], errors: ['File has no data rows.'] }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col: Record<string, number> = {}
  for (const [k, al] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => al.includes(h) || h === k.toLowerCase())
    if (i >= 0) col[k] = i
  }
  const errors: string[] = []
  if (col.symbol == null) errors.push('Missing a symbol/ticker column.')
  if (col.entryTime == null) errors.push('Missing an entry date/time column.')
  if (errors.length) return { trades: [], errors }

  const get = (r: string[], k: string) => (col[k] != null ? (r[col[k]] ?? '').trim() : '')
  const numv = (s: string) => {
    const v = parseFloat(s.replace(/[$€£,\s]/g, '').replace(/^\((.*)\)$/, '-$1'))
    return isFinite(v) ? v : NaN
  }
  const iso = (s: string) => {
    const d = new Date(s)
    if (isNaN(d.getTime())) return ''
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  const trades: Trade[] = []
  rows.slice(1).forEach((r, n) => {
    const symbol = get(r, 'symbol').toUpperCase()
    const entryTime = iso(get(r, 'entryTime'))
    if (!symbol || !entryTime) {
      errors.push(`Row ${n + 2}: missing symbol or date — skipped.`)
      return
    }
    const exitTime = iso(get(r, 'exitTime')) || entryTime
    const sideRaw = get(r, 'side').toLowerCase()
    const side: Side = /sell|short|^s$/.test(sideRaw) ? 'short' : 'long'
    const entryPrice = numv(get(r, 'entryPrice'))
    const exitPrice = numv(get(r, 'exitPrice'))
    const quantity = Math.abs(numv(get(r, 'quantity'))) || 1
    const multiplier = numv(get(r, 'multiplier')) || 1
    const fees = Math.abs(numv(get(r, 'fees'))) || 0
    const dir = side === 'long' ? 1 : -1
    let pnl = numv(get(r, 'pnl'))
    if (!isFinite(pnl)) pnl = isFinite(entryPrice) && isFinite(exitPrice) ? (exitPrice - entryPrice) * dir * quantity * multiplier - fees : 0
    const stopPrice = numv(get(r, 'stopPrice'))
    let risk = numv(get(r, 'risk'))
    if (!isFinite(risk)) risk = isFinite(stopPrice) && isFinite(entryPrice) ? Math.abs(entryPrice - stopPrice) * quantity * multiplier : 0
    const rr = risk ? pnl / risk : 0
    const mistakes = get(r, 'mistakes').split(/[|;]/).map((s) => s.trim()).filter(Boolean) as Mistake[]
    trades.push({
      id: get(r, 'id') || `I${Date.now().toString(36)}${n}`,
      symbol,
      assetClass: (get(r, 'assetClass') as AssetClass) || 'Stocks',
      side,
      entryTime,
      exitTime,
      entryPrice: isFinite(entryPrice) ? entryPrice : 0,
      exitPrice: isFinite(exitPrice) ? exitPrice : 0,
      stopPrice: isFinite(stopPrice) ? stopPrice : isFinite(entryPrice) ? entryPrice : 0,
      targetPrice: isFinite(numv(get(r, 'targetPrice'))) ? numv(get(r, 'targetPrice')) : undefined,
      quantity,
      multiplier,
      fees,
      pnl: +pnl.toFixed(2),
      risk: +risk.toFixed(2),
      mae: isFinite(numv(get(r, 'mae'))) ? numv(get(r, 'mae')) : Math.min(0, rr),
      mfe: isFinite(numv(get(r, 'mfe'))) ? numv(get(r, 'mfe')) : Math.max(0, rr),
      setup: get(r, 'setup') || 'Unlabeled',
      tags: get(r, 'tags').split(/[|;]/).map((s) => s.trim()).filter(Boolean),
      mistakes,
      emotion: (get(r, 'emotion') as Emotion) || 'Calm',
      rating: Math.min(5, Math.max(1, Math.round(numv(get(r, 'rating')) || 3))),
      followedPlan: mistakes.length === 0,
      notes: get(r, 'notes'),
    })
  })
  return { trades, errors }
}
