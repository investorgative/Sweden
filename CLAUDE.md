# Context for Claude sessions working on Sweden

Read this first, then README.md. It is the handover from the cloud session that built Sweden (18 Nov 2026).

## The three projects
* **Norway** (repo investorgative/Norway): pump.fun graduate paper trader, backtester, research collector.
  Result: no robust profitable strategy. 412 graduates (Sep–Nov 2026): 99 % end below half their graduation price;
  0 of 162 robust breakout/momentum parameter sets profitable in both halves with realistic crash fills.
  Round trip costs 2.5–3.5 %. Dumps happen inside one transaction, so stops gap.
* **Cupsey** (repo investorgative/Cupsey, branch `claude/lucid-fermi-l6uyk2`): search for the trader Cupsey's
  "shadow wallets". No reliable network found; one weak lead (`omegoMAe…`, p ≈ 0.01 with 51 wallets tested,
  driven by one coin). Lesson: copying a famous caller is dangerous, the profit can come from selling to copiers.
* **Sweden** (this repo): can we find or build something that beats the fees?

## What Sweden found so far
1. **Copying bot wallets does not work** (`sweden/wallet_scan.py`, results in README). The one clearly profitable
   bot (`sssssDdM…`, +29 SOL in 6 h) loses its edge when copied 1 slot (0.4 s) late. It trades on the pump.fun
   curve, holds ~20 s and sends every buy through several paid landing services. Its edge is speed infrastructure,
   so cloning its rules was judged not replicable and not pursued.
2. **Fixed TP/SL on Norway's graduate data, no filter:** TP +50 % / SL −30 % wins 25–28 %, avg −14 % to −28 % per
   trade with realistic fills. With realistic fills (avg loss −45 % to −55 %), break-even needs about a 50 % win rate.
3. **The user's strategy idea (current focus):** buy a coin on the bonding curve 30 s – 3 min after launch, as soon
   as a filter approves it, then sell at a fixed TP / SL. Filter criteria from the user: not a rug, low dev holdings,
   not heavily bundled, dev with a good history, not a copy, few snipers, sells work (no honeypot), real volume,
   no fabricated price. The user spots fake volume by eye within 30 s – 3 min and reports being right every time.
   Additional criteria suggested: linked wallets via funding (count as one holder), fresh-wallet share, Token-2022
   traps, wash-trading measures, serial deployers, known dumpers.
4. **Approach chosen:** record raw data, replay any filter offline (`sweden/collector.py` + `sweden/replay.py`).
   Off-chain checks and the real latency need a forward test later.

## Open problem — data completeness (check this first)
In the cloud sandbox the free feed (`wss://api.mainnet-beta.solana.com`, logsSubscribe on the pump.fun program)
delivered only **65–69 %** of successful pump.fun transactions, even with 4 connections: all connections stall
together, lose seconds of data, then disconnect. Possibly the sandbox's proxy. On the Pi:
* run `./venv/bin/python sweden/check_feed.py` (stop the collector first) → needs ≥ 98 % combined coverage;
* the replay prints "data completeness: X % of SOL coins have an unbroken trade chain" → needs to be high;
* if coverage is low, a better feed is needed (free Helius key, or PumpPortal's free websocket, which was blocked in
  the sandbox and is untested). More connections don't help.

## Facts checked in code
* pump.fun events: TradeEvent / CreateEvent / CompleteEvent decoded in `sweden/pump_events.py`. New coins use
  `CreateV2`. About a third of launches are quoted in another token (CreateEvent quote mint set); only SOL-quoted
  coins are analysed.
* The curve's token reserve moves by exactly each trade's token amount → used to order trades inside a slot and to
  detect missing trades.
* Round trip of 0.5 SOL with nothing in between costs 3.1 % (2 × 1.25 % fee + 0.0015 SOL per transaction).
* About 2,200 launches per hour; about 73 % of pump.fun transactions fail; most devs sell within 2 minutes.

## How the user wants to work
* Free data sources only. Solana Tracker credits are almost used up; avoid that API.
* Be honest: no profit claims without out-of-sample evidence; say plainly when an idea fails or isn't replicable.
* Real-money execution stays off until a strategy is proven (same rule as Norway).
* The user runs things on a Raspberry Pi (64-bit) in tmux sessions; explain steps for the Pi.
* Never ask for or handle secrets in chat; keys go into config files or environment variables on the Pi.

## Next steps
1. On the Pi: `check_feed.py`. If coverage is good, run the collector for a few days.
2. Run `replay.py --nofilter` (baseline) and `replay.py` (filter v0). Then measure which criteria actually separate
   winners from losers and tune thresholds on the first half of the data, confirm on the second half.
3. Only then: a forward paper test with the live latency and the off-chain checks.
