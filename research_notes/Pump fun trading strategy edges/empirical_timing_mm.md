# Empirical evidence on pump.fun returns, entry timing (sniping vs later entries) and market making / LP provision

Research date: 19 Nov 2026. About 16 tool calls. Evidence quality varies a lot. The only large, method-transparent profit study of snipers is Bitquery's (Oct 2026). Academic work so far covers graduation, manipulation and copy/"team-following", not executable strategy returns. Several 2026 arXiv preprints are single-author, not peer-reviewed, and one has been withdrawn (details below). Our own result (no edge at 30 s entry after fees) is consistent with everything found. Nothing found contradicts it.

## 1. Academic papers on pump.fun: profitable-trader share, rugs, graduation, entry time, bots, snipers

### Takeaway
Peer-reviewed or preprint studies agree on three points. Graduation is rare: about 0.6% of all launches (Sept 2025) and under 2% in Q4 2024. Manipulation and automation are widespread. A naive buy-and-hold entry along the curve sits below breakeven. No paper documents an executable, out-of-sample edge for a non-insider trader. The one paper with a positive-looking strategy (team-following) depends on hindsight, and its signal largely vanishes in real time.

### Cited Findings
- **Graduation, Sept 2025 (Marino, Naviglio, Tarantelli, Lillo, arXiv 2602.14860, Feb 2026):**
  - Sample: 1 Sep to 1 Oct 2025, 655,770 tokens from 243,123 creator addresses and 2.6M trader addresses.
  - 4,338 tokens graduated (about 0.63%). Among the 184,282 tokens with at least 30 swaps, 2.55% graduated.
  - Median graduation took about 457 trades and 4.4 minutes.
  — [arXiv 2602.14860](https://arxiv.org/html/2602.14860v1)
- **Predictors in the same paper:**
  - The strongest predictor is "liquidity velocity", meaning the token reaches a given SOL level in fewer trades.
  - A higher non-bot share of trades and early participation by previously profitable wallets raise graduation odds. The authors call the profitable-wallet effect modest and "double-edged".
  - The paper reports no out-of-sample accuracy metric.
  — [arXiv 2602.14860](https://arxiv.org/html/2602.14860v1)
- **Breakeven test in the same paper:**
  - Strategy: buy at curve level vSol and hold until graduation. Breakeven requires P(graduate) ≥ (vSol/115)².
  - Baseline graduation probability lies below this breakeven, so a naive buy-and-hold entry is not profitable.
  - Most conditional curves are also below breakeven. Exceptions: tokens with non-bot share around 0.3 near graduation, and the top-10 creators (small sample; the paper is internally inconsistent on the creator result).
  - Dynamic strategies were not tested.
  — [arXiv 2602.14860](https://arxiv.org/html/2602.14860v1)
- **Q4 2024 market structure (Mancino, arXiv 2512.11850, Dec 2025):**
  - Pump.fun minted up to 71.1% of all Solana tokens and was involved in 40–67.4% of daily Solana DEX transactions.
  - Fewer than 2% of tokens graduated to Raydium; the daily graduation rate peaked below 2%.
  - Daily active users grew from 60k to a 260k peak.
  - These are 2024 bull-market conditions.
  — [arXiv 2512.11850](https://arxiv.org/pdf/2512.11850)
- **Manipulation (Szwajcok, Tsuchiya, Liu, Soska, Payer, Christin, "Meme Coin Factories", arXiv 2609.10246, accepted ACM CCS'26):**
  - Covers about 15M pump.fun coins over roughly two years.
  - Identifies five manipulation classes: wash trading, creator-address obfuscation, coordinated sell, copycat coins and social-media manipulation.
  - Describes "market-manipulation-as-a-service" tooling. Strategic actors bypass the UI and trade "in a highly automated and low-latency fashion".
  - A search snippet attributes "at least 17% of trading transactions" to manipulation. I could not confirm that figure from the abstract page; the full paper is needed.
  — [arXiv 2609.10246](https://arxiv.org/abs/2609.10246)
- **Cross-chain aggregator-listed memecoins (Mongardini & Mei, arXiv 2507.01963):**
  - Sample: 20k+ memecoins listed on DexScreener and CoinSniper across BSC, Solana, Ethereum and Base. This is not pump.fun-specific; it is listed tokens.
  - 82.8% of high-return tokens (above +100%) show manipulation indicators such as wash trading or concentrated holdings.
  - 62.9% of high-return tokens show a profit-extraction sequence.
  - More than 17,000 victim addresses; $3.27M in realized losses from pump-and-dumps.
  - Among Solana tokens in their price sample, 50.43% lost value.
  — [arXiv 2507.01963](https://arxiv.org/pdf/2507.01963)
- **Team-following (Gafarov, arXiv 2611.11436, 8 Nov 2026, single author, not peer-reviewed):**
  - Strategy: follow wallet "teams" linked by SOL funding. Entry 4 s after launch, at most 0.1 SOL, 1% fee per side.
  - Ten windows, Apr 2024 to Sep 2026. Equity ends above 1 SOL in all 8 windows that contain a team, but only on hindsight-chosen teams and exit thresholds.
  - Unrealized marks make up 17–94% of equity. Free cash ends above 1 SOL in only 5 of 8 windows.
  - Without "seed" tokens (big winners), equity exceeds 1 SOL in only 3 of 8 windows.
  - When teams are recognised online, 9 of 19 become identifiable only after their last launch.
  - Only 3 of 40 selection-matched null tests reject after Holm adjustment.
  - Entering at 1 s instead of 4 s modestly raises geometric-mean equity (3.82 to 4.20 SOL), and only in three windows.
  - The author explicitly says these are "not executable profits".
  — [arXiv 2611.11436](https://arxiv.org/html/2611.11436)
- **Coordinated sniper cohorts (Kamat, arXiv 2607.02795, Jul 2026):**
  - Original claim: 1,012 persistent wallet rings among early buyers and a +16.1% lift in first-30-minute buyer count, with the SOL-inflow lift not significant.
  - Since withdrawn. An October 2026 correction notice says 43% of the rows labelled as buys were actually sells and the records hold only 23% of real buys. All numbers are withdrawn; do not cite them.
  — [arXiv 2607.02795](https://arxiv.org/pdf/2607.02795)
- **Graduation-label audit (Kamat, arXiv 2607.02823 v4, Sep 2026, pre-registered):**
  - Cohort: 749,816 mints, 12 May to 10 Jun 2026. Graduation prevalence is only 0.205–0.221%, as recorded by an off-chain collector polling the top-50 feed.
  - A logistic graduation model scored AUROC 0.859 in development but 0.464 on the next 14 days (95% CI 0.41–0.52, which contains 0.5). Calibration collapsed (slope 0.013).
  - Takeaway: off-chain "TIMEOUT" labels do not establish non-graduation, and predictive models do not generalize over time.
  — [arXiv 2607.02823](https://arxiv.org/pdf/2607.02823)

### Inferences
- The academic literature contains no measured, after-fee, out-of-sample positive return for a generic outside trader at any entry time. The positive results all require insider or hindsight information: dev bundles, hindsight teams, or top creators.
- Temporal non-generalization (2607.02823) matches our own experience. Filters that look good in sample fail out of sample, which looks like a structural property of this market, not a bug in our method.
- The breakeven formula P(grad) ≥ (vSol/115)² from 2602.14860 is a cheap sanity check to run on our recorded data for any conditional filter.

### Gaps
- No paper reports the share of profitable traders split by entry-time bucket (e.g. slot 0, first 10 s, 30 s, after X SOL). Our 30 s result has no direct academic comparator.
- I could not read the full text of 2609.10246 (CCS'26) for its bot-share or victim-loss figures.
- No academic rug-pull rate specific to pump.fun found. The closest proxy is 2602.14860's figure that more than 99% of tokens never graduate.

## 2. Dune / analytics PnL distributions and how they changed in 2025–2026

### Takeaway
Wallet-level realized-PnL snapshots show a heavy-tailed, tiny-winner distribution. In January 2025, about 0.4% of wallets had made more than $10k realized. The share of wallets profitable in a month swung from 30% (Jun 2025) to 73% (Apr 2026). This most likely reflects losing traders leaving (monthly active wallets fell from 5.2M to 1.8M), not easier profits. Most "winners" made $1–$500.

### Cited Findings
- **Dune, January 2025 (analyst Adam Tehc), realized only, bots included:**
  - About 0.41% of about 13.5M wallets had made more than $10k (55,296 wallets; other reports give 55,012 of 13.4M).
  - 0.048% made more than $100k; 0.00217% (about 293 wallets) made more than $1M.
  - Critics (onchain analyst Alon) note that post-graduation (Raydium) trades are omitted and many wallets are bots.
  — [TradingView/Cointelegraph](https://www.tradingview.com/news/cointelegraph:0f6859ba7094b:0-99-6-of-pump-fun-traders-haven-t-locked-in-over-10k-in-profits-data/); [PANews](https://panews.io/articles/2999rwu0)
- **CoinGecko, monthly profitable-wallet share (realized PnL, excludes bagholders who never sold):**
  - June 2024 to December 2025: below 50% every month. Low of 30.08% in June 2025.
  - January 2026: 50.08%. April 2026: 73.28%, the fourth straight month above 50%.
  - Secondary reports give February 2026 at 56.83% and March 2026 at 70.00%.
  - April 2026 distribution of 3.14M active wallets:
    - Profit $1–500: 2.05M (65.1%)
    - Profit above $1k: 168,795 (5.37%)
    - Loss $1–500: 792,724
    - Loss above $1k: 24,538
  - Monthly active wallets fell from a 5.2M peak (May 2025) to 1.8M (Dec 2025). The CoinGecko researcher says the rise in profitability "cannot conclusively" be explained and hypothesizes an exodus of losing traders.
  — [BeInCrypto via Yahoo Finance, 9 May 2026](https://finance.yahoo.com/markets/crypto/articles/73-pump-fun-traders-profit-094850577.html); [Blockchain.News](https://blockchain.news/news/pump-fun-traders-profitability-surge)
- **Conflicting March 2026 Dune analysis (@oladee via Protos):** 50.6% of traders lost money and 45.6% made up to $500. A widely shared "96% losing" claim actually combined losers with traders who made under $500. — [cryptonews.net](https://cryptonews.net/news/altcoins/32600810/); [ourcryptotalk](https://ourcryptotalk.com/news/pump-fun-96-percent-traders-losing-money)
- **Bitquery wallet distribution for sniper bots:** see section 3 (54% of sniper wallets ended ahead). — [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles)

### Inferences
- "% of wallets profitable" is a poor proxy for strategy edge:
  - Realized-only metrics exclude unsold losers, which matters because 96% of our coins stop trading within minutes.
  - One operator can run many wallets.
  - Survivorship rises as losing users leave.
- The 2026 rise to about 70% profitable is consistent with a thinner, more professional market, not with an easy edge for a new 2 s-latency bot.
- Distributions are extremely skewed. Winners above $1k are about 5% of active wallets, and above $10k about 0.4% (Jan 2025).

### Gaps
- No public dashboard found that splits PnL by trader type (bot vs human) or by entry latency.
- I did not access the CoinGecko/Dune dashboards directly. The figures come via news coverage.

## 3. Is sniping (first 1–3 slots) profitable, for whom, and what infrastructure does it need?

### Takeaway
Sniping is profitable in aggregate but thin. Across about 8.2M launches (Oct 2025–Jun 2026), 25,882 sniper wallets made $31.5M after fees on sales, or $15.2M with unsold tokens marked at zero, on $440M spent. That is roughly 3.5% on capital, before Jito tips and failed transactions. Just over half (54%) of sniper wallets ended ahead, and profit is concentrated at the top. Dev and bundle insiders made at least about 18x more ($579M). Sniping is an infrastructure race that a ~1–2 s retail bot cannot enter: block 0 is 0.4 s or shorter.

### Cited Findings
- **Bitquery investigation (verified 10 Oct 2026):**
  - Sample: 8,212,568 pump.fun launches, 30 Oct 2025 to 7 Oct 2026. Profit window: launches up to 30 Jun 2026, with three days of trades per launch.
  - Sniper definition: a wallet that bought in the first three blocks of launches by at least 10 different devs.
  - Coverage:
    - A non-dev wallet bought in block 0 on 38% of coins, and within three blocks on 50%.
    - Sniper bots were in block 0 on 28% of coins.
    - On 24% of launches, nobody but the dev traded in the first three days.
  - Profit:
    - 25,882 sniper wallets spent $440M and made $31.5M after pump.fun fees on sold tokens, or $15.2M with unsold holdings at zero.
    - 54% of sniper wallets finished ahead. The top 10 made $6.7M and the top 100 made $13.1M.
    - 510 wallets made more than $10k and 88 lost more than $10k.
  - Exclusions: Jito tips and fees on failed transactions are excluded, so real sniper net profit is lower.
  — [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles)
- **Same report, insiders and devs:**
  - 21% of launches were bundled. Devs and bundle wallets made at least $579M after fees ($529M with unsold at zero) and came out ahead on 71% of bundled launches.
  - The top 1% of bundled launches produced 65% of that profit.
  - Other groups: devs without bundles $84.3M; unlinked early buyers $22.7M.
  - Dev's first sale timing: within 1 minute on 65% of launches, within a day on 90%.
  - Bundled-wallet buys rose from $56.4M (Jun 2026) to $1.2B (Sep 2026).
  — [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles)
- **Fees and block timing:**
  - The pump.fun fee is 1.25% per buy and per sell on most coins (0.95% on the rest). A round trip costs about 2.5% plus network fees.
  - Block-0 buying by non-devs fell from 44% (Oct 2025) to about 31–35% (autumn 2026) as Solana blocks got faster. The share of buying within about 1.3 s stayed near 52–53%, so faster slots did not stop bots.
  — [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles); [CryptoSlate](https://cryptoslate.com/solana-study-finds-rapid-pump-fun-buying-persisted-as-blocks-sped-up/)
- **Pine Analytics (2025, via BeInCrypto/X, secondary, unverified):** deployer-funded same-block snipers reportedly extracted over 15,000 SOL in net profit in a month, with about 87% of snipes profitable. This covers a subset of insider-linked wallets, not independent snipers. — [Pine Analytics on X](https://x.com/PineAnalytics/status/1914301091337953734); [BeInCrypto](https://beincrypto.com/pump-fun-meme-coin-snipers-systematic-problem/) (403 when fetched)
- **Infrastructure (vendor/official docs; anecdotal on numbers):**
  - Helius Sender requires a priority fee of at least 5,000 lamports. Its docs say a 0.001 SOL tip "is unlikely to be competitive" and recommend pricing tips by what a landing is worth.
  - RPCFast says pump.fun tip floors spike with curve velocity and that a reverted bundle still costs the tip.
  - Self-reported dev.to sniper: 400 ms average latency, 72% success, 8% failed transactions.
  - Typical tips: about 0.0001 to 0.02 SOL.
  — [Helius Sender docs](https://www.helius.dev/docs/pt-BR/sending-transactions/sender-max); [RPCFast landing guide](https://rpcfast.com/blog/how-to-improve-your-jito-bundle-landing-rate-on-solana); [RPCFast snipe guide](https://rpcfast.com/blog/how-to-launches-snipe-pump); [dev.to](https://dev.to/apollo_ag/i-sniped-a-solana-token-in-400ms-heres-the-full-tech-stack-3ocf)

### Inferences
- Sniper return on capital is about 7% on sold tokens or about 3.5% with unsold at zero (31.5/440 and 15.2/440). Tips and failed transactions could easily consume that for a marginal participant. Sniping profit accrues mainly to the top roughly 100 wallets ($13.1M of $31.5M).
- Bitquery's per-actor ranking (insider bundles ≫ devs ≫ snipers > unlinked early buyers) implies that the counterparty to a 30 s entry is often a dev, bundle or sniper about to sell. 65% of devs sell within a minute, which matches our observed −3% per trade.
- A 1–2 s bot is structurally outside the sniping game. It enters after 3–5 blocks, when early buyers are distributing.

### Gaps
- No measured cost of failed transactions, or landing rate versus tip, from an independent source.
- No independent study of profitability by slot (slot 0 vs 1 vs 2 vs 5+).

## 4. Momentum / mean-reversion at specific market caps, time of day/week, or SOL regime

### Takeaway
I found no measured study of momentum or mean-reversion edges by market cap, time of day, weekday or SOL regime on pump.fun. The only related quantitative signals are descriptive: trade velocity predicts graduation, but predictive models fail out of sample. Profitability shares and activity vary strongly with the overall memecoin regime.

### Cited Findings
- **Velocity and breakeven (2602.14860):** "liquidity velocity" (reaching a SOL level in fewer trades) is the most informative graduation predictor, but conditional graduation curves mostly stay below buy-and-hold breakeven. — [arXiv 2602.14860](https://arxiv.org/html/2602.14860v1)
- **Market-cap functional form (2607.02823):** not stable across pre-registered specifications. The model's out-of-sample AUROC is about 0.46. — [arXiv 2607.02823](https://arxiv.org/pdf/2607.02823)
- **SOL price as a regime variable (2611.11436):** studied only in passing. The author explicitly says the results are "not evidence of a causal effect of the SOL price". — [arXiv 2611.11436](https://arxiv.org/html/2611.11436)
- **Weekend activity:** evidence is event-driven, not systematic. The Jan 18–19 2025 TRUMP-launch weekend set a record of $26.8B in Solana DEX volume, with network fees about 20x normal. — [Forklog](https://forklog.com/en/meme-coin-traders-ignite-a-frenzied-weekend-on-solana/); [Blockworks](https://blockworks.co/news/trump-memecoins-rock-solana)
- **Regime shifts in the profitable-wallet share:** 30% (Jun 2025) to 73% (Apr 2026). — [Yahoo/BeInCrypto](https://finance.yahoo.com/markets/crypto/articles/73-pump-fun-traders-profit-094850577.html)

### Inferences
- With no published evidence, any time-of-day or market-cap rule must be tested on our own data. Given 2607.02823, the out-of-sample test must use a later time block, not a random split.

### Gaps
- No academic or analytics study of intraday or weekday seasonality in pump.fun returns.
- No study of momentum entry at mcap thresholds (e.g. buy when the curve crosses X SOL) with after-fee returns, beyond the hold-to-graduation breakeven in 2602.14860.

## 5. Market making / LP provision on bonding curves and PumpSwap

### Takeaway
I found no measured, independent study of LP or market-making returns on new-token PumpSwap pools. Market making on the bonding curve itself is not possible: the curve is the only counterparty and there is no order book, so the only "MM-like" activity is volume or bump bots. Available material is promotional or theoretical. The standard IL math plus near-total loss in dumping tokens suggests LP on fresh memecoins loses unless volume relative to price drift is extreme.

### Cited Findings
- **Bonding curve mechanics:** the pump.fun curve is modelled as constant-product (virtual reserves), so late entrants are mechanically penalized. — [arXiv 2601.08641](https://arxiv.org/html/2601.08641v2); [arXiv 2602.14860](https://arxiv.org/html/2602.14860v1)
- **PumpSwap fee split:** sources conflict. One guide says 0.20% of each swap goes to LPs. A 2026 overview describes a 5 bp protocol fee, with LP and creator fees varying with pool liquidity. Verify against official docs. — [Medium (jump_bit)](https://medium.com/@jump_bit/pumpswap-lp-fees-explained-how-to-earn-125-day-from-your-memecoin-pool-6cf6b2c2a918); [memegateway](https://memegateway.com/academy/pumpswap-trading-guide/)
- **Migration liquidity:** reportedly locked permanently or issued without LP tokens to the public, so outside LPs would have to add to existing pools. — [smithii](https://smithii.io/en/remove-liquidity-pumpswap/); [memegateway](https://memegateway.com/academy/pumpswap-trading-guide/)
- **Impermanent loss math:** a 2x move either way costs about 5.7%, and a 3x move about 13.4%. A memecoin falling 90% costs an LP about 42% from IL alone, on top of holding the token side. — [zelcore](https://zelcore.io/academy/defi/impermanent-loss-liquidity-provider-risk)
- **Promotional earnings claims:** "$125/day" figures tie LP income to running bump bots. These are not evidence. — [Medium (jump_bit)](https://medium.com/@jump_bit/pumpswap-lp-fees-explained-how-to-earn-125-day-from-your-memecoin-pool-6cf6b2c2a918)
- **PumpSwap market share:** reportedly 45.73% of Solana DEX volume on 19 Nov 2026. Its deepest pool is PUMP/USDC with about $18.5M liquidity; new memecoin pools are far smaller. — per search-result summary of [coinpaprika](https://coinpaprika.com/education/pumpswap-api-solana-dex-data) (not independently verified)

### Inferences
- LP breakeven requires cumulative fee yield (fee rate × volume / TVL) to exceed IL plus directional loss. With LP fees of about 0.2% and typical post-graduation tokens drawing down heavily, a pool would need volume of many times TVL per day just to offset a 50% decline. That is plausible only in the first hours after migration, which is also when rug and dump risk is highest. This is untested reasoning, not evidence.
- "Market making" on the curve reduces to round-trip trading at about 2.5% fee cost per round trip. Without a spread to capture, it cannot be an edge.

### Gaps
- No measured PumpSwap LP PnL study found (no Dune dashboard, Kaiko, Galaxy or Messari report).
- No source found on sandwich or MEV returns specific to pump.fun curves.

## 6. What can be tested on our recorded pump.fun curve trades (wallet, slot, SOL, tokens, reserves, fees, graduation)

### Takeaway
Most published measurements can be reproduced with our fields: sniper and bundle PnL by actor, breakeven by vSol, the velocity signal, team/funding cohorts (if we add SOL-transfer funding edges), and temporal hold-out validation. LP economics need PumpSwap pool data, which our curve collector does not have.

### Cited Findings
- **Bitquery's method needs:** slot or block index relative to the first trade, wallet, SOL in and out, the dev wallet, and Jito bundle position. Profit is SOL out minus SOL in, with unsold holdings at zero, over three days. — [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles)
- **Marino et al.'s breakeven needs:** vSol at entry and graduation outcomes, giving P(grad | features) versus (vSol/115)². — [arXiv 2602.14860](https://arxiv.org/html/2602.14860v1)
- **Team-following needs:** native SOL funding links between wallets, which are not in curve trades. Entry-delay sensitivity was tested from 1 to 60 s. — [arXiv 2611.11436](https://arxiv.org/html/2611.11436)
- **Label quality:** graduation labels from an off-chain feed poller are unreliable. Use the on-chain `complete` flag or the migration event. — [arXiv 2607.02823](https://arxiv.org/pdf/2607.02823)

### Inferences
Concrete tests possible on our data:
- **(a) Actor-level PnL by entry slot bucket** (slot 0, 1–2, 3–10, 10 s, 30 s, 60 s+), with unsold holdings at zero. This shows where in time the money is made, and whether any non-insider bucket is positive after 1.25% per side.
- **(b) Counterparty decomposition of our 30 s entries:** what fraction of subsequent sell volume comes from block 0–2 buyers and dev wallets.
- **(c) Conditional graduation versus the (vSol/115)² breakeven** for velocity and non-bot-share filters, validated on a later time block.
- **(d) Dev-sell timing:** check the "65% sell within a minute" figure in our sample.

Not testable without new data:
- LP or market making on PumpSwap (needs pool reserves, LP fees and post-migration trades).
- Jito tip and failed-transaction costs (needs mempool or bundle data).
- Time-of-day effects (testable in principle, but 14 h of data covers less than one day cycle).

### Gaps
- Our 14 h sample is far too short for weekday or regime analysis. Published samples run from 13 days to 11 months.
