let currency = 'USD'
export const setCurrency = (c: string) => {
  currency = c
}

const fmtCache = new Map<string, Intl.NumberFormat>()
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat('en-US', opts)
    fmtCache.set(key, f)
  }
  return f
}

export function money(v: number, opts: { sign?: boolean; compact?: boolean; decimals?: number } = {}) {
  if (!isFinite(v)) return '—'
  const { sign = false, compact = false } = opts
  const abs = Math.abs(v)
  if (currency === 'SOL') {
    // SOL is no ISO currency: ◎ and more decimals for small amounts
    const d = opts.decimals ?? (abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4)
    const body = compact && abs >= 1000 ? nf(`sc-${d}`, { notation: 'compact', maximumFractionDigits: 1 }).format(abs) : nf(`s-${d}`, { minimumFractionDigits: d, maximumFractionDigits: d }).format(abs)
    const out = `◎${body}`
    if (v < 0) return `−${out}`
    if (sign && v > 0) return `+${out}`
    return out
  }
  const decimals = opts.decimals ?? (compact ? (abs >= 1e6 ? 2 : abs >= 1e4 ? 1 : 0) : abs < 100 ? 2 : 0)
  const key = `m-${currency}-${compact}-${decimals}`
  const f = nf(key, {
    style: 'currency',
    currency,
    notation: compact && abs >= 1000 ? 'compact' : 'standard',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const s = f.format(abs)
  if (v < 0) return `−${s}`
  if (sign && v > 0) return `+${s}`
  return s
}

export function pct(v: number, decimals = 1, sign = false) {
  if (!isFinite(v)) return '—'
  const s = `${Math.abs(v * 100).toFixed(decimals)}%`
  if (v < 0) return `−${s}`
  if (sign && v > 0) return `+${s}`
  return s
}

export function num(v: number, decimals = 2) {
  if (!isFinite(v)) return '∞'
  return nf(`n-${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)
}

export function rFmt(v: number, decimals = 2, sign = true) {
  if (!isFinite(v)) return '—'
  const s = `${Math.abs(v).toFixed(decimals)}R`
  if (v < 0) return `−${s}`
  if (sign && v > 0) return `+${s}`
  return s
}

export function price(v: number) {
  const abs = Math.abs(v)
  // memecoin "prices" are market caps: $45.2K / ◎312
  if (abs >= 10000) return nf('p-c', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  const d = abs < 2 ? 5 : abs < 100 ? 2 : abs > 10000 ? 0 : 2
  return nf(`p-${d}`, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
}

export function duration(minutes: number) {
  if (!isFinite(minutes)) return '—'
  if (minutes < 1) return `${Math.round(minutes * 60)}s`
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dateShort(iso: string | number | Date) {
  const d = new Date(iso)
  return `${months[d.getMonth()]} ${d.getDate()}`
}
export function dateLong(iso: string | number | Date) {
  const d = new Date(iso)
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
export function monthYear(iso: string | number | Date) {
  const d = new Date(iso)
  return `${months[d.getMonth()]} ${d.getFullYear()}`
}
export function time(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const MONTHS = months

export const tone = (v: number) => (v > 0 ? 'text-profit' : v < 0 ? 'text-loss' : 'text-ink-2')
