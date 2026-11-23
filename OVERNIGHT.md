# Overnight work, 23 Nov 2026 (not deployed, not on GitHub)

Everything is on the local branch `overnight-2026-11-23` in the worktree `~/sweden-overnight`. The running terminal
(`~/sweden`) and GitHub are untouched. Nothing here is live until you say so.

To deploy (after your OK): merge the branch into `~/sweden`, restart only the terminal program (the link stays), push.

## Urgent: bugs that are also in the LIVE terminal

1. **A big bot wallet can crash the terminal (and stress the whole Pi).** The wallet code asks Helius for all token
   accounts of a wallet with full details. For a bot wallet with tens of thousands of token accounts that answer was
   over 2 GB; a test terminal grew to 5.5 GB and was killed by the kernel (journald was hit too). Your own wallet is
   fine. Fix: a lean query (72 bytes per token account), a hard 64 MB cap on any answer, a 30-min back-off for such
   wallets (they show "answer too large").
2. **Race condition in the page:** an older update arriving after a newer one overwrote it (e.g. snooze / watchlist
   seemed not to stick until the next refresh). Fix: updates are numbered, late old answers are dropped.
3. **Wallet credits:** new wallet transactions were parsed with Helius' "Enhanced Transactions" API = 100 credits per
   call (and in maintenance mode). Now `getTransaction` (1 credit) with the same result (checked on 20 of 20 tx).
4. `check_feed.py` was broken since the PumpSwap merge (import error). Fixed.

## New features

### Signal tracker (page "Signals", key S)
Every time a coin becomes recommended or reaches the entry signal for you, the moment and the mcap are recorded
(whether or not that alert is on). Afterwards: best / worst move, now, and for ±25 / 35 / 50 % whether up or down came
first. Summary cards + table + CSV. An honest live forward test of your settings (raw mcap moves, no fees / delay).
Second view: **Top wallets (24 h)** - wallets with the most realized profit across the coins in memory (pump.fun's
Mayhem agent left out, bots marked). Information only: in our tests copying such wallets did not work.

### "Test" button in Settings
Replays your current (even unsaved) filter and dip settings over the graduates still in memory (~6.5 h): how many
recommendations / entries they would have given and how those moved. Example tonight: your filter -> 0 signals in
6.5 h; a very loose filter -> 13 recommendations with median best +94 % but median worst -96 % and median end -96 %.

### Coin page
- **Top traders** tab: per wallet bought / sold / still holds / profit (what is still held is valued at what selling it
  now would return, not at the last price - a dev with 79 % of supply showed +◎83,717 before that fix).
- **Dev history** tab: the dev's other launches in the last 72 h, graduated or not, ATH.
- **Buy / sell pressure** 1 / 5 / 15 min: SOL in vs out, buyers vs sellers.
- **Your position** (from your wallet): holding, average entry mcap, since entry; on the chart a "your entry" line and
  B / S markers for your trades; on the card a badge "◎ You hold $123 · +23 %".
- **Trade calculator**: for 0.1 … 2 SOL: tokens, average fill, price impact, sell-right-back loss (fees ×2 + network
  fees; the slippage cancels out on a constant-product curve), break-even mcap. Matches the measured -3.1 % round trip.
- **Your note** + tags (👍 good meme, 🚩 rug, 👀 watch, ⏭ skip): shown on the card / list row, searchable, also next
  to closed positions in the portfolio (a trade journal).
- **Data quality + gap repair**: shows whether the coin's trade record is complete ("complete ✓" / "N gaps") and a
  "fix" button. At graduation the terminal fetches missing trades from the chain (Helius, 1 credit each, max 120
  per coin automatically, 400 with the button, 10,000 per day) and recomputes holders / bundle / snipers / top 10.
  Example: COPIUM after 247 recovered trades: top 10 31.5 % -> 26.3 %, bundle 46.5 % -> 37.3 % - exactly the kind of
  difference you saw against Axiom.

### Alerts
- **Danger** (push "urgent" + red flash): the dev or a holder with >= 3 % sells at least half while your wallet holds
  the coin.
- **Graduated**: a starred coin graduates.
- **Tracked wallets** (Settings): follow wallets with a name; alert when they buy / sell, their name in the coin page.
- **Quiet hours** (no new / entry pushes, page still shows them; price alerts always push) and **alert sound** choice.
- **Daily summary push** at an hour you choose (signals of the last 24 h + wallet profit), with a preview button.
- Icons per alert type in the list: 🟢 entry 💰 price ⚠️ danger 🎓 graduated 👁 tracked 🔔 new.

### Main page / layout
- **Compact list view** (Settings > Layout): one row per coin with sparkline, Copy CA, star.
- **Snooze** 💤 1 / 6 / 24 h: hidden and silent, comes back by itself.
- **👑 badge**: number of top-PnL wallets holding the coin.
- **Phone bottom bar**: Home, Watchlist, Signals, Portfolio, Paste CA, Settings (the header keeps the essentials).
- **Keyboard shortcuts** (PC, "?" shows them): C copy CA, A Axiom, W watchlist, 1-7 timeframe, M mcap/price,
  T/R/H/D tabs, S signals, P portfolio, "," settings, "/" search. An Axiom link also copies the CA.
- **Recently viewed** coins (clock button), **SOL price** in the status line, **text size** setting.

### Portfolio
- **Trading stats**: win rate, average win / loss, profit factor, best / worst, median holding time.
- **Profit calendar**: realized profit per day, last 5 weeks.
- **CSV export** of open / closed positions and transactions.

## Findings
- **Helius live feed** (tool `sweden/feed_test_helius.py`): 88-92 % coverage, no disconnects (free feed: 65-74 % with
  stalls). The missing part is partly transactions without pump.fun logs, but also real trades (new "version 1"
  transactions, V3 instructions, routers). **Not usable for the collector on the free plan**: Helius bills the live
  stream by volume (2 credits per 0.1 MB), the pump.fun stream would need ~1.7 M credits a day vs 1 M a month.
- **Gaps** are real and coin-specific (0.7 % to 7 % of links on PumpSwap). Many missing trades are invisible bot round
  trips (buy and sell the same amount in one slot) - they do not change holdings. The ones that matter break the
  reserve chain; the repair targets those.
- Credits used tonight for tests: roughly 25,000 of your 1,000,000 (mostly the feed tests and wallet histories).

## Not done / ideas for later
- Multiple wallets per user, a holder-count chart, PWA (home-screen app; the changing link makes it awkward).
