# 🇸🇪 SWEDEN — can a profitable Solana bot wallet be copied?

Project Sweden picks up where the other two projects left off:

* **Norway** showed that price-chart strategies on pump.fun graduates lose after fees (0 of 162 robust parameter sets
  profitable in both halves of the data).
* **Cupsey** showed that copying a famous caller is dangerous (the profit can come from selling to the copiers) and
  turned up several wallets that look like bots.

Sweden asks the next question: **some bots are profitable, so is any of them copyable?** A bot can only be copied
if its edge survives the delay of a copier (we see its trade, then trade ourselves 1–25 slots later) and the fees.

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
