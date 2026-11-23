import { animate, AnimatePresence, motion, useInView } from 'framer-motion'
import { X, Info } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useJournal } from '@/store/useJournal'
import { money } from '@/lib/format'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

// ───────────────────────── Card with cursor spotlight
export function Card({
  children,
  className,
  style,
  delay = 0,
  as = 'div',
  onClick,
  noAnim,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  delay?: number
  as?: 'div' | 'section' | 'button'
  onClick?: () => void
  noAnim?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = (e: MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  const Comp = motion[as] as typeof motion.div
  return (
    <Comp
      ref={ref}
      onMouseMove={onMove}
      onClick={onClick}
      initial={noAnim ? false : { opacity: 0, y: 14, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cx('card card-hover spotlight', onClick && 'cursor-pointer text-left', className)}
      style={style}
    >
      {children}
    </Comp>
  )
}

export function CardHeader({ title, subtitle, right, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink-2">
          {icon && <span className="text-gold">{icon}</span>}
          {title}
        </div>
        {subtitle && <div className="mt-1 text-xs text-ink-3">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

// ───────────────────────── Numbers
export function AnimatedNumber({ value, format, className, duration = 1.1 }: { value: number; format: (v: number) => string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(0)
  const inView = useInView(ref, { once: true })
  useEffect(() => {
    if (!inView) return
    const from = prev.current
    const ctrl = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v)
      },
    })
    prev.current = value
    return () => ctrl.stop()
  }, [value, inView, format, duration])
  return (
    <span ref={ref} className={cx('num', className)}>
      {format(0)}
    </span>
  )
}

export function usePrivacy() {
  return useJournal((s) => s.settings.privacy)
}

export function Money({ value, sign, compact, className, animated, colored }: { value: number; sign?: boolean; compact?: boolean; className?: string; animated?: boolean; colored?: boolean }) {
  const privacy = usePrivacy()
  const color = colored ? (value > 0 ? 'text-profit' : value < 0 ? 'text-loss' : 'text-ink-2') : ''
  if (privacy) return <span className={cx('num privacy-blur', color, className)}>{money(Math.round(value / 1000) * 1000 || 1234, { sign, compact })}</span>
  if (animated) return <AnimatedNumber value={value} format={(v) => money(v, { sign, compact })} className={cx(color, className)} />
  return <span className={cx('num', color, className)}>{money(value, { sign, compact })}</span>
}

export function Delta({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const pos = value >= 0
  return (
    <span
      className={cx(
        'num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        pos ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss',
        className,
      )}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" className={pos ? '' : 'rotate-180'}>
        <path d="M4 1 7 6H1z" fill="currentColor" />
      </svg>
      {format(Math.abs(value))}
    </span>
  )
}

// ───────────────────────── Controls
export function Segmented<T extends string>({ options, value, onChange, size = 'md', layoutId }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md'; layoutId: string }) {
  return (
    <div className="relative inline-flex rounded-full border border-line bg-bg-1/80 p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'focus-ring relative z-10 rounded-full font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs',
              active ? 'text-bg-0' : 'text-ink-2 hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-b from-[#f2dcae] to-gold-2 shadow-[0_4px_20px_-4px_rgba(227,196,141,.5)]"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Button({ children, onClick, variant = 'ghost', className, type = 'button', disabled, title }: { children: ReactNode; onClick?: () => void; variant?: 'gold' | 'ghost' | 'outline' | 'danger'; className?: string; type?: 'button' | 'submit'; disabled?: boolean; title?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cx(
        'focus-ring relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full px-4 py-2 text-[13px] font-medium transition-all disabled:opacity-40',
        variant === 'gold' && 'bg-gradient-to-b from-[#f4dfb4] to-[#c9a466] text-[#1a1408] shadow-[0_8px_30px_-8px_rgba(227,196,141,.55),inset_0_1px_0_rgba(255,255,255,.5)] hover:brightness-110',
        variant === 'ghost' && 'text-ink-2 hover:bg-white/5 hover:text-ink',
        variant === 'outline' && 'border border-line-2 bg-white/[0.02] text-ink hover:border-gold/40 hover:bg-white/[0.04]',
        variant === 'danger' && 'border border-loss/30 bg-loss/10 text-loss hover:bg-loss/20',
        className,
      )}
    >
      {variant === 'gold' && <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />}
      {children}
    </motion.button>
  )
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'profit' | 'loss' | 'gold' | 'info' | 'violet'; className?: string }) {
  const tones: Record<string, string> = {
    neutral: 'bg-white/[0.05] text-ink-2 border-line',
    profit: 'bg-profit/10 text-profit border-profit/20',
    loss: 'bg-loss/10 text-loss border-loss/20',
    gold: 'bg-gold/10 text-gold border-gold/25',
    info: 'bg-info/10 text-info border-info/20',
    violet: 'bg-violet/10 text-violet border-violet/20',
  }
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>
}

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Info size={12} className="cursor-help text-ink-3 hover:text-ink-2" />
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-xl border border-line-2 bg-bg-3 p-3 text-[11px] font-normal leading-relaxed tracking-normal text-ink-2 shadow-2xl"
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

// ───────────────────────── Ring gauge
export function Ring({ value, size = 64, stroke = 6, color = 'var(--color-gold)', track = 'rgba(255,255,255,.06)', children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

// ───────────────────────── Progress bar
export function Bar({ value, color = 'gold', className, height = 6 }: { value: number; color?: 'gold' | 'profit' | 'loss' | 'violet' | 'info'; className?: string; height?: number }) {
  const bg: Record<string, string> = {
    gold: 'from-gold-3 via-gold to-[#f6e3bb]',
    profit: 'from-profit-2 to-profit',
    loss: 'from-loss-2 to-loss',
    violet: 'from-[#7b5cc7] to-violet',
    info: 'from-[#4b6fb8] to-info',
  }
  return (
    <div className={cx('overflow-hidden rounded-full bg-white/[0.06]', className)} style={{ height }}>
      <motion.div
        className={cx('h-full rounded-full bg-gradient-to-r', bg[color])}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      />
    </div>
  )
}

// ───────────────────────── Overlays
export function Modal({ open, onClose, children, width = 560, title }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; title?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="card relative max-h-[92vh] w-full overflow-y-auto rounded-b-none bg-bg-2 sm:rounded-[24px]"
            style={{ maxWidth: width }}
          >
            {title && (
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg-2/90 px-6 py-4 backdrop-blur">
                <div className="font-display text-2xl">{title}</div>
                <button onClick={onClose} className="focus-ring rounded-full p-2 text-ink-3 hover:bg-white/5 hover:text-ink">
                  <X size={18} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function Drawer({ open, onClose, children, width = 620 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 36 }}
            className="absolute right-0 top-0 h-full w-full overflow-y-auto border-l border-line bg-bg-1 shadow-2xl"
            style={{ maxWidth: width }}
          >
            {children}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function SectionTitle({ eyebrow, title, right, children }: { eyebrow?: string; title: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold/80">{eyebrow}</div>}
        <h1 className="font-display text-[40px] leading-[1] tracking-tight sm:text-[54px]">{title}</h1>
        {children && <div className="mt-3 max-w-2xl text-sm text-ink-2">{children}</div>}
      </div>
      {right}
    </div>
  )
}

export function Empty({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/[0.03] text-gold">{icon}</div>
      <div className="font-display text-2xl">{title}</div>
      {text && <div className="mt-2 max-w-sm text-sm text-ink-3">{text}</div>}
    </div>
  )
}

export function StatLine({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-3 py-2.5 text-[13px]', className)}>
      <span className="flex items-center gap-1.5 text-ink-3">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      <span className="num font-medium text-ink">{value}</span>
    </div>
  )
}
