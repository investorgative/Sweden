# Pump.fun graduation / PumpSwap migration strategies: is there an edge for a retail ~1-2 s bot? (as of Nov 2026)

Scope note: 16 searches and fetches. Primary sources reached: arXiv 2602.14860, Pump.fun help-center fee page, The Block (Mar 2025 and Jul 2026), Bitquery investigation (Nov 2025 to Oct 2026), and an on-chain reverse-engineering Substack on BOOST (Jul 2026). The Medium study "We tracked 1,634 graduated coins" returned HTTP 403, so its numbers below come only from search-engine snippets and are marked as such. I found no Dune dashboard that publishes post-graduation returns relative to graduation price. Nearly all "graduation strategy" material outside these sources is bot-vendor or SEO content with no measurements.

## 1. Price and volume around graduation (last ~5-10 SOL, the migration moment, first minutes on PumpSwap)

### Takeaway
The best-documented structural fact is a **depth discontinuity**: the price stays continuous at migration, but the PumpSwap pool is shallower than the end of the curve. That makes selling before graduation better than selling after, which pushes holders to dump into the last SOL of the curve and the first minutes of the pool. Since 21 Jul 2026, **BOOST** adds a known, mechanical ~17.6 SOL TWAP buy-and-burn in the first 5 minutes after migration. That is the one predictable order flow in the window. I found no published measurement of an average "graduation pump" or "migration dump" in % terms.

### Cited Findings
- Graduation happens when virtual SOL reserves reach 115 SOL (30 virtual + 85 real). At migration the 30 SOL virtual advance is reclaimed, and the PumpSwap pool starts with about 85 SOL and about 2.069e8 tokens. "The token price is kept continuous at graduation by design, but market depth is not." The authors use this to explain pre-graduation selling incentives, and they argue pre-graduation sales of the same inventory yield more SOL than post-graduation sales. Data: 1 Sep to 1 Oct 2025 (pre-BOOST) — [Marino, Naviglio, Tarantelli, Lillo, arXiv 2602.14860, Feb 2026](https://arxiv.org/html/2602.14860v1)
- Same paper: 92.22% of 184,282 tokens with at least 30 swaps (169,938) show at least one dump event (Shewhart rule, 4-sigma lower control limit). Dumps cluster at higher SOL levels on the curve. Median time to graduation is about 4.4 min, with a median of about 457 curve events — [arXiv 2602.14860](https://arxiv.org/html/2602.14860v1)
- Curve constants: about 793.1M tokens are sold on the curve. Graduation happens at about 280M virtual tokens and 115 virtual SOL, about 85 real SOL. Graduation market cap is about 400 SOL — [MadeOnSol, May 2026, updated Nov 2026](https://madeonsol.com/blog/pump-fun-first-3-minutes-graduation-math)
- The pool opening price is about 0.411 SOL per million tokens, which matches the final curve price. If all circulating supply (793.1M) were sold into the pool it would extract only about 67.41 SOL, an average of 0.085 SOL/M (a 79% haircut). The author says this holds both before and after BOOST — [OnchainDivers Substack, 24 Jul 2026](https://onchaindivers.substack.com/p/the-176-sol-ghost-reverse-engineering)
- BOOST mode shipped 21 Jul 2026 (10:23 EST). For about 5 minutes after each migration it runs a TWAP buyback of about 17.6 SOL (about $2,516 for USDC pairs) into the new pool, and burns the tokens it buys. Tokens migrated before the cutoff and Mayhem-mode tokens are not boosted. Measured burns range from 0.018% to 9.5% of supply (one case 12%). The burned share is inversely related to price — [OnchainDivers](https://onchaindivers.substack.com/p/the-176-sol-ghost-reverse-engineering); [KuCoin explainer, 22 Jul 2026](https://www.kucoin.com/blog/ae-pump-fun-boost-mode-explained)
- Pump.fun describes the ~20% of migration liquidity "previously locked permanently in the PumpSwap pool at graduation" as dead liquidity, and BOOST redirects it into these buys. BOOST is the new default launch mechanism, and creators cannot opt out — [The Block, 29 Jul 2026](https://www.theblock.co/post/409815/pump-fun-token-graduation-rate-jumps-boost-changes-launch-incentives); [KuCoin](https://www.kucoin.com/blog/ae-pump-fun-boost-mode-explained)
- A small set of sniper wallets shows up on nearly every BOOST completion, acting **0-6 s after pool creation**. One wallet appeared in 13 of 14 traced tokens — [OnchainDivers](https://onchaindivers.substack.com/p/the-176-sol-ghost-reverse-engineering)
- Practitioner opinion, not data: "graduation = top" has become muscle memory, and veterans dump at the graduation tick — cited by a search summary of [TerabyteTriangle](https://terabytetriangle.com/en/tutorial/why-pumpfun-model-fading.html) (page not opened). Vendor guides say many tokens "experience a brief dip as early bonding curve holders take profits", with no numbers given — [solanatools blog](https://solanatools-io.pages.dev/blog/pump-fun-trading-strategy)
- A search snippet mentions an analysis of "776,306 launches" finding the damage concentrated in a ~25-minute window after the pool opens. **I could not find or verify the source**, and a targeted search for "776,306" returned nothing. Treat as unverified.

### Inferences
- Depth comparison, computed from the cited reserves (pre-BOOST). Selling 100M tokens at the very end of the curve (vSOL 115 / vTok 280M) gives about 115×100/380 ≈ 30.3 SOL. Selling the same 100M into the fresh pool (85 / 207M) gives about 85×100/307 ≈ 27.7 SOL, before fees. That is roughly 8-9% worse after migration. The gap grows with order size, so large holders have a rational reason to sell into the last part of the curve.
- BOOST is a known buyer of about 17.6 SOL over 5 minutes against a pool of about 67-85 SOL. That is a predictable, sizable buy flow, about 20-25% of pool SOL. It probably creates a short, mechanical "post-migration support" window, and dumps are likely to cluster right after it ends. This is a hypothesis, not a measured result.

### Gaps
- No published median or quantile price path (for example t = −60 s to +60 min around migration) relative to the graduation price, either before or after BOOST.
- The exact BOOST TWAP schedule (number of buys, size, interval, wallet) was not published in any source I reached. It has to be measured on-chain.
- Whether the post-BOOST pool still starts at 85 SOL / 207M tokens, or at a reduced reserve, is unclear (the sources conflict on wording).

## 2. What fraction of graduated tokens trade above graduation price after 1 h / 24 h?

### Takeaway
No source I found publishes "% above graduation price at 1 h / 24 h". The available statistics are about activity and survival, and they point to fast decay for most graduates, with a long-lived minority.

### Cited Findings
- Bitquery (trades from 1 Nov 2025 to 7 Oct 2026; 47,539 graduations checked against Pump.fun records): 1 in 58 launches graduated, and 43% of graduated Pump.fun tokens still traded in their fifth week (any-trade or ≥10-trade definitions). In the same study, 98% of graduation pools had no liquidity removed. Pools start with about 85 SOL. Graduations bought in ≤3 curve trades rose from 2% (Nov 2025) to 33% (Sep 2026), i.e. many graduations are mechanical or bot-completed. Bitquery gives **no price-versus-graduation data** — [Bitquery](https://bitquery.io/investigations/solana-launchpad-year)
- Medium/Coinmonks study of 1,634 graduated coins, Nov 2026 snapshot (**seen only via search snippets; the page returned 403**). 54.7% of the 170 coins aged 0-6 h had traded in the last hour, versus about 33% of coins aged 6-12 h. 354 of 759 coins (46.6%) were "under $100" at 24-48 h. The snippets disagree on whether that means market cap or pool value. "19 of 31" (subset unclear) were down >90% from pool open — [Medium/Coinmonks](https://medium.com/coinmonks/what-happens-after-a-pump-fun-coin-graduates-we-tracked-1-634-of-them-61efab687f1b)
- Graduation rates vary widely by period: 0.63% of launches (Sep 2025, [arXiv](https://arxiv.org/html/2602.14860v1)); 1.8% (Aug 2026, 18,202 of 1,032,440, [MadeOnSol](https://madeonsol.com/blog/pump-fun-deployer-stats-august-2026), sidebar figure not verified); 2.5% the week before BOOST, rising to 4.7% (4-day average) and a 6.7% day afterwards, about 8x June's average ([The Block](https://www.theblock.co/post/409815/pump-fun-token-graduation-rate-jumps-boost-changes-launch-incentives)). OnchainDivers saw about 230 migrations in 24 h on 22 Jul 2026 against a usual 2-6 for the stalled-curve band, and its indexer found 9,207 stalled standard curves at 50-70 SOL — [OnchainDivers](https://onchaindivers.substack.com/p/the-176-sol-ghost-reverse-engineering)
- arXiv buy-and-hold breakeven: buying on the curve at vSol and holding to graduation is profitable in expectation only if p(grad | vSol) > vSol²/115². The baseline curve lies below breakeven at every vSol. Only some conditional subsets (non-bot share >0.3 near graduation; top-10 creators, small sample) approach or exceed it. This concerns reaching graduation, not post-graduation performance — [arXiv](https://arxiv.org/html/2602.14860v1)

### Inferences
- After BOOST, part of the graduate population is "completed stalled curves" (bought in a few trades to farm the boost). These coins probably have very different post-graduation dynamics from organic graduates. Any statistic should be split by regime (before or after 21 Jul 2026) and by completion type.

### Gaps
- The core question (% above graduation price at 1 h / 24 h) has no reliable public answer. It must be measured. None of the analytics firms named in the brief (Blockworks, Messari, Flipside, Helius) turned up such a statistic in my searches.

## 3. Strategies: evidence after fees

### Takeaway
(a) **BOOST "completer" play** (buy a stalled curve, complete it, sell into the BOOST TWAP): this is the only strategy with **measured on-chain PnL**. It made +2.7 and +4.15 SOL on about 68-73 SOL notional (about 4-6%) in two traced trades, with the author's stated real-world range at +2 to +4 SOL. It is capital-heavy, competitive, and depends on a protocol subsidy that Pump.fun can remove. (b) "Buy the last SOL and sell into migration", (c) "buy the first post-migration dip" and (d) "fade graduation" have **no measured evidence** after fees. The structural evidence (depth discontinuity, dumps clustering near graduation) argues against (b) unless you are early, and is consistent with (d) except that BOOST now adds a 5-minute bid.

### Cited Findings
- **Completer / BOOST arbitrage.** Theoretical peak is about +15 SOL per trade at about 66 SOL real reserves, assuming 1 SOL in fees. Measured: token 7Rauo… bought 486.53M tokens for 73.0 SOL and sold for 75.7 SOL (+2.7). Token BxLo81… bought 410.8M for 68.4 SOL and sold for 72.55 SOL (+4.15). The author's real-world range is +2 to +4 SOL after TWAP timing, sniper competition and slippage. The completer competes with snipers acting within 0-6 s. The main risk is pre-migration holders "waking up" and selling into the same bid. The author calls it research, not trading advice, and notes Pump.fun can remove the boost — [OnchainDivers, Jul 2026](https://onchaindivers.substack.com/p/the-176-sol-ghost-reverse-engineering)
- **Buy-and-hold on the curve toward graduation:** not profitable in expectation on the baseline (see the breakeven above) — [arXiv](https://arxiv.org/html/2602.14860v1)
- **Post-migration sniping (vendor claims):** guides describe buying the moment the pool appears via Photon, BullX or Axiom. An RPC vendor claims sub-50 ms stacks are needed and that "~90% of DIY sniper bots fail". That figure comes from a seller of the infrastructure and is unverified — [RPC Fast](https://rpcfast.com/blog/how-to-launches-snipe-pump)
- I found no backtest, study or Dune query showing positive after-fee returns for (b), (c) or (d).

### Inferences
- Fee drag on a round trip around graduation: about 1.25% on the curve buy plus about 1.25% on the PumpSwap sell (the lowest PumpSwap tier, see section 4), so about 2.5% plus priority fees and slippage. Any graduation play needs a gross move well above about 3-4% to pay off.
- For a 1-2 s bot, the completer play is in principle less latency-bound than post-pool sniping. You choose when to complete, and the BOOST TWAP runs for 5 minutes. But (i) it needs about 70 SOL of capital per trade, (ii) other completers race for the same stalled curves (the 230 migrations in a day show it was found quickly), and (iii) its edge probably decays fast. Its current status in Nov 2026 is unknown.
- "Buy the first post-migration dip": if dumps cluster right after BOOST ends (t ≈ 5 min), a dip entry at t > 5 min would avoid competing with the boost and the snipers. This is untested.

### Gaps
- Whether the BOOST completer edge survived past Jul-Aug 2026, and whether Pump.fun changed BOOST parameters since then. I found no follow-up data.
- No measured after-fee evidence for the end-of-curve, dip-buy or fade strategies.

## 4. PumpSwap vs Raydium: fees, LP, creator share, 2025-2026 changes

### Takeaway
Since 20 Mar 2025, graduates migrate instantly and for free into a canonical PumpSwap pool whose LP tokens are burned. Previously they went to Raydium with a 6 SOL migration fee. PumpSwap fees became market-cap-tiered in Sep 2025 (Project Ascend). A fresh graduate (about 400 SOL market cap) sits in the **highest tier: 1.25%**, the same as the curve.

### Cited Findings
- Launch on 20 Mar 2025: instant migration to PumpSwap, the 6 SOL migration fee removed, originally a 0.25% fee (0.20% LP, 0.05% protocol). Older graduates stay on Raydium — [The Block, 20 Mar 2025](https://www.theblock.co/news/business/2025-03-20-pump-fun-launches-dex-called-pumpswap-to-instantly-migrate-graduated-tokens-347360)
- May 2025: a creator revenue share of 0.05% per PumpSwap trade (half of protocol revenue) — [The Block, 13 May 2025](https://www.theblock.co/news/defi/2025-05-13-pumpswap-revenue-tokens-354038)
- Sep 2025 "Dynamic Fees V1" (Project Ascend), from the Pump.fun help center (dated 26 Sep 2025). Curve: 1.25% (0.95% protocol + 0.30% creator). PumpSwap tiers by market cap in SOL: 0-420 → 1.25% (0.93 protocol / 0.30 creator / 0.02 LP); 420-1470 → 1.20% (0.05 / 0.95 / 0.20); 1470-2460 → 1.15%; 2460-3440 → 1.10%; … 98k+ → 0.30% (0.05 / 0.05 / 0.20). Intermediate tiers were not listed on the page — [Pump.fun help center](https://intercom.help/pumpfun-web/en/articles/11002413-transaction-fees-on-pump-fun). Secondary sources say 25 tiers — [Coinpaprika](https://coinpaprika.com/education/launchpad-fees/)
- LP: migration liquidity sits in a canonical pool with burned LP tokens, so nobody (creator or platform) can withdraw it. Mostly secondary sources — [BloFin](https://blofin.com/academy/education/pumpfun/pumpswap-canonical-pool-ownership); 98% of graduation pools had nothing removed by Jul 2026 — [Bitquery](https://bitquery.io/investigations/solana-launchpad-year)
- Jul 2026 BOOST: about 17.6 SOL of migration liquidity goes into a 5-minute buy-and-burn instead of sitting as dead liquidity — [The Block](https://www.theblock.co/post/409815/pump-fun-token-graduation-rate-jumps-boost-changes-launch-incentives)
- Migration is a permissionless instruction, and the PumpSwap pool address is deterministic from the mint (vendor claim) — [SolanaTracker docs](https://docs.solanatracker.io/guides/pumpfun); [Chainstack guide (Raydium era)](https://docs.chainstack.com/docs/solana-listening-to-pumpfun-migrations-to-raydium)

### Inferences
- Because the pool address is deterministic, a bot can precompute it and subscribe to it before graduation, which removes discovery latency.
- At 1.25% per side in both venues there is no fee advantage to trading either side of graduation. The fee drops below 1.25% only once market cap passes 420 SOL.

### Gaps
- I could not check the full tier table at pump.fun/docs/fees, or confirm whether fees changed after Sep 2025.
- Search snippets claiming a "0.015 SOL graduation fee" or "1.5 SOL fee" conflict with each other and could not be verified.

## 5. Latency: is the window dominated by bots?

### Takeaway
Yes, the first seconds are. A few sniper wallets act within 0-6 s of pool creation on nearly every BOOST migration, and a growing share of graduations are completed in ≤3 curve trades. A 1-2 s bot cannot win the pool-open race, but strategies set on a minutes scale (the 5-minute BOOST window, post-BOOST dip) are reachable.

### Cited Findings
- Snipers act within 0-6 s; one wallet appeared in 13 of 14 traced completions — [OnchainDivers](https://onchaindivers.substack.com/p/the-176-sol-ghost-reverse-engineering)
- Graduations bought in ≤3 curve trades: 2% (Nov 2025) → 33% (Sep 2026) — [Bitquery](https://bitquery.io/investigations/solana-launchpad-year)
- Excluding graduations under 2 s does not change the baseline graduation curve. "isBot" (direct contract calls) is defined in [arXiv](https://arxiv.org/html/2602.14860v1); its bot-share findings are internally inconsistent between the abstract and section VII.
- Vendor claim of a sub-50 ms requirement for launch sniping — [RPC Fast](https://rpcfast.com/blog/how-to-launches-snipe-pump) (marketing)

### Gaps
- No public latency distribution of first-pool buyers relative to the migration slot.

## 6. Testing with our recorded curve data, and what else to collect

### Takeaway
Our curve recordings (every trade with wallet, slot, SOL, tokens, virtual reserves, fees, plus graduation events) can already test pre-graduation behaviour and the completer entry side. Every exit-side question needs PumpSwap pool data for at least the first 60 minutes after migration.

### Cited Findings
- Recommended methodology: define cohorts by date, program version and quote asset; include stalled and failed tokens; avoid label leakage; hold out a chronological test set; model fees, latency, slippage and exit liquidity; peak multiples are not realized returns — [MadeOnSol](https://madeonsol.com/blog/pump-fun-first-3-minutes-graduation-math)

### Inferences (proposed replay design)
- **Testable now, curve-only:**
  1. *Last-N-SOL dynamics.* For each graduated mint, compute net flow, sell share, unique sellers and price path for real SOL in bins of 70-75, 75-80 and 80-85, and the time from 75 SOL to graduation. This checks whether there is a pre-graduation dump (the arXiv depth argument) or a run-up.
  2. *Completer-entry economics.* Using the recorded virtual reserves, simulate buying the remaining SOL to 85 from states at 50-80 real SOL, including the 1.25% fee. Count how often stalled curves sit in that band, and how often another wallet completes first. Identify who completes curves: wallets, trade size, number of trades, and whether those wallets reappear (13-of-14-style patterns).
  3. *Pre-graduation exit value.* Compare the curve sell proceeds at each state with the analytic pool proceeds (pool k from the reserves at migration) to quantify the depth discontinuity per token.
  4. Split everything by regime: before or after 21 Jul 2026, Mayhem vs normal (Mayhem is not boosted), and BOOST vs non-BOOST.
- **Needs new collection (PumpSwap):** subscribe to the deterministic pool address of each graduating mint (or to PumpSwap program logs filtered by graduated mints) and record every swap for at least 60 min, ideally 24 h: slot, wallet, side, SOL in/out, tokens, pool reserves after the swap, fees. Also record the migration transaction itself (initial pool reserves: verify 85 SOL/207M before BOOST versus the reduced reserves after) and tag the BOOST agent's buys (wallet, schedule, sizes). Add periodic reserve snapshots so prices can be computed in quiet periods. With that data, measure: price relative to graduation price at 1 / 5 / 15 / 60 min / 24 h; the share above graduation price; how fast sniper buys land after the migration slot; the price at the end of BOOST (t = 5 min); and after-fee PnL for completer, end-of-curve-to-migration, post-BOOST-dip and fade rules. Apply a realistic 1-2 s entry delay (first fill at the slot plus about 3-5 slots).

### Gaps
- Whether the free RPC/websocket tier can keep up with all PumpSwap swaps for graduated mints (volume is low: roughly hundreds to about 1-2k graduations per day in 2026, per the counts above). This is likely fine but unverified.
