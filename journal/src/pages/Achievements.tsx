import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Share2, UserPlus, Users, Crown, Flame, Check, Sparkles } from 'lucide-react'
import { useAnalytics } from '@/store/analytics'
import { useJournal, useSettings } from '@/store/useJournal'
import { api, type CircleRow } from '@/lib/sweden'
import { Card, CardHeader, Segmented, SectionTitle, Bar, Ring, cx, Button, Pill } from '@/components/ui/primitives'
import { Badge } from '@/components/Badge'
import { ShareModal } from '@/components/ShareModal'
import { TIER_META, LEVELS, type AchievementState } from '@/lib/achievements'
import { dateLong, dateShort, money, pct } from '@/lib/format'
import { traderScore } from '@/lib/stats'

type Filter = 'all' | 'unlocked' | 'locked'
const CATS = ['All', 'Profit', 'Consistency', 'Discipline', 'Skill', 'Journey'] as const
const hueOf = (name: string) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)

function Avatar({ name, hue, size = 36, src }: { name: string; hue: number; size?: number; src?: string }) {
  if (src) return <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  const ini = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
  return (
    <div className="grid shrink-0 place-items-center rounded-full font-semibold text-bg-0" style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 60% 75%), hsl(${hue} 45% 52%))` }}>
      {ini}
    </div>
  )
}

export function Achievements() {
  const { lifetime } = useAnalytics()
  const settings = useSettings()
  const [filter, setFilter] = useState<Filter>('all')
  const [cat, setCat] = useState<(typeof CATS)[number]>('All')
  const [shareA, setShareA] = useState<AchievementState | null>(null)
  const [shareProfile, setShareProfile] = useState(false)
  const [circle, setCircle] = useState<CircleRow[]>([])
  const isDemo = useJournal((s) => s.isDemo)
  useEffect(() => {
    if (isDemo) return
    api.circle().then((r) => setCircle(r.circle)).catch(() => {})
  }, [isDemo, settings.shareCircle])
  const badgeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const all = lifetime.achievements
  const unlocked = all.filter((a) => a.unlocked)
  const xp = lifetime.xp
  const shown = all
    .filter((a) => (filter === 'all' ? true : filter === 'unlocked' ? a.unlocked : !a.unlocked))
    .filter((a) => cat === 'All' || a.category === cat)
    .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || (b.unlocked ? (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? '') : b.progress - a.progress))
  const rarest = [...unlocked].sort((a, b) => a.rarity - b.rarity)[0]
  const score = traderScore(lifetime.summary).score

  const board = useMemo(() => {
    const meRow = circle.find((c) => c.me)
    const me = { name: `${settings.traderName || 'You'} (you)`, src: meRow?.avatar || undefined, handle: 'me', hue: 42, level: xp.level.level, title: xp.level.title, score, winRate: lifetime.summary.winRate, consistency: lifetime.summary.dayWinRate, streak: Math.max(0, lifetime.summary.currentStreak), me: true }
    const others = circle.filter((c) => !c.me).map((c) => ({ name: c.name, src: c.avatar || undefined, handle: `u-${c.name}`, hue: hueOf(c.name), level: c.level, title: c.title, score: c.score, winRate: c.winRate, consistency: c.consistency ?? 0, streak: c.streak, me: false }))
    return [...others, me].sort((a, b) => b.score - a.score)
  }, [settings, xp, score, lifetime.summary, circle])
  const feed = useMemo(
    () =>
      circle
        .filter((c) => !c.me)
        .flatMap((c) => (c.achievements || []).map((a) => ({ who: c.name, src: c.avatar || undefined, hue: hueOf(c.name), ...a })))
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .slice(0, 12),
    [circle],
  )

  const shareInput = useMemo(() => {
    if (!shareA) return null
    const svg = badgeRefs.current[shareA.id]?.querySelector('svg') ?? null
    return {
      eyebrow: `Achievement unlocked · ${TIER_META[shareA.tier].label}`,
      title: shareA.name,
      subtitle: shareA.description,
      accent: TIER_META[shareA.tier].color,
      stats: [
        { label: 'Unlocked', value: shareA.unlockedAt ? dateLong(shareA.unlockedAt + 'T12:00') : '—' },
        { label: 'Rarity', value: `${shareA.rarity}%`, tone: 'gold' as const },
        { label: 'Level', value: String(xp.level.level) },
      ],
      svg,
    }
  }, [shareA, xp.level.level])

  const profileInput = useMemo(
    () => ({
      eyebrow: `Level ${xp.level.level} · ${xp.level.title}`,
      title: `${unlocked.length} achievements and counting`,
      subtitle: `Trader score ${score}/100 · ${pct(lifetime.summary.planAdherence, 0)} plan adherence`,
      stats: [
        { label: 'Win rate', value: pct(lifetime.summary.winRate, 0) },
        { label: 'Profit factor', value: lifetime.summary.profitFactor.toFixed(2), tone: 'gold' as const },
        { label: 'Green days', value: pct(lifetime.summary.dayWinRate, 0), tone: 'profit' as const },
      ],
    }),
    [xp, unlocked.length, score, lifetime.summary],
  )

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Progress worth celebrating"
        title={
          <>
            Achievements <span className="italic text-ink-3">&amp;</span> <span className="italic gold-text">community</span>
          </>
        }
        right={
          <Button variant="gold" onClick={() => setShareProfile(true)}>
            <Share2 size={14} /> Share my profile
          </Button>
        }
      >
        XP rewards process over profit: journaling, following your plan and green days all count. Share milestones with your trading circle and cheer theirs.
      </SectionTitle>

      {/* ── level hero */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="relative overflow-hidden p-6 sm:p-8 lg:col-span-7">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-gold/10 blur-3xl" />
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <Ring value={xp.progress} size={150} stroke={8}>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-[0.2em] text-ink-3">Level</div>
                <div className="font-display text-6xl leading-none gold-text">{xp.level.level}</div>
              </div>
            </Ring>
            <div className="flex-1">
              <div className="font-display text-4xl">{xp.level.title}</div>
              <div className="num mt-1 text-sm text-ink-3">
                {xp.xp.toLocaleString()} XP {xp.next && <>· {(xp.next.xp - xp.xp).toLocaleString()} to {xp.next.title}</>}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(xp.sources).map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-white/[0.015] p-3">
                    <div className="text-[10px] capitalize text-ink-4">{k}</div>
                    <div className="num text-sm font-semibold">{v.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="no-scrollbar mt-7 flex gap-1.5 overflow-x-auto">
            {LEVELS.map((l) => (
              <div key={l.level} className="min-w-[64px] flex-1">
                <div className={cx('h-1.5 rounded-full', l.level <= xp.level.level ? 'bg-gradient-to-r from-gold-3 to-gold' : 'bg-white/[0.06]')} />
                <div className={cx('mt-1.5 truncate text-[9.5px]', l.level === xp.level.level ? 'text-gold' : 'text-ink-4')}>{l.title}</div>
              </div>
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-5">
          <Card className="p-5">
            <div className="text-[12px] text-ink-3">Unlocked</div>
            <div className="mt-2 font-display text-5xl">
              {unlocked.length}
              <span className="text-2xl text-ink-4">/{all.length}</span>
            </div>
            <Bar value={unlocked.length / all.length} className="mt-3" height={4} />
          </Card>
          <Card className="p-5">
            <div className="text-[12px] text-ink-3">Rarest badge</div>
            {rarest ? (
              <div className="mt-2 flex items-center gap-3">
                <Badge tier={rarest.tier} icon={rarest.icon} unlocked size={48} shine={false} />
                <div>
                  <div className="text-sm font-medium leading-tight">{rarest.name}</div>
                  <div className="text-[11px] text-ink-4">{rarest.rarity}% of traders</div>
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-ink-4">None yet</div>
            )}
          </Card>
          <Card className="col-span-2 p-5">
            <div className="text-[12px] text-ink-3">By tier</div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {(Object.keys(TIER_META) as (keyof typeof TIER_META)[]).map((t) => {
                const tot = all.filter((a) => a.tier === t).length
                const got = unlocked.filter((a) => a.tier === t).length
                return (
                  <div key={t} className="text-center">
                    <div className="num font-display text-2xl" style={{ color: TIER_META[t].color }}>
                      {got}
                      <span className="text-sm text-ink-4">/{tot}</span>
                    </div>
                    <div className="text-[10px] text-ink-4">{TIER_META[t].label}</div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* ── filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar overflow-x-auto">
          <Segmented layoutId="ach-cat" size="sm" value={cat} onChange={setCat} options={CATS.map((c) => ({ value: c, label: c }))} />
        </div>
        <Segmented layoutId="ach-filter" size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unlocked', label: 'Unlocked' }, { value: 'locked', label: 'In progress' }]} />
      </div>

      {/* ── grid */}
      <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <AnimatePresence mode="popLayout">
          {shown.map((a, i) => (
            <motion.div key={a.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.35, delay: Math.min(0.3, i * 0.02) }}>
              <Card noAnim className={cx('group h-full p-5', a.unlocked && 'hover:border-gold/25')} style={a.unlocked ? { boxShadow: `0 20px 50px -30px ${TIER_META[a.tier].glow}` } : undefined}>
                <div className="flex items-start justify-between">
                  <div ref={(el) => void (badgeRefs.current[a.id] = el)}>
                    <Badge tier={a.tier} icon={a.icon} unlocked={a.unlocked} progress={a.progress} size={68} />
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: a.unlocked ? TIER_META[a.tier].color : '#6f6c66' }}>
                      {TIER_META[a.tier].label}
                    </div>
                    <div className="text-[10.5px] text-ink-4">{a.rarity}% own this</div>
                  </div>
                </div>
                <div className="mt-4 text-[15px] font-medium">{a.name}</div>
                <div className="mt-1 min-h-[34px] text-[12px] leading-snug text-ink-3">{a.description}</div>
                {a.unlocked ? (
                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                    <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                      <Check size={12} className="text-profit" /> {a.unlockedAt ? dateLong(a.unlockedAt + 'T12:00') : 'Unlocked'}
                    </span>
                    <button onClick={() => setShareA(a)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-ink-3 transition hover:bg-gold/10 hover:text-gold">
                      <Share2 size={12} /> Share
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-line pt-3">
                    <Bar value={a.progress} height={4} />
                    <div className="num mt-1.5 flex justify-between text-[10.5px] text-ink-4">
                      <span>{a.target >= 1000 ? `${money(a.current, { compact: true })} / ${money(a.target, { compact: true })}` : `${Math.floor(a.current)} / ${a.target}`}</span>
                      <span>+{TIER_META[a.tier].xp} XP</span>
                    </div>
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {/* ── community */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader
            icon={<Users size={15} />}
            title="Your trading circle"
            subtitle={settings.shareCircle ? 'Your friends who share their score - ranked by trader score, never amounts' : 'Turn on "Share my score" in Settings to appear here and see your friends'}
            right={
              <a href="../#friends" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-gold/40">
                <UserPlus size={13} /> Add friends
              </a>
            }
          />
          <div className="p-3 sm:p-4">
            {board.map((f, i) => (
              <motion.div key={f.handle} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className={cx('flex items-center gap-3 rounded-2xl px-3 py-3', f.me && 'border border-gold/25 bg-gold/[0.06]')}>
                <span className={cx('w-6 text-center font-display text-xl', i === 0 ? 'text-gold' : 'text-ink-4')}>{i === 0 ? <Crown size={16} className="mx-auto" /> : i + 1}</span>
                <Avatar name={f.name} hue={f.hue} src={f.src} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{f.name}</div>
                  <div className="text-[11px] text-ink-4">
                    Lv {f.level} · {f.title}
                  </div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="num text-[12px] text-ink-2">{pct(f.winRate, 0)}</div>
                  <div className="text-[10px] text-ink-4">win rate</div>
                </div>
                <div className="hidden w-16 text-right sm:block">
                  <div className="num text-[12px] text-ink-2">{pct(f.consistency, 0)}</div>
                  <div className="text-[10px] text-ink-4">green days</div>
                </div>
                {f.streak > 2 && (
                  <Pill tone="gold" className="hidden md:inline-flex">
                    <Flame size={11} /> {f.streak}
                  </Pill>
                )}
                <div className="w-12 text-right">
                  <div className="num font-display text-2xl leading-none">{f.score}</div>
                  <div className="text-[9.5px] text-ink-4">score</div>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-5">
          <CardHeader icon={<Sparkles size={15} />} title="Activity" subtitle="Recent unlocks in your circle" />
          <div className="space-y-1 p-3 sm:p-4">
            {!feed.length && <div className="px-3 py-6 text-center text-[12.5px] text-ink-4">Nothing yet - unlocks of friends who share show up here.</div>}
            {feed.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-white/[0.02]">
                <Avatar name={f.who} hue={f.hue} size={32} src={f.src} />
                <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
                  <span className="font-medium">{f.who.split(' ')[0]}</span> <span className="text-ink-3">unlocked</span> <span style={{ color: TIER_META[f.tier as keyof typeof TIER_META]?.color }}>{f.name}</span>
                  <div className="text-[10.5px] text-ink-4">{f.at ? dateShort(f.at) : ''}</div>
                </div>
                <Badge tier={f.tier as never} icon={f.icon} unlocked size={34} shine={false} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <ShareModal open={!!shareA} onClose={() => setShareA(null)} input={shareInput} slug={shareA?.id ?? 'achievement'} />
      <ShareModal open={shareProfile} onClose={() => setShareProfile(false)} input={shareProfile ? profileInput : null} slug="profile" />
    </div>
  )
}
