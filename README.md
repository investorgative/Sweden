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
