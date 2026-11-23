# Aurum — Trading Journal (Sweden edition)

**In Sweden:** the terminal serves this app at `/journal/` (built files in `journal/dist`, committed). Trades are the
user's closed wallet round trips, built by the terminal from the wallet history (`sweden/journal.py`, no extra Helius
calls); the market-cap path, MAE / MFE and "the hour after you sold" come from the recorded pump.fun trades while the
coin is still in memory. Notes, manual trades, settings and the opt-in friends circle are stored per Sweden account
(`data/journal.db`). Rebuild after changing `src/`: `cd journal && npm ci && npm run build`. The original demo data is
still there as a view-only demo (Settings > Data).


A premium, highly interactive trading journal. The important numbers are readable at a glance, and every metric can be drilled into. Weak spots are detected automatically. Progress is made tangible with a **custom-animated dream house that builds itself as your equity grows**.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static build in dist/ (works on any static host / GitHub Pages)
```

Stack: React 19 · TypeScript · Vite · Tailwind CSS v4 · Framer Motion · d3 (scales/shapes only — every chart is hand-built SVG) · Zustand (persisted to localStorage).

---

## What's inside

| Page | Highlights |
| --- | --- |
| **Overview** | Hero net P&L, scrubbable equity + underwater curve with profit-milestone flags, **house card synced to the scrub position**, six KPI tiles (win rate, profit factor, expectancy, payoff, max DD, trader score), daily P&L bars, top-3 weak spots, month calendar, recent trades with mini trade-paths, quote of the day, "almost there" achievements. |
| **Journal** | Day-grouped or sortable table view, full-text search (symbol, setup, tags, emotions, mistakes, notes), winner/loser, plan kept/broken, setup and side filters, live stats for the current selection, CSV import (auto column mapping) and export. Drill-downs from other pages land here. |
| **Trade drawer** | Trade replay chart (entry/stop/target, MAE/MFE marked), execution grid, MFE capture %, psychology (emotion, rules, mistakes, rating), notes, prev/next navigation, edit and delete. |
| **Calendar** | 12-month heatmap, month grid with weekly totals, session recap with an intraday equity curve, weekly report card. |
| **Analytics** | *Statistics*: trader-score radar, 24 metrics (Sharpe, Sortino, SQN, Kelly, recovery factor…), rolling 30-trade win rate and expectancy, monthly returns table. *Setups & symbols*: sortable playbook table, best/worst symbols, long vs short, asset classes, tags. *Timing*: weekday × hour heat grid (avg R / P&L / win %), plus weekday, hour and holding-time bars. *Risk & R*: R distribution, MFE/MAE scatter, size-vs-outcome buckets. *Psychology*: discipline dividend, after-win vs after-loss results, emotions, cost of mistakes, self-rating vs results. Every bar, cell and dot drills into its trades. |
| **Edge Report** | The weak-spot engine (see below), ranked by estimated cost. A **what-if equity curve** lets you toggle leaks off and see the alternate P&L. Also: cost per category, a "rules for next week" pledge list, and strengths to double down on. |
| **Dream House** | A large custom SVG villa (Scandinavian lakeside: black timber, oak annex, sauna, jetty, northern lights at completion). There are 10 construction stages driven by cumulative profit. **Replay my journey** animates the whole history, and you can drag the timeline to travel in time. Drawdowns bring storm clouds, rain and lightning. Also: construction log with the date each stage was reached, projected key-handover date at your recent pace, and "what a better habit is worth". |
| **Achievements** | 29 achievements in 5 tiers (bronze → legendary) with rarity, progress and unlock dates. Levels and XP reward *process* (journaling, discipline, green days) more than profit. Unlock toasts come with confetti. A trading-circle leaderboard ranks by trader score, not P&L size, plus an activity feed with cheers. Share cards (1200×630 PNG via canvas) support native share, download, copy image and copy link. |
| **Settings** | Profile, currency, starting balance, risk rules (max daily loss and max trades per day feed the weak-spot engine), dream goal, CSV/JSON export, reset demo, clear all, shortcuts. |

**Global:** date-range filter (1M → All), ⌘K command palette (search trades, jump to pages, filter by symbol or setup), `N` logs a trade, `P` toggles **privacy mode** (blurs all amounts, for screen-sharing), and a responsive layout with a mobile tab bar. Reduced-motion is respected.

## The weak-spot engine (`src/lib/insights.ts`)

Pure functions over `Trade[]`. Each rule needs a minimum sample size and a material gap to your baseline before it reports anything:

- **Revenge trading**: detected from *timestamps* (re-entry ≤ 15 min after a losing exit), not just tags, including the size increase.
- **Negative-expectancy setups**, **emotional states** (FOMO, bored…), **worst weekday**, **Friday afternoons**, **worst/best hour**.
- **Mistake costs**: each mistake is costed by its own mechanism. Moved stop = loss beyond −1R. Oversized = the extra size. Others = the gap to clean trades.
- **Disposition effect** (holding losers longer than winners), **overtrading** after trade N, **daily-loss-limit breaches**.
- **Winners turned losers** (MFE ≥ 1R that closed red) and **MFE capture** (money left on the table).
- Strengths: A+ setup, golden hour, holding-time sweet spot, calm-state edge, improvement trend.

These are based on what modern journals surface (profit factor, expectancy, R-multiples, MAE/MFE, tilt/revenge detection, emotion tracking).

## Data model & integrating real data

Everything derives from `Trade[]` + `Settings` (`src/data/types.ts`). The demo data is a deterministic ~15-month simulation (`src/data/generate.ts`) of a profitable trader with realistic leaks, so every screen has something to say.

To connect a backend or broker later:

1. Produce `Trade` objects (CSV import already maps common broker export columns).
2. Replace the `trades` source in `src/store/useJournal.ts` (currently localStorage) with your API.
3. Swap `src/data/community.ts` (mock friends and feed) for real social endpoints, and the placeholder share links in `ShareModal`.

```
src/
  data/        types, demo generator, mock community
  lib/         stats, insights (weak spots), achievements/XP, csv, share cards, formatting
  store/       zustand store (persisted) + derived analytics context
  components/  ui primitives, charts (equity, bars, calendar, radar, scatter, heat grid…), house scene, drawers/modals
  pages/       Overview, Journal, Calendar, Analytics, EdgeReport, DreamHouse, Achievements, Settings
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on pushes to `main` (enable Pages → "GitHub Actions" in the repo settings). The app uses hash routing and relative asset paths, so it works from any sub-path.

## Screenshots

| | |
| --- | --- |
| ![Overview](docs/overview.png) | ![Dream house](docs/dream-house.png) |
| ![Edge report](docs/edge-report.png) | ![Analytics](docs/analytics.png) |
| ![Achievements](docs/achievements.png) | |
