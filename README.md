# 🇸🇪 SWEDEN — can a profitable Solana bot wallet be copied?

Project Sweden picks up where the other two projects left off:

* **Norway** showed that price-chart strategies on pump.fun graduates lose after fees (0 of 162 robust parameter sets
  profitable in both halves of the data).
* **Cupsey** showed that copying a famous caller is dangerous (the profit can come from selling to the copiers) and
  turned up several wallets that look like bots.

Sweden asks the next question: **some bots are profitable, so is any of them copyable?** A bot can only be copied
if its edge survives the delay of a copier (we see its trade, then trade ourselves 1–25 slots later) and the fees.

## Module 2 — pump.fun launch collector + replay (run this on the Pi)

**Question:** if a script buys a coin the moment it approves it (30 s – 3 min after launch) and sells at a fixed
take-profit or stop-loss, how often is +X % reached before −Y %?

**Why record raw data instead of the filter's verdict:** the collector stores every pump.fun launch and every
trade of those coins (wallet, slot, SOL, tokens, curve reserves, fees) and, since 19 Nov 2026 12:20, their trades
on PumpSwap after graduation (pool reserves, fees, user). The replay then runs *any* filter version,
any approval delay (latency), any TP / SL on the same days of data in seconds. Only off-chain checks (RugCheck,
socials, images) and the real latency of the live setup need a forward test later.

### On the Pi
```bash
cd ~
git clone https://github.com/investorgative/Sweden.git sweden
cd sweden
git checkout claude/memecoin-trading-bot-research-xru22m   # until merged into main
chmod +x setup.sh && ./setup.sh
./venv/bin/python sweden/check_feed.py   # FIRST: is the free feed complete on your connection? (~3 min)
./start.sh            # tmux session "Sweden"
./status.sh           # what has been collected
```
**Run `check_feed.py` before collecting.** It listens to the feed for 90 s and compares it with the real list of
pump.fun transactions from the chain. Only start the collector if the combined coverage is ≥ 98 %.
In the cloud sandbox this was built in, the free feed delivered only **65–69 %** (all connections stall together
for several seconds, then disconnect). That may be the sandbox's network proxy; a direct home connection may be
much better. If the Pi is also low, the fix is a better feed (free Helius key or PumpPortal), not more connections.
Let it run for a few days. `./stop.sh` stops it cleanly; restarting continues where it was (a restart within the
same hour writes a new `events-HH-<run>.jsonl.gz` file). Always stop with `./stop.sh`: a collector that is killed
leaves its hour file cut off; `python3 sweden/repair_gz.py` recovers such files (originals kept in `data/broken/`).
Autostart after reboot: `crontab -e`, add `@reboot sleep 30 && /home/<user>/sweden/start.sh`.

**Resources:**
* About 250 MB of disk a day.
* Network: the free endpoint sends every pump.fun and every PumpSwap transaction, including the many that fail,
  so the download is large: about 1 MB/s after websocket compression on 4 curve + 2 PumpSwap connections (about
  90 GB a month). If your internet has a data cap, use fewer connections, e.g.
  `SWEDEN_WS=wss://api.mainnet-beta.solana.com,wss://api.mainnet-beta.solana.com SWEDEN_WS_SWAP= ./start.sh`
  (check the coverage with `check_feed.py` first; 2 curve connections, no PumpSwap; more reconnect gaps, and the replay excludes coins trading during a gap).
* PumpSwap has its own connections: on a shared socket the free endpoint dropped more than half of the launches.
* No API key, no account, no cost.

### Analysing
```bash
./venv/bin/python sweden/replay.py --nofilter          # baseline: buy every normal coin 30 s after launch
./venv/bin/python sweden/replay.py                     # filter v1 (approval window 30 s – 3 min)
./venv/bin/python sweden/replay.py --kind mayhem --nofilter   # Mayhem coins (indicative only, see below)
./venv/bin/python sweden/replay.py --lat 10 --size 1 --set dev_pct=0.1 min_netflow=5
# buy the dip: coin first rises 100 % above launch, falls 50 % from that peak, then bounces 10 % off the low
./venv/bin/python sweden/replay.py --nofilter --dip 0.5 --min-peak 1.0 --rebound 0.1 --max-age 600
./venv/bin/python sweden/wallet_pnl.py --kind mayhem   # which wallets really make money (their own fills)
./venv/bin/python sweden/wallet_pnl.py --wallet <address>     # one wallet's trades coin by coin
```
Prints: how many coins the filter approves and why the others were rejected, a table of how often +X % is reached
before −Y % (after fees, our size and latency), and fixed TP / SL results.

**Two kinds of coin.** About 60 % of SOL-quoted launches carry create flag 1 (“Mayhem” coins): a fee-free
pump.fun agent wallet (`BwWK17…`) trades every one of them and moves the curve in jumps of ±50 % within seconds.
They behave completely differently from normal coins (32 % reach +50 % vs 5 %), so the replay runs one kind at a
time (`--kind`, default `normal`). On Mayhem coins other traders' fills deviate −30 % / +40 % (p10 / p90) from the
curve formula, so the replay's fills there are rough; use `wallet_pnl.py` (real fills) to judge Mayhem strategies.

**Filter v1** (`FILTER` in `sweden/replay.py`, first-guess thresholds — the data decides the real ones):
dev holds ≤ 5 % · dev did not sell within 1 s of launch and has not sold ≥ 99 % of what it bought · launch-slot
bundle ≤ 10 % · snipers (first buy 1–3 slots after launch) ≤ 15 % · top-10 holders ≤ 30 % · ≥ 15 traders,
≥ 20 buys · top-3 wallets ≤ 40 % of trades · ≤ 30 % of buys with identical size · creator launched ≤ 2 other coins
in 24 h · name/ticker not used in the previous 72 h · ≥ 3 SOL net inflow.
v0 rejected every coin whose dev had sold anything. In the data of 18–19 Nov a partial dev sell went with *more*
activity (15–17 % of those coins reach +50 % vs 4 % when the dev had not sold); only a launch-slot dev sell
(0.6 % reach +50 %) or a full dev exit (6 %) is a bad sign.

**`wallet_pnl.py`** computes every wallet's PnL from its own fills in the collected data (fees and 0.0015 SOL per
transaction included; tokens still held are valued at what selling them on the last curve would return, so dead
bags count as losses). It lists the most profitable wallets with their typical size, entry age, entry market cap
and holding time: the starting point for studying (and copy-testing, module 1) the bots that win.

**Data check:** every coin's trades must form an unbroken chain (the curve's token reserve moves by exactly the
traded amount). A coin with a missing trade in its window is excluded and the share of complete coins is printed
first. If that share is low, the results lean towards quiet coins and should not be trusted.

**Realism:** the fill comes LAT slots after the signal (default 5 ≈ 2 s) with every trade in between applied first;
our own buy and sell move the curve; pump.fun fee + creator fee on both sides; 0.0015 SOL per transaction.
TP / SL are measured on what selling our tokens would return, so +50 % means +50 % in the pocket.

**Known limits:**
* Only SOL-quoted coins (about three quarters of launches) are analysed; the other quote token's amounts are not
  decoded (their trade events carry 0 SOL).
* Mayhem coins: simulated fills are rough (see above).
* A position still open at graduation is valued at the last curve price; trading after graduation is not recorded.
* Order inside one slot follows arrival order from the stream.
* Not checked: wallet funding links, fresh-wallet share, socials, images. These can be added from the chain later
  because the wallets are recorded.

### Post-graduation dip strategy (`sweden/grad_replay.py`)
A manual trader's rules for freshly graduated coins, as a replay on the recorded PumpSwap trades:
on-chain checks at graduation (filter v1 without dev-sell and activity checks) · the price falls 30–75 % from its
post-graduation high (deeper = dead) · bounces ≥ 20 % off the low · pulls back 10 % from that bounce high without
breaking the low → buy · market cap ≤ $100k · coin at most 6 h old (the trader uses Fomo's Graduated tab: coins
created in the last 24 h that graduated; Fomo's help center lists no safety exclusion for that tab, only warning
labels, so no extra filter is needed for it) · TP = SL (1:1) at 25 / 35 / 50 % · max hold 4 h.
```bash
./venv/bin/python sweden/grad_replay.py                      # the rules above
./venv/bin/python sweden/grad_replay.py --nofilter           # without the on-chain checks
./venv/bin/python sweden/grad_replay.py --at 60              # baseline: buy every graduate 60 s after graduation
./venv/bin/python sweden/grad_replay.py --dd-min 0.4 --bounce 0.3 --pullback 0.15 --tp 0.3 --max-mcap-usd 50000
```
The human part of the strategy (is the meme good, does it have followers) is not in the data, so the replay tests
whether the price pattern plus the on-chain checks has an edge by itself. A coin needs WINDOW + HORIZON (10 h by
default) of PumpSwap data after its graduation. Roughly 400–500 coins graduate a day (most of them normal coins);
how many of them pass the checks and form the pattern decides how long it takes to get a meaningful sample.

### First results (18–19 Nov 2026, about 14 h of data, 0.5 SOL, 2 s latency, after fees)
* **Normal coins, blind buy at 30 s:** 5 % reach +50 %, 96 % stop trading (10 min without a trade) first. Every
  TP / SL / time-stop combination loses (best about −3 % per trade).
* **Filter v0** raises the +50 % rate to about 21 % but approves only ~25 coins and still loses.
* **Entry-rule search** (~1,000 single and paired conditions at 15–120 s, picked on the first 60 % of the data,
  checked on the last 40 %): on normal coins nothing that wins on the first part also wins on the second.
* **Buy the dip** (coin rises +30 / +100 / +200 %, falls 30 / 50 / 70 % from the peak, optionally bounces 10 / 25 %
  off the low, entry 30 s – 10 min after launch): 42 normal-coin setups, none positive on both parts of the data
  (the best, "+200 % peak, −50 % dip", is −4.9 % then +2.0 % per trade with the fixed exit, n = 182 / 51).
  Mayhem: 3 of 54 setups are positive on both parts with their best exit, as expected from chance.
* **Real wallets, Mayhem coins:** with unsold bags counted, only 75 of the 223 active wallets are profitable and
  the wallets together lose. Many of the top wallets in both kinds buy in the launch slot itself (entry 0 s,
  identical sizes), i.e. they are the deployers, profiting from the buyers who come after.

## Terminal — live screen of graduated coins (`./terminal.sh`)

A page for manual trading: it shows only pump.fun coins that graduated to a SOL pool on PumpSwap, are at most 6 h
old, pass the on-chain checks, are at most $100k market cap and have dropped at least 10 % from their top (so a
coin never shows while it pumps). Mayhem coins are hidden (`--mayhem` shows them). It reads the collector's files,
so the collector must be running. No chart and no trading in the page: each coin has a big **Copy CA** button
(tapping the name or picture copies too), and the newest alert stays pinned at the top with its own Copy CA button.

```bash
echo '<your passkey>' > terminal_passkey && chmod 600 terminal_passkey   # optional, at least 6 characters
./terminal.sh        # tmux session "SwedenTerminal": terminal on port 8750 + Cloudflare quick tunnel
```

* Opens from anywhere (mobile data too) via the `https://….trycloudflare.com` link printed at the end; the link
  changes whenever `./terminal.sh` runs again (`grep trycloudflare logs/tunnel.log | tail -1`). At home also
  `http://<pi-ip>:8750`.
* The page asks for the passkey from `terminal_passkey` (or `SWEDEN_PASSKEY`); without one, the first start
  generates 8 digits into that file (`cat terminal_passkey`). Stays logged in for 30 days per browser; changing
  the passkey and restarting logs everyone out. Wrong passkeys lock the address out (5 tries, then 1, 5, 15, 60 min).
* Alerts: tap "Enable sound" on the page; push to the phone with `SWEDEN_NTFY_TOPIC=<secret topic> ./terminal.sh`
  and the ntfy app.

## Module 1 — `sweden/wallet_scan.py` (free data only)

For a wallet it reads the most recent N transactions from **free public Solana RPC** (no API key, no credits),
turns them into round trips per token (open → position back to ~0) and reports:

* realized PnL in SOL, win rate, median/mean return per trade, trade size, holding time, failed transactions;
* the **copy test**: for every closed trade, the effective price of the first *other* trader buying
  ≥ d slots after the bot's buy and the first other trader selling ≥ d slots after the bot's sell,
  for d = 1, 2, 5, 25 slots (0.4 s, 0.8 s, 2 s, 10 s). The copy return is sell price ÷ buy price − 1.
  Reference swaps must be ≥ 0.2 SOL so priority fees of tiny trades don't distort the price.

```bash
python3 sweden/wallet_scan.py <wallet> [<wallet> …] --max 1500 --trades 60
```
Results go to `results/<wallet>.json`.

### Limits of the copy test (read before trusting a number)
* Effective prices include each trader's own fees and tips; the bot's and the reference trader's costs differ.
* Only trades with a reference swap in the window are tested, which favours tokens with an active market.
* A copier also needs its own detection + send latency; 1 slot is the best case for a fast setup.
* A scan covers hours, not weeks, for very active bots. Profit must also hold up in a later window.

## Free data sources

| Source | Free? | What it gives | Use in Sweden |
|---|---|---|---|
| Public Solana RPC (`api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`) | yes, no key | raw transactions, signatures per address | **used now** — slow (≈ 4–5 tx/s) but complete |
| Helius free plan | free account + key | parsed swap history per wallet (one call per 100 tx), faster RPC | best upgrade: much faster wallet histories |
| Dune (free plan) | free account + key | SQL over all Solana DEX trades (`dex_solana.trades`) | find profitable wallets at scale instead of guessing |
| GeckoTerminal API | yes, no key | pool OHLCV + recent trades | price context (Norway already uses it) |
| DexScreener API | yes, no key | pair info, liquidity, volume | safety / context |
| Solana Tracker | paid credits (almost used up) | wallet PnL, trades | avoid |

## First result (18 Nov 2026, 1,500 most recent transactions per wallet)

The four bot-like wallets from the Cupsey research:

| Wallet | Window | Closed trades | Realized PnL | Hold (median) | Bot mean (tested trades) | Copy +1 slot | Copy +5 slots |
|---|---|---|---|---|---|---|---|
| `sssssDdM…` | 6.1 h | 506 | **+29.2 SOL (+5.8 %)** | 20 s | +6.6 % | −3.9 % (median −7.2 %) | +1.2 % (median −3.7 %) |
| `omegoMAe…` | 1.8 h | 159 | +1.7 SOL (+1.2 %) | 70 s | +16.7 % | +4.9 % (median −10.0 %) | +9.9 % (median −9.6 %) |
| `STorreSu…` | 1.7 h | 128 | −1.1 SOL (−0.9 %) | 52 s | +7.3 % | +1.4 % (median −4.4 %) | +1.5 % (median −2.4 %) |
| `3qvuM3U5…` | 3.7 h | 653 | −1.9 SOL (−0.8 %) | 22 s | +1.7 % | −6.1 % (median −4.6 %) | −4.0 % (median −2.5 %) |

* Only `sssssDdM` is clearly profitable in its window, at about 5 SOL an hour.
* Copying it one slot late turns +6.6 % per trade into −3.9 %. Its edge is in the first few hundred
  milliseconds, so mirroring it does not work.
* The positive copy *means* of `omegoMAe` and `STorreSu` come from a few big winners; their medians are
  −4 % to −10 % and the samples are 26–37 trades. That is noise, not an edge.
* All four lose 0.2–0.3 SOL to failed transactions in a few hours (up to 35 % of their transactions fail),
  the cost of competing for speed.

### How `sssssDdM` executes (25 recent buys inspected)
* Trades directly on the **pump.fun bonding curve** (program `6EF8…`, before graduation), about 83 round trips an hour,
  median hold 20 s (10 % under 1 s, 90 % under 7 min).
* Every buy is sent through several **paid transaction-landing services at once** (Nozomi, Astralane, Jito and
  others, 0.001 SOL tip each) plus a priority fee of about 0.0005 SOL.
* Conclusion: the edge is speed infrastructure, not a rule a slower bot can run. A clone would need the same
  low-latency data feed and landing services and would then compete with this bot for the same entries.
  Not pursued.
