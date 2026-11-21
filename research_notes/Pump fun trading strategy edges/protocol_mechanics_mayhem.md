# Pump.fun protocol mechanics as possible trading edges: Mayhem mode, creator fees, cashback, fee tiers, new trade instructions, non-SOL quotes

Research date: 2026-11-19. Primary sources: the pump.fun public docs repo `pump-fun/pump-public-docs` (cloned 2026-11-19; last commit 639b87f dated 2026-10-13), its IDL (`idl/pump.json`), a PDA derivation run locally, and Bitquery's on-chain investigation covering 12 Nov 2025 to 7 Oct 2026. News articles are used for launch dates and context.

Key result: **BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s is the Mayhem agent.** It is the `sol-vault` PDA of the Mayhem program `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` (seed `"sol-vault"`, bump 253; derived locally). Bitquery also names it as the bot wallet published by pump.fun. The same PDA signs a privileged Pump instruction, `set_mayhem_virtual_params`, which **rewrites a Mayhem curve's virtual reserves**. That instruction is the most likely cause of the ±50% jumps in virtual SOL reserves, and of reserves going below 30 SOL, in our data.

---

## 1. What is Mayhem mode exactly, and is the agent predictable or exploitable?

### Takeaway
Mayhem mode is an opt-in flag set at `create_v2`. It is SOL- or USDC-quoted only and has been live since 12 Nov 2025. The coin gets a second 1B tokens, which go to the agent's vault. A fee-free pump.fun agent trades the coin "in a random walk" for up to 24 h and then burns what it still holds. In practice the agent's activity on a coin lasts a median of 39 s. Each agent trade moves the price far more than its size would, because the agent can reset the curve's virtual reserves. Across 11 months, Mayhem coins were worse for outside traders than comparable regular coins: all non-dev traders lost about 61.6k SOL in the first week. Only serial deployers with 100+ coins roughly broke even. No documented, validated strategy for trading with or against the agent exists. Since 21 Apr 2026 pump.fun says the agent's buy/sell balance is set "on a discretionary basis".

### Cited Findings
**Launch and rules**
- First agent trade on 12 Nov 2025. The feature turned up in the docs before any formal announcement. pump.fun's stated aim: "Mayhem Mode aims to increase the number of good projects in the pump.fun ecosystem". The disclaimer says it adds no economic value and promises no future performance. — [Cryptopolitan, 12 Nov 2025](https://www.cryptopolitan.com/pump-fun-launches-mayhem-mode-letting-ai-agents-loose-in-the-trenches/); [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Creators opt in at creation. Existing and graduated coins are not eligible. The agent mints an extra 1B tokens per coin (total supply 2B) and is active for 24 h after launch. At the end it burns all unsold tokens. Tokens sent to its wallet are burned and do not affect its decisions. The agent does not create tokens. — [Cryptopolitan](https://www.cryptopolitan.com/pump-fun-launches-mayhem-mode-letting-ai-agents-loose-in-the-trenches/); [SolanaFloor](https://solanafloor.com/news/one-more-effort-to-revive-struggling-solana-trenches-pump-fun-unleashes-mayhem-mode)
- On-chain: `create_v2` takes a mandatory `is_mayhem_mode: bool` argument. It always passes the Mayhem program `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` and its PDAs `global-params`, `sol-vault`, `mayhem-state` (seed + mint), and `mayhem_token_vault`, which is the Token-2022 ATA of the mint owned by `sol_vault`. — [pump-public-docs COIN_CREATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md)
- `CreateEvent` fields include `is_mayhem_mode`, `is_cashback_enabled`, `quote_mint`, `virtual_quote_reserves`, `creator_fee_bps`, `is_holder_reward`, and `depth`. `TradeEvent` has `mayhem_mode: bool` and `ix_name`. `BondingCurve` stores `is_mayhem_mode`. — [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- A global switch, `toggle_mayhem_mode(enabled)`, is admin-signed. `Global.mayhem_mode_enabled` exists. — [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- Mayhem is only allowed with SOL or USDC. A coin quoted in a pump coin or in a quote-control/custom mint cannot be Mayhem (error 6071 `MayhemModeQuoteMintNotAllowed`), and a Mayhem coin cannot be the quote for another coin (6100). — [CREATE_WITH_PUMP_COIN_QUOTE.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md); [KuCoin news on Custom Pairs](https://www.kucoin.com/news/flash/pump-fun-launches-custom-pairs-with-tokenized-stocks-metals-and-wrapped-btc)
- Mayhem coins must use one of 8 separate "reserved" protocol fee recipients (e.g. `GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS`, `4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6`, …) instead of the 8 normal ones. A wrong recipient makes the trade fail. — [FEE_RECIPIENTS.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FEE_RECIPIENTS.md)
- Mayhem coins, and the Mayhem agent, are excluded from "synthetic migration" (the v3 rule that lets the final buy run past the curve into the virtual pool). For them a too-big buy fails with `NotEnoughTokensToBuy`, or is partially filled. Mayhem curves cannot be a hop in `multi_hop_swap`. — [SYNTHETIC_MIGRATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/SYNTHETIC_MIGRATION.md)

**Reserve resetting (the "±50%" effect)**
- The Pump program has the instruction `set_mayhem_virtual_params` (no args). Signer: `sol_vault_authority`, the Mayhem PDA `"sol-vault"`. Other accounts: `mayhem_token_vault`, `mint`, `global`, `bonding_curve`. It emits `UpdateMayhemVirtualParamsEvent {mint, virtual_token_reserves, virtual_sol_reserves, new_virtual_token_reserves, new_virtual_sol_reserves, real_token_reserves, real_sol_reserves}`. In other words, the agent's vault PDA can rewrite a Mayhem curve's virtual reserves. — [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- Local derivation: `PDA(["sol-vault"], MAyhSm…D4e)` = **`BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`** (bump 253). As a sanity check, the same code reproduces Pump's well-known `global` PDA `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`. — derived with the docs' seeds ([COIN_CREATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md))
- Bitquery names BwWK17… as the bot wallet "published by Pump.fun". It finds that each bot trade "resets the curve's quoted price, usually by far more than the trade's size", and that the price stays where the bot's last trade left it once the bot stops. Example (METHEREUM, 15 Jun 2026): 23 bot trades in 43 s; a tiny first buy moved the price +17% (expected under 1%), and the first sell moved it −35%. Other wallets' trades moved the price normally. This reset behavior began in early Dec 2025. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Finished Mayhem curves had a median price at 28% of a fresh coin's price. 97% of regular curves stayed within 1% of launch. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)

**Agent behavior parameters**
- No trading fees for the bot. It is funded from pump.fun revenue, and profits go to an "insurance fund". — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Disclaimer rewritten on 21 Apr 2026: at most 1 trade per second per coin, a capped trade size, and a buy/sell balance "on a discretionary basis". Until 10–11 Mar 2026 the bot stopped at 50 trades on about half of coins; that cap was then removed. On 15 Sep 2026, 31% of repeat bot trades on a coin landed in the same second as the previous one. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Activity is short: median 39 s from first to last bot trade on a coin. 61% of coins were done within 1 min and about 90% within a few minutes. No coin saw a full 24 h. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- The bot permanently sold about 5% of its extra tokens and burned the rest. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Scale: 1.75M coins traded (about 19% of 9.0M launches) and 92.8M trades through 7 Oct 2026. The bot made 18% of launch-curve trades and 5% of SOL volume by Sep 2026. Mayhem share of launches was under 10% for the first 5 months, about 25% in Apr 2026, then 20–30% monthly. Serial devs launched 22% of Mayhem coins in Dec–Feb and 71% in Apr–Jun 2026. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- From July 2026 the bot also trades on PumpSwap (387,105 trades that month). It has traded USDC-quoted coins since 15 Jul 2026. Jito tips stopped in July 2026. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)

**Outcomes and P&L**
- Bot net result from 12 Nov 2025 to 7 Oct 2026: about −39k SOL (about $3.5M). That splits into −40.1k on the curve, +14.7k on PumpSwap, −2.4k on USDC coins, −7.5k network fees, and about −3.7k Jito tips. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Graduations: 7,958 Mayhem graduations, of which only 158 (1 in 50) filled the normal 85 SOL pool. Every regular graduation filled it. Median SOL in the pool: 7 SOL (Dec–Feb), 0.2 (Mar–Apr), 2 (May–Jul). — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Day-one outside buying, matched comparison: 1.1 SOL on Mayhem coins vs 4.3 SOL on regular coins. Coins with 100+ outside buyers: 0.05% vs 1.2%. Still trading on day 2: 3.6% vs 3.7%. Sandwich bots account for about 6% of outside SOL on Mayhem coins. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- First-week launch-curve P&L after fees: devs with 100+ coins (1,372 devs, 552,557 coins) about +3.8k SOL before creator fees, or −0.5k to +4.5k including them; 58% of them ended ahead. Devs with 10–99 coins about −2.4k. Devs with 2–9 coins about −7.9k. Single-coin devs (55,610 wallets) about −13.5k. All other traders about −61.6k SOL. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- Strategies documented publicly: none validated. Sandwiching the agent's orders is observed but not quantified. A "Mayhem Monday" campaign on X to trade against the bot has no reported outcome. Claimed one-day bot profits of $1.27M were disputed with Dune P&L data. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode); [X trending](https://x.com/i/trending/2041824234742411549?lang=en-GB)
- First week (Nov 2025): daily launches barely moved (17.3k to 17.8k) and revenue fell. — [The Block](https://www.theblock.co/post/379285/pump-funs-new-mayhem-mode-fails-boost-token-launches-revenue)

### Inferences
- **Our flag = 1 is almost certainly `is_mayhem_mode`.** Our observations match the documented mechanism: one fee-free wallet (BwWK17…, the agent's vault PDA) trades every flagged coin, and virtual SOL reserves jump far out of proportion to trade size, including below 30 SOL. A 0.03 SOL sell cannot move vSOL from 30 to 20 through the x·y=k formula. That drop must come from a reserve reset, which is consistent with `set_mayhem_virtual_params`. **Verify:** check that the decoded byte is the `is_mayhem_mode` field (CreateEvent field order: …token_program, is_mayhem_mode, is_cashback_enabled, quote_mint…), and look for `UpdateMayhemVirtualParamsEvent` logs or `set_mayhem_virtual_params` inner instructions in the same transactions as the agent's trades.
- **Our share is higher than Bitquery's.** We see about 60% of SOL-quoted launches, or about 45% of all launches if 25% are non-SOL. Bitquery reports 20–30% monthly through early Oct 2026. Either adoption rose again in Oct–Nov 2026, or serial-dev spam is concentrated in our window. Since Mayhem cannot be used on pump-coin or custom quotes, computing the share over SOL launches only inflates it.
- **Tradeability for a 1–2 s bot.** The agent trades up to 1×/s per coin, is done in a median of 39 s, and its price moves come from discretionary reserve resets, not from flow. So for a bot reacting 1–2 s late the price path is effectively exogenous noise. Each round trip costs about 2.5% in curve fees for us (zero for the agent), plus slippage and sandwich risk. The base rate is bad: outside traders lost about 61.6k SOL in week one. Finished curves sit at about 28% of launch price, and only 2% of graduations bring a real pool. Mean reversion is not documented. The documented drift is downward after the agent stops.
- **Possible narrow edge (speculative).** The reset size is deterministic given the event: the new virtual reserves are visible in the event or account immediately. A bot that subscribes to the bonding-curve account could see a large upward reset and sell into it, if it already holds tokens. It could also see a large downward reset, after which the price sits about 72% below launch. Only someone who holds tokens before the reset can capture it. Buying "cheap" after a downward reset is not supported by data, because the curve tends to stay there. The disclaimer states the buy/sell balance is discretionary, which rules out a stable model.
- **The clearest use of the flag is as a filter.** Excluding Mayhem coins, or treating any price action on them during roughly the first 1–3 minutes as non-informative, will likely improve our signal quality. This matches our earlier "normal / Mayhem split" in the replay.
- **Synthetic-migration exclusion.** Mayhem coins near completion behave the old way (partial fill or failure). Do not route Mayhem buys through v3 or multi-hop expecting overflow into the pool.

### Gaps
- No official pump.fun page fetched with exact agent parameters (trade size cap value, reset algorithm, insurance fund address). The pump.fun docs and FAQ pages were not fetched. Bitquery reports the disclaimer wording second-hand.
- The exact rule `set_mayhem_virtual_params` uses to compute new reserves is not public. The IDL shows that it reads `mayhem_token_vault`, so the reset may depend on the vault's token balance; this is speculation.
- Whether every agent trade is paired with a reserve reset was not verified on-chain here.
- No Dune dashboard data fetched directly.

---

## 2. Which wallet or program is the Mayhem agent?

### Takeaway
Confirmed. The agent's trading account is `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`, the `sol-vault` PDA of the Mayhem program `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e`. Its tokens sit in the Token-2022 ATA of each mint owned by that PDA (`mayhem_token_vault`).

### Cited Findings
- Mayhem program address and PDA seeds (`global-params`, `sol-vault`, `mayhem-state`+mint) — [COIN_CREATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md)
- BwWK17… is the bot wallet published by pump.fun — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- `sol_vault_authority` (seed `"sol-vault"`) is the signer of `set_mayhem_virtual_params` — [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- Locally derived: `PDA(["sol-vault"], MAyhSm…)` = BwWK17… (bump 253). `PDA(["global-params"], MAyhSm…)` = `13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ`. Method: standard Solana `create_program_address` with an ed25519 off-curve check.

### Inferences
- Because BwWK17 is a PDA, the agent's decisions are made off-chain by a pump.fun signer that invokes the Mayhem program. The "AI" is not inspectable on-chain.
- It appears fee-free because Mayhem trades are routed through the Mayhem program, or are exempt in the Pump program. The exact code path is not documented.

### Gaps
- The off-chain authority key that drives the Mayhem program was not identified.

---

## 3. Creator fees, creator rewards, cashback, and holder rewards: rates, recipients, incentives

### Takeaway
On SOL- and USDC-paired curves the creator gets 0.30% of every trade (total curve fee 1.25%). After graduation the creator share falls by market-cap tier, from 0.95% down to 0.05%. Fees now accrue on the curve or pool and are swept permissionlessly. Cashback coins (creator fee routed to traders) existed from about Feb 2026 but are deprecated and can no longer be created. They have been replaced by holder-rewards coins, where the creator fee goes to holders. Custom-pair coins can set their own flat creator fee. The incentive effect that matters is serial deployment: Mayhem plus creator fees let 100+-coin devs roughly break even, while everyone else in those coins loses.

### Cited Findings
- Bonding-curve fee table (from the docs' fees.png, part of the Sep 2025 dynamic-fee rollout): **curve 1.25% total = 0.30% creator + 0.95% protocol + 0% LP**. PumpSwap canonical pools by market cap:
  - 0–85k$ (0–420 SOL): 0.30% creator / 0.93% protocol / 0.02% LP = 1.25% total.
  - 85–300k$ (420–1470 SOL): 0.95 / 0.05 / 0.20 = 1.20%.
  - Creator share then falls by about 0.05% per tier (300–500k$ 0.90, 500–700k$ 0.85, …, 10–11M$ 0.30).
  - Above 11M$ the creator share falls by 0.025% per $1M, down to 0.05% at 20M$+ (98,240 SOL+), for a total of 0.30%.
  - Protocol fee is 0.05% and LP fee 0.20% on every tier above 85k$.

  — [pump-public-docs fees.png](https://github.com/pump-fun/pump-public-docs/blob/main/docs/fees.png)
- Dynamic fees became mandatory **Mon 1 Sep 2025, 20:00 UTC** on Pump curves and canonical PumpSwap pools (pool.creator = pump pool-authority PDA). Tiers are keyed on market cap in lamports: curve `vSOL × mintSupply / vToken`; pool `quoteReserve × supply / baseReserve`. Config lives in the fee program `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`. — [FEE_PROGRAM_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FEE_PROGRAM_README.md)
- `Global` now also has `buyback_fee_recipients` and `buyback_basis_points`. Every `buy_v2`/`sell_v2` needs a `buybackFeeRecipient` (8 addresses), and `TradeEvent` reports `buyback_fee_basis_points` and `buyback_fee`. — [FEE_RECIPIENTS.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FEE_RECIPIENTS.md); [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- Fees are no longer paid out per trade on v2/v3 trades. They accumulate in `BondingCurve.creator_fee` / `protocol_fees` and `Pool.creator_fees` / `protocol_fees`, and anyone can call `sweep_creator_fee` / `sweep_protocol_fee`, which pay to fixed destinations. Creators, CTOs, and fee-sharing setups must sweep first. — [SWEEP_FEES.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/SWEEP_FEES.md)
- Jan 2026: pump.fun announced a creator-fee overhaul: traders decide which projects deserve creator fees, "no member of the team will be accepting creator fees", and creators or CTO admins can split fees among recipients. "Dynamic Fees V1" was acknowledged as needing improvement. — [CoinGape, 10 Jan 2026](https://coingape.com/pump-fun-announces-new-upgrades-to-creator-fee-model/)
- Fee sharing: up to 10 recipients, locked once applied, with one further update allowed after a CTO (community takeover). — [KuCoin news](https://www.kucoin.com/news/flash/pump-fun-launches-custom-pairs-with-tokenized-stocks-metals-and-wrapped-btc)
- **Cashback** redirects the creator fee to the trader on their own volume, tracked in `UserVolumeAccumulator` PDAs (one each for Pump and PumpSwap) and claimed with `claim_cashback`. Sells and PumpSwap trades must append the accumulator accounts, otherwise the creator gets the fee. Cashback is **deprecated**: `create_v2` rejects `is_cashback_enabled=[true]`, but existing cashback coins keep paying. — [PUMP_CASHBACK_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_CASHBACK_README.md)
- Secondary sources say creators have chosen creator fee vs cashback at launch, locked, since Feb 2026. Cashback is 0.3% on the curve and 0.05% after graduation. Bitquery says cashback coins carry a 0.95% fee for the trader. — [Blofin search snippet](https://blofin.com/en/academy/education/pumpfun/pump-fun-cashback-coins-explained); [KuCoin news](https://www.kucoin.com/news/flash/pump-fun-launches-custom-pairs-with-tokenized-stocks-metals-and-wrapped-btc); [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)
- **Holder rewards coins:** `create_v2(is_holder_reward=[true])` makes the creator the `holder-rewards` PDA of the mint. Fees are collected there and paid out by `distribute_fee_to_holders`. This is permanent. — [HOLDER_REWARDS_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/HOLDER_REWARDS_README.md); [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- On custom pairs a creator can set `creator_fee_bps` in `1..=Global.max_configurable_creator_fee_bps`. One report says the pump.fun FAQ gives 0.05–1%; another says 0.01–3% for holder-rewards custom pairs. The two conflict. — [PUMP_PROGRAM_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md); [KuCoin news](https://www.kucoin.com/news/flash/pump-fun-launches-custom-pairs-with-tokenized-stocks-metals-and-wrapped-btc); [AirdropAlert](https://airdropalert.com/blogs/pump-fun-holder-rewards/)
- 50% of pump.fun revenue goes to PUMP buyback-and-burn. — [KuCoin news](https://www.kucoin.com/news/flash/pump-fun-launches-custom-pairs-with-tokenized-stocks-metals-and-wrapped-btc)

### Inferences
- **Serial-deployer incentive.** The creator earns 0.30% of all curve volume, including outside volume. On Mayhem coins the agent generates trades but, per Bitquery, pays no creator fee. A dev launching hundreds of Mayhem coins earns creator fees on outside flow and can trade the agent's resets. Bitquery's 100+-coin devs at about break-even is the best evidence. For a trader, this means a dev wallet with a high launch count is a negative signal: it extracts value from outside flow.
- **Cashback coins** cut a trader's round-trip curve cost from about 2.5% to about 1.9%, provided our tx includes the accumulator accounts. Sells without them pay the creator. The universe is shrinking (no new ones), so this edge is small.
- Sweep timing has no price effect on curves or pools. Effective reserves exclude unswept fees, as documented for PumpSwap, so there is no "sweep arbitrage".

### Gaps
- The current numeric `buyback_basis_points` was not found. Whether the buyback fee comes on top of 1.25% or out of the protocol share is unclear.
- Whether the Sep 2025 fee table is still current as of Nov 2026 is unverified. The Blofin fee page returned 403. One guide's claimed "Oct 17 2026" schedule and 0.45% web/app platform fee were not verified.

---

## 4. Current fee schedule on the curve and PumpSwap

### Takeaway
Curve trades on SOL and USDC coins cost a flat 1.25% (0.95% protocol + 0.30% creator) per side. PumpSwap canonical pools are tiered by market cap, from 1.25% (under about 420 SOL mcap) down to 0.30% (98k SOL+ mcap). Mayhem trades by the agent are fee-free. Custom-pair coins use their own creator fee bps. Pump.fun's web/app UI may add a frontend fee that direct program calls avoid; this is unverified.

### Cited Findings
- See the table in section 3. — [fees.png](https://github.com/pump-fun/pump-public-docs/blob/main/docs/fees.png); [FEE_PROGRAM_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FEE_PROGRAM_README.md)
- The PumpSwap tier calculation also takes `tradeSize` and whether the pool is canonical. Non-canonical pools are not on the schedule. — [FEE_PROGRAM_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FEE_PROGRAM_README.md)
- Synthetic-migration buys pay the curve fee schedule even for the part filled at pool prices. — [SYNTHETIC_MIGRATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/SYNTHETIC_MIGRATION.md)
- `Global.pool_migration_fee` = 15,000,001 lamports (about 0.015 SOL). — [PUMP_PROGRAM_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md)
- A web/mobile platform fee of 0.45% (0.40% with a referral) is reported by a single secondary guide, which says terminal and bot trades avoid it. — [WebSearch summary of Blofin guide](https://blofin.com/en/academy/education/pumpfun/pump-fun-fees-explained) (page itself returned 403; unverified)

### Inferences
- For our bot the minimum round trip on the curve is about 2.5%, plus priority or Jito fees. A curve entry needs more than 2.5% expected drift just to break even. Right after graduation (low mcap) the fees are similar. The cost advantage only appears above about 85k$ mcap: 1.20% total, falling to 0.30%.
- Discontinuity: the curve charges 1.25% with 0.30% to the creator, while the first PumpSwap tier above 85k$ gives the creator 0.95% of a 1.20% total. Fees are read live at trade time, so a mcap tier crossing changes fees within a trade sequence. This is minor.

### Gaps
- No confirmation that the tier table was revised in 2026.

---

## 5. Non-SOL quote tokens: which ones and how they work

### Takeaway
There are three kinds of non-SOL quote:
1. **USDC**, a `Global`-whitelisted quote. USDC coins use the standard fee schedule and can be Mayhem.
2. **Quote-control or custom mints**, which include tokenized stocks (xStocks/Backed, Sunrise/Backpack), wBTC, wETH, and metals. These need Token-2022 with a restricted extension set and have their own creator fee bps.
3. **Pump coins as quote.** A new coin is quoted in another pump coin, nested up to `Global.max_curve_depth` (hard cap 5; depth 2 enabled on 13 Oct 2026).

Our "about 25% non-SOL" bucket likely mixes all three. Decode `quote_mint` and `depth` from the CreateEvent to split it.

### Cited Findings
- `BondingCurve.quote_mint = Pubkey::default()` means SOL. `create_v2` remaining accounts select the quote mint. The unified v2/v3 instructions take `quote_mint`, and legacy instructions cannot trade USDC coins. The README announced USDC for the following week (undated), and a secondary guide dates the USDC launch to 21 May 2026. — [README](https://github.com/pump-fun/pump-public-docs/blob/main/README.md); [COIN_CREATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md); [WebSearch summary](https://blofin.com/en/academy/education/pumpfun/pump-fun-fees-explained)
- Quote-control mints seed the curve's virtual quote reserves from their quote-control entry, not from `Global`. Token-2022 quote mints may only carry the "xStock operable" extension set: metadata, permanent delegate, default account state, scaled UI amount, pausable, confidential-transfer mint, and a no-program transfer hook. — [pump IDL create_v2 docs](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- Custom pairs: 93 tokenized-stock pairs (Sunrise + xStocks), wBTC, wETH, and metals. Pairing is permanent. Creator fees are paid in the quote asset. Mayhem is available only on SOL/USDC. Books were observed to be thinner than SOL/USDC. — [KuCoin news](https://www.kucoin.com/news/flash/pump-fun-launches-custom-pairs-with-tokenized-stocks-metals-and-wrapped-btc)
- **Pump-coin quotes:** the new coin's initial virtual quote reserves are derived from the live reserves of every coin down the chain. The program prices the "graduation raise" of a target through each curve or pool, then scales it back by the raise ratio. `BondingCurve.depth` stores the nesting level. The chain's root must be SOL, USDC, or another listed quote. Creation fails if any chain coin is complete but not yet migrated (6107). Depth 2 has been allowed since 13 Oct 2026. — [CREATE_WITH_PUMP_COIN_QUOTE.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md); [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- `multi_hop_swap` / `multi_hop_curve_swap` route SOL through parent and child curves or pools in one instruction (Mayhem curves excluded). — [README](https://github.com/pump-fun/pump-public-docs/blob/main/README.md); [SYNTHETIC_MIGRATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/SYNTHETIC_MIGRATION.md)
- Bitquery: the bot trades USDC-priced coins from 15 Jul 2026 and lost 2.4k SOL on them. — [Bitquery](https://bitquery.io/investigations/pump-fun-mayhem-mode)

### Inferences
- A child coin's SOL price equals its own curve price times the parent's price. Buying a child with SOL via multi-hop pays curve fees on each hop: about 1.25% × 2 per side at depth 1. A rally in the parent revalues every child curve without any child trade. A stale child quote against a moving parent could in principle be arbitraged via multi-hop. But each leg pays 1.25%, so a SOL-to-child-to-SOL round trip costs at least about 5% at depth 1. This is unlikely to be viable at 1–2 s latency, and we found no documented case.
- Measure MCap and liquidity in SOL terms for non-SOL launches before applying our SOL-based filters, and exclude them from Mayhem analyses, since custom and pump-coin quotes cannot be Mayhem.

### Gaps
- No data source found giving the breakdown of non-SOL launches by quote type (USDC vs pump coin vs stocks).

---

## 6. Known protocol quirks and arbitrage: curve vs PumpSwap, rounding, buy_exact_quote_in

### Takeaway
The newer instructions mainly change UX and fee accounting, not price:
- `buy_exact_sol_in` and `buy_exact_quote_in_v2/v3` spend a fixed budget with documented floor and ceil rounding.
- v3 adds "synthetic migration", so the last buy can run past the curve at pool prices.
- Fees stay in curve and pool accounts until swept.
- PumpSwap's `virtual_quote_reserves` can be negative.

Each is documented as price-neutral. The one non-trivial wedge for indexers: reading the raw vault balance as liquidity is now wrong. No documented exploitable rounding or curve-to-PumpSwap arbitrage was found.

### Cited Findings
- `buy_exact_sol_in(spendable_sol_in, min_tokens_out, track_volume, partial_fill)`:
  - net_sol = floor(in × 10000 / (10000 + total_fee_bps)).
  - fees = ceil-rounded per component.
  - tokens_out = floor((net_sol − 1) × vTok / (vSol + net_sol − 1)).
  - The reverse quote adds +1 lamport.
  - The rounding favors the curve by about 1 lamport per trade.

  — [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- Program instructions (Nov 2026 IDL): `buy`, `buy_v2`, `buy_v3`, `buy_exact_sol_in`, `buy_exact_quote_in_v2`, `buy_exact_quote_in_v3`, `sell`, `sell_v2`, `sell_v3`, `multi_hop_curve_swap`, `migrate_v2`, `sweep_*`, `set_mayhem_virtual_params`, `set_virtual_quote_reserves`, and others. v3 trades use 17 accounts at the same prices and fees, and the legacy instructions still work. — [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json); [README](https://github.com/pump-fun/pump-public-docs/blob/main/README.md)
- Synthetic migration: with `buy_v3` or `buy_exact_quote_in_v3`, the buy that completes the curve continues against the reserves the future pool would hold, priced continuously. After that, every curve trade fails with `BondingCurveComplete` until `migrate_v2`. Legacy, v2, and Mayhem buys keep the old behavior. — [SYNTHETIC_MIGRATION.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/SYNTHETIC_MIGRATION.md)
- PumpSwap `virtual_quote_reserves` (i128) can be negative from "September 30" (the README gives no year; 2026 is inferred from the repo's Oct 2026 commit history). effective_quote = vault balance + virtual_quote_reserves. Unswept fees are subtracted so that they do not move price. Pools may also be "boosted" (non-zero `boost_reserves`; `can_boost` in events). — [VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md); [NEGATIVE_VIRTUAL_QUOTE_RESERVES.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/NEGATIVE_VIRTUAL_QUOTE_RESERVES.md)
- The Pump program also has `set_virtual_quote_reserves` and `set_quote_control_mint_reserves`, both admin-controlled, which can alter curve reserves outside trades. — [pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- Recommended static compute limit is about 100,000 CU for buy/sell. CU use varies with inputs. — [FAQ.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FAQ.md)

### Inferences
- Synthetic migration removes the old "graduation gap", where a buyer had to wait for migration and then race on PumpSwap. The final buyer now fills into the pool price immediately, at curve fees, before the pool opens. Racing to buy the first PumpSwap block is less valuable than before, because the pool opens exactly where the synthetic buy stopped.
- Any of our tools that infer price from raw vault balances (PumpSwap) or from x·y=k on the curve will misprice:
  - Mayhem coins, where reserves are reset by `set_mayhem_virtual_params`.
  - PumpSwap pools with unswept fees, where `virtual_quote_reserves` is negative.
  - Boosted pools.

  Always use the reserves reported in the event or account.

### Gaps
- No public write-ups found of bots exploiting `buy_exact_*` rounding or curve-to-PumpSwap price gaps. The searches were limited (about 15 tool calls). Searching Dune or X specifically for "synthetic migration" MEV could help.
