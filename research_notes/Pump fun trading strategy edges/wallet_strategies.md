# Wallet-based strategies on pump.fun: copy trading, KOLs, deployer/bundle networks, smart-money tools (as of Nov 2026)

Scope note: research done 2026-11-19. Most "evidence" in this niche is vendor blogs and marketing. The items with a real method are: arXiv 2601.08641 (copy trading, with an out-of-sample test set), arXiv 2611.11436 (following funding-network teams), arXiv 2609.10246 (manipulation census), Bitquery's bundle/sniper investigation (Oct 2026), Bubblemaps' KOL investigation (Nov 2026), Merkley et al. (influencer tweets, peer-reviewed), and Arrow Algo's pre-registered paper-trading lab (Oct 2026). Each finding below is tagged by evidence type: [measured], [simulated], [estimate], or [claim/anecdote].

## 1. Empirical evidence on copy-trading profitability, edge decay with delay, and how tracked wallets punish copiers

### Takeaway
Every quantitative source points the same way. The wallets themselves often show real profits, but copiers keep a small fraction of that edge or lose money, because a copier buys later on the bonding curve, after the leader's own price impact. The loss grows quickly with delay. The best measured copier result is +3%/trade, and it needed an elaborate filter. A 2-minute delay lost 41%/token. One simulation puts the win rate at 28% for a 1 s delay and 4% for 5 s. Our own result (+6.6% for the leader turned into -3.9% when copying 1 slot late) matches this.

### Cited Findings
- [measured, out-of-sample test set] arXiv 2601.08641, "Resisting Manipulative Bots in Meme Coin Copy Trading" (2026):
  - Data: 6,000 pump.fun coins with full trader histories from Flipside, split chronologically 70/15/15.
  - Smart-money wallets picked by the authors' multi-agent LLM framework averaged +14%/trade, but the estimated copier return was only +3%/trade "under realistic market frictions".
  - The statistical baselines (wallet features such as past returns over the prior 1-5, 6-10 and 11-15 coins, a t-stat gate > 1.645, and entry timing) found wallets with positive returns, yet their copiers lost money.
  - Model frictions: the 1% pump.fun fee and an "imitation penalty", meaning bonding-curve price impact from the leader's own buy. — [arXiv 2601.08641](https://arxiv.org/html/2601.08641v2)
- The same paper's bot taxonomy:
  - Bundle bots: the creator plus other wallets buy in the launch block. Found in about 1/4 of projects, and linked to lower returns and shorter dumps.
  - Gradual bundles: buys spread over several blocks, funded through multiple layers, so they are harder to detect.
  - Sniper bots: in most projects, with limited performance impact.
  - Bump bots: buy and sell identical amounts to fake activity.
  - Comment bots.
  - A "bait and exit" pattern, where KOLs featured on tracking platforms attract copiers and then coordinated wallets sell into the demand they created. The paper calls copiers "exit liquidity". — [arXiv 2601.08641](https://arxiv.org/html/2601.08641v2)
- [opinion/review] A PREreview of 2601.08641 attributes the smart-money vs copier gap to the bonding curve: an immediate copier pays a higher price. — [Zenodo PREreview](https://zenodo.org/records/22679925)
- [measured, journalist report of an anonymous team] TokenPost (2026-10-20), from about 2 weeks of first-buy data starting late Aug 2026: >1M pools, 7.7M wallets, 384M swaps on Pump.fun and Stonk. — [TokenPost](https://www.tokenpost.com/news/investing/35409)
  - Entering 2 minutes after large clusters (450-2,000 wallets that buy in the first 1-2 min) lost -41% per token over 93 tokens, with a median of -95%.
  - Only tightly connected groups made money: about +10%/token over 16 tokens.
  - Following clusters with positive records: -11%/token. A single-wallet backtest: -20%/trade.
  - A simulated take-profit-at-2x / exit-after-a-40%-drop rule: -19%/trade after costs.
  - A neural-net picker raised the share of picks that doubled from about 10% to 26%, but still lost money on every one of the 8 days tested (about -11% mean).
  - No delay shorter than 2 minutes was tested.
- [simulated, blog] Kurnovskii (2025-12-20) simulated 100,000 attempts to copy the top 50 leader wallets on pump.fun data. — [Kurnovskii blog](https://romankurnovskii.com/en/blog/pumpfun-copy-trading-feasibility/)
  - Win rate: 82% with zero latency, 46% at 0.5 s, 28% at 1.0 s, 4% at 5 s.
  - Copying is called a "mathematically guaranteed losing strategy" at latencies of 2 s or more. Slippage reaches 46.5% for a 10 SOL leader buy at 5 s.
  - Advises against copying wallets that hold for less than 5 minutes.
  - In the same data, manual retail traders who held more than 5 minutes had an 87.6% loss rate.
  - Latencies are fixed scenario inputs, not measured. The data provider is not named.
- [measured, pre-registered paper trading] Arrow Algo lab, 17-26 Oct 2026. Not a wallet-copy study, but it sets the baseline for late, outsider entries. — [Arrow Algo](https://arrowalgo.com/solana-memecoin-trading/)
  - Setup: bought every gated token at 30 minutes old with 20 s latency, 1.25%/leg fees and 1% slippage.
  - Mean return: -31.4% at 1 h, -61.8% at 6 h, -55.7% at 24 h (1,411 tokens).
  - None of the 416 strategies tested had a significantly positive mean out of sample. The best in-sample strategy (+85.2%) lost -81.2% out of sample.
  - The article states that insiders, creators, bundlers and snipers capture the gains, and that outsiders cannot get those positions.
- [anecdote/commentary] Surf AI argues that visible launch-stage signals mostly serve as exit liquidity for earlier entrants. — [AskSurf](https://asksurf.ai/pulse/en/public-memecoin-alpha-execution-latency). A Medium write-up argues that once a wallet gets enough followers its picks become self-fulfilling, which invites wallets to farm their own followers. — [Medium, N. Baldwin](https://medium.com/@nathan.baldwin_31153/copy-trading-on-solana-how-to-find-alpha-wallets-without-getting-faked-out-by-bots-0bc550f07290)
- [measured, non-memecoin] On a public-identity DEX limit order book (17.1B messages, 147,113 wallets, $84.3B taker notional; venue not named in the abstract):
  - Wallet rankings by post-trade price movement persisted across adjacent 10-day windows (rank correlation 0.52), with the persistence concentrated in the top decile.
  - Adding live activity of the top-ranked wallets raised out-of-sample 1-second-return R² to 12.31%.
  - This shows informed-wallet skill can persist, but it applies to an order-book venue at 1 s horizons, not to pump.fun curves. — [arXiv 2608.04373](https://arxiv.org/abs/2608.04373)
- [claim, unverified] A Medium post claims top wallets kept an 81.5% win rate out of sample, with $37.7M combined PnL for the top 200 over 15 days. No methodology is given. — [Medium, R. Therani](https://medium.com/@rakesh.therani/the-memecoin-trading-encyclopedia-35-concepts-backed-byproduction-data-6745ab79d1c9)

### Inferences
- How the edge decays, put together from the sources above: on a curve, the copier's cost per trade is roughly the leader's own price impact, plus everything other buyers add in the gap, plus the fees on both sides (about 2-2.5% round trip at 1-1.25%/side).
  - For fast leaders (in the same slot or 1 slot late, holding seconds to minutes), the leader's gross edge (+6.6% in our data) is about the same size as that cost, so even 1 slot of delay flips the sign. This matches our own +6.6% → -3.9%.
  - The wallets most worth copying at 1-2 s latency are slow ones: entry minutes after launch, holds of more than 5-10 minutes, and small size relative to curve depth. ARu4n5mF (entry about 3.5 min after launch, holds about 12 min, 131 coins, +85 SOL) fits this profile. Its signal decays slowly enough that a 1-2 s copy should give up only a small share of the edge. This is the case the literature does not cover, and it should be tested directly.
- Ways tracked wallets punish copiers, as documented: buying while side wallets sell (the KOL pattern, section 2), bump/wash trades of identical size that create fake signals, and gradual bundles whose wallets look "smart" only because they are insiders. A copier cannot get insider timing, so wallets whose PnL comes mostly from launch-slot entries are unusable signals by construction.
- Selecting wallets on past PnL alone, as the statistical baselines in 2601.08641 did, produced negative copier returns. So a wallet's PnL is necessary but not sufficient. The filter has to score whether the edge survives our own entry price, not whether the wallet is profitable.

### Gaps
- No study measures copier return as a function of delay in slots/seconds on real pump.fun fills. Kurnovskii's curve is simulated, and TokenPost tested only 2 minutes.
- No published measurement of bait trades: wallets that deliberately make small "bait" buys to trigger copy bots and then sell into them. It is described qualitatively only.
- The appendix of 2601.08641 with the execution model (A.6) was not read in full, so its assumed copier delay is unknown.

## 2. KOL wallets: is buying before or with KOL calls profitable, and do KOLs dump on followers?

### Takeaway
The measured evidence says KOLs and their side wallets enter before the public call and sell within minutes into follower demand. Coins promoted by influencers lose most of their value over weeks to months. The only window with positive expectancy is the first seconds to minutes around the call, and that window is already taken by the KOL's own side wallets, which buy about 20 s before the call.

### Cited Findings
- [estimate, on-chain clustering] Bubblemaps, "Crypto KOL Moves Onchain" (published 2026-11-05). — [Bubblemaps blog](https://blog.bubblemaps.io/bubblemaps-investigates-crypto-kol-moves-onchain/); secondary coverage: [TechFlow](https://www.techflowpost.com/en-US/article/34592), [KuCoin news](https://www.kucoin.com/news/flash/bubblemaps-investigates-four-crypto-kols-finds-wallet-activity-contradicts-public-narratives)
  - Anglio (534 posts in October): 5 linked wallets bought before 61% of his calls, on average about 20 s ahead, and sold a few minutes later. Estimated profit about $130k; Anglio admitted using these methods. Secondary coverage says the side wallets started dumping about 4 min after the call on average, with the public wallet making the last sales.
  - 0xEthan (about 88k followers, last 49 calls): typically sold within 3 minutes of a call. Three side wallets bought in the same second as his public wallet, and in some cases he was selling while still promoting the token. Estimated $45k from trades plus $80k from pump.fun callout rewards.
  - Solstice (about 200k followers): the promoted coins were bundled (dozens of fresh wallets each holding 0.5-1% of supply), and his public wallets traced back to the token deployers. Public wallet about -$70k, side wallets about +$270k.
  - Kimchi: a rumored $40M from $TRUMP was estimated at about $6M.
- [claim, single secondary source] Cupsey's public wallet allegedly bought while 12 side wallets sold into followers, for about $1.7M. — [AirdropAlert](https://airdropalert.com/blogs/cupsey-bubblemaps-side-wallets/)
- [measured, peer-reviewed] Merkley, Pacelli, Piorkowski & Williams, "Crypto-Influencers" (Review of Accounting Studies). — [HBS Working Knowledge](https://hbswk.hbs.edu/item/when-celebrity-crypto-influencers-rake-in-cash-investors-lose-big); [ProMarket](https://www.promarket.org/2023/04/17/crypto-influencers-give-poor-investment-advice-and-the-sec-is-taking-notice/)
  - Data: about 36,000 tweets from 180 influencers on more than 1,600 assets, through Dec 2022, using daily CoinGecko prices.
  - Mean return after a tweet: +1.83% on day 1, -1.02% from day 2 to 5. Cumulative: -2.24% at 10 days, -6.53% at 30 days, -18.90% at 90 days.
  - The effect is strongest for self-described experts with many followers. The authors say followers profit only by exiting shortly after the tweet.
  - Uses daily resolution, so it cannot see pump.fun's minute-scale dynamics.
- [measured, industry study] CoinWire (Nov 2024): 1,500+ (or 1,567) memecoins promoted by 377 X accounts with more than 10k followers. — [ForkLog](https://forklog.com/en/most-promoted-memecoins-on-x-plummet-by-90/); [Benzinga](https://www.benzinga.com/markets/cryptocurrency/24/11/42169183/dont-get-fooled-by-the-success-of-dogecoin-shiba-inu-76-of-x-twitter-influencers-promote-d)
  - 86% of the coins fell 90% or more within 3 months, and 80% lost 70% within a week.
  - Accounts with more than 200k followers: -39% average after 1 week, -89% after 3 months.
  - Only about 1-3% of promoted coins reached 10x (sources disagree on the figure).
  - Influencers earned about $399 per promotional tweet.
- [measured, pre-registered] In the Arrow Algo lab, tokens promoted on X lost -60% to -95% at 6 hours. — [Arrow Algo](https://arrowalgo.com/solana-memecoin-trading/)
- [measured] Szwajcok et al. found that 23.5% of pump.fun coins were created shortly after Twitter/Truth Social posts, and estimated that 31 posts each had at least $1M of extractable value. — [arXiv 2609.10246](https://arxiv.org/html/2609.10246v1)
- Infrastructure: Arkham labels the wallets of KOLs with more than 100k X followers. — [BeInCrypto](https://beincrypto.com/arkham-tracking-crypto-influencers-meme-coins/). Kolscan, a KOL leaderboard, was acquired by and integrated into pump.fun in mid-2025. — [Kalkine](https://kalkinemedia.com/education/guides/kolscan-how-solanas-smart-money-gets-ranked); [Bitget DApp](https://web3.bitget.com/dapp/kolscan-29881)
- [opinion] Nansen's analyst says smart money rotates out of memecoins quickly. — [Cointelegraph](https://cointelegraph.com/news/smart-money-hunting-meme-tokens-end-memecoin-supercycle)

### Inferences
- Public KOL wallets are the worst wallets to copy. Their public trades are partly a decoy: the edge sits in the side wallets, and the public wallet is often a loss leader or the final seller. Since pump.fun pays callout rewards (0xEthan's $80k), KOLs have an incentive that does not depend on their followers making money.
- A testable edge might exist if we detect KOL side wallets in our data: wallets that repeatedly buy about 20 s before a known KOL wallet in the same coins. But that is the "front-run the front-runner" trade, and Bubblemaps says the side wallets themselves sell after a few minutes. At best it would be a short scalp, with the same latency limits as section 1.
- A fade or avoid filter has better evidence behind it than following. Coins whose buyers include known KOL wallets, or wallets linked to them, have measured negative drift after the call.

### Gaps
- Lookonchain and ZachXBT publish case studies, not systematic measurements. No systematic Lookonchain or ZachXBT KOL study turned up in this search.
- No study measures minute-level returns on pump.fun curves around KOL entries, which would separate the "first 60 s" window from later entries.

## 3. Deployer, insider and bundle networks and volume bots: detection, and whether to avoid them or trade alongside them

### Takeaway
Insider networks are very common, and they are where the documented profit goes. In Bitquery's census, devs and bundled wallets made at least $579M after fees, against $31.5M for snipers and $22.7M for unlinked early buyers. Launch-slot bundles can be detected cheaply from the launch transaction and the next four transactions in block 0 (one Jito bundle). Funding-graph links add little to that test, but they are needed to catch gradual bundles and "factories". There is no evidence that a retail bot at 1-2 s latency can profit by trading alongside them. Following funding-network "teams" only looked profitable in hindsight, and most of that profit was unrealized marks. Avoidance is better supported, but avoiding bundled coins alone does not make the remaining universe profitable.

### Cited Findings
- [measured, method-dependent] Bitquery, covering 8.2M of 9.1M pump.fun coins launched 2025-10-30 to 2026-10-07 (profits to end of June 2026, measured over launch day plus 2 days, after the 1.25% fee). — [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles)
  - Who buys in block 0:
    - A non-dev wallet bought in block 0 on 38% of coins, and within the first 3 blocks on 50%.
    - Dev-owned wallets bought in block 0 on 21% of coins (median 10% of supply), and took more than 50% of supply on 2% of bundled launches.
    - Sniper bots bought in block 0 on 28% of coins, and both bundles and snipers on 12%.
    - On 24% of launches nobody but the dev traded.
  - The dev's first sale came within 1 minute on 65% of coins, and within 1 day on 90%.
  - Who made money:
    - Devs and bundled wallets: at least $579M ($529M if unsold holdings count as zero). They came out ahead on 71% of bundled launches, and the top 1% of launches made 65% of their profit.
    - 25,882 sniper wallets spent $440M and made $31.5M ($15.2M if unsold holdings count as zero). 54% of sniper wallets came out ahead.
    - Devs without bundles made $84.3M, and unlinked early buyers $22.7M.
    - From July 2026, 61% of September's bundled purchases were single buys of 1,000 SOL or more, with the money flowing out through other wallets.
  - Classification rules:
    - A dev-owned wallet buys in the launch tx, has its fee paid by the dev, or buys in the 4 txs immediately after the launch (a Jito bundle holds at most 5 txs). In a check, 185 of 186 purchases in those slots were in the launch's Jito bundle, and none of the 139 further down were.
    - A sniper is any other buyer in the first 3 blocks of launches by at least 10 different devs.
    - Adding a SOL-funding-link test added only 0.4% more bundled launches.
    - Wallets that buy and sell within one transaction (volume bots) were excluded.
  - Caveats: a launch service bundling for its customers looks identical, and token transfers are not counted, so the totals are floors.
- [measured] Szwajcok et al., "Meme Coin Factories" (arXiv 2609.10246): 15.2M pump.fun coins, 2024-01-14 to 2026-01-14, with 1% and 5-day transaction samples. — [arXiv 2609.10246](https://arxiv.org/html/2609.10246v1)
  - Wash trading:
    - At least 17% of trading transactions are wash trades: the same address buys and sells the same amount in one tx. These are only about 1.3% of SOL volume.
    - Wash-traded coins graduate at 2.0%, against 0.90% for other coins.
  - Funding clusters and dumps:
    - Clustering creators by shared funding up to 3 hops: the top 1% of creator clusters make about 58.6% of all coins (38.9% without clustering).
    - Coordinated dumps (several wallets send tokens to one seller): about 4,400 cases in the 1% sample, median 7 senders.
  - Copycats are at least 10% of coins (1.5M or more) and graduate at 0.86%, against 9.20% for the originals they copy.
  - Copycat addresses lack the "pump" vanity suffix more often (26.5% vs 13.7%), a sign of automated deployment.
  - Four websites and 14 GitHub repos sell manipulation-as-a-service.
  - The authors stress that correlation is not safety. Wash-traded or clustered coins graduating more often does not make them good buys.
- [measured] Pine Analytics, "Exit Liquidity Machines" (Apr 2025). — [Pine Analytics Substack](https://pineanalytics.substack.com/p/exit-liquidity-machines); [BeInCrypto](https://beincrypto.com/pump-fun-meme-coin-snipers-systematic-problem)
  - Up to 1.75% of launches, more than 15,000 tokens, had snipers directly funded by the deployer. The test looked for SOL transfers between deployer and sniper before launch.
  - 85% of these snipers exited within 5 minutes, and 90% sold in 1-2 swaps.
  - About 50% of launches had some sniping, mostly ordinary bots.
  - An "87%" success figure appears only in Korean coverage with ambiguous wording, and is unverified.
- [measured, hindsight] Gafarov, "Retrospective Analysis of Team-Following Trading Profitability in Pump.fun Meme Coins Using Funding Networks" (arXiv 2611.11436, Nov 2026). — [arXiv 2611.11436](https://arxiv.org/html/2611.11436)
  - Data: ten windows of 24-79 h each, Apr 2024 to Sep 2026.
  - Teams: SOL-funding descendants of root creators that have a "seed" token reaching 60 SOL or more.
  - Strategy:
    - Entry 4 s after the team (tested from 1 to 60 s).
    - Size: 10% of free cash, capped at 0.1 SOL.
    - Base costs: 1% fee/side and zero slippage.
    - Exits at each team's hindsight-optimal reserve threshold.
  - Equity ended above 1 SOL in all 8 windows that had a qualifying team, but free cash ended above 1 SOL in only 5. Marks were 17-94% of equity. Random cohorts had medians of at most 1.06 SOL.
  - With causal (online) recognition, 9 of 19 teams were identifiable only after their last launch, so they could not be followed.
  - Cutting delay from 4 s to 1 s raised geometric mean equity from 3.82 to 4.20 SOL, but the author calls this "not systematic".
  - Team existence is fragile. In 2026-09, adding WSOL edges moved the top index from 596.6 to 5.9.
  - The author's conclusion: "conditional retrospective model accounts, not executable profits". A pre-registered prospective test is needed.
- [measured, single-author preprint] A study of first-hour buyer flow detected 1,012 persistent sniper cohorts of 2-12 wallets (2,965 wallets), and discusses the limits of naive causal inference. — [ResearchGate](https://www.researchgate.net/publication/408521585_Coordinated_Sniper_Cohorts_on_Pumpfun_Detection_of_1012_Persistent_Wallet_Rings_and_the_Limits_of_Naive_Causal_Inference_for_First-Hour_Buyer_Flow)
- [measured] Arrow Algo's creator filter (first-time creator, no bundled buys) lost -44% at 6 h, against -82% for the other launches. Avoiding bundles reduced losses but did not make the strategy profitable. — [Arrow Algo](https://arrowalgo.com/solana-memecoin-trading/)
- [practitioner heuristic] A few percent of same-block buying is normal. The real warning sign is a bundle of wallets with a common funding origin holding 20-40% of supply. — [Raiden terminal blog](https://terminal.raiden.wtf/blog/pump-fun-bundle-checker)
- [claim, second-hand] Solidus Labs is quoted as saying 98.7% of pump.fun tokens showed pump-and-dump or rug characteristics. The original was not checked. — [BloFin academy](https://blofin.com/en/academy/education/pumpfun/pump-fun-bundling-explained)

### Inferences
- These detection rules map directly onto our data, which already has slot, wallet, SOL and transaction order:
  1. Wallets in the launch tx or the next ≤4 txs of the launch slot (Jito bundle) are dev-owned.
  2. The same SOL amount repeated across many coins by the same wallet set marks a deployer or a service. Our 2.21 SOL × 30-50 coins pattern is an example.
  3. Buy-and-sell of the same amount within one tx or a few slots marks wash or bump trading. Exclude it from volume and trade counts.
  4. A wallet that buys in the first 3 blocks across launches by at least 10 devs is a sniper (Bitquery rule).
  5. Funding links (up to 3 hops) find gradual bundles and factories. They need SOL transfer data, which our curve-trade recorder does not capture.
- The wallets we found most profitable (deployers in the launch slot, and fast bots on paid landing) are exactly the classes the literature shows cannot be copied: insider timing, or speed we do not have. Excluding them from copy candidates is right. Their real value is as a feature: "dev-owned wallets hold X% of supply" and "dev has sold" (our dev-sell rule v1) as avoid or exit signals. Bitquery's data (dev's first sale within 1 min on 65% of coins) suggests the dev-sell signal fires often and early.
- Trading alongside deployers is possible only if we can predict the next launch from a known factory and buy within 1-2 s. Gafarov's hindsight study had a 4 s delay and still found mostly unrealized marks and fragile team definitions. I found no evidence it pays after fees out of sample.

### Gaps
- No study reports per-token outcomes (graduation rate, follower return) for bundled vs non-bundled coins under the same entry rule. Bitquery gives only aggregates.
- Volume-bot prevalence on pump.fun in late 2026, beyond the 17% wash-trade lower bound up to Jan 2026, was not found.
- Whether Mayhem-mode coins (excluded by Bitquery) change these patterns was not covered.

## 4. Wallet-tracking tools and the free data/APIs they expose (2026)

### Takeaway
GMGN, Cielo, Axiom, Photon, Nansen, Birdeye, Kolscan (now part of pump.fun), Solana Tracker and MadeOnSol all rank wallets by PnL. Their free tiers mostly offer alerts and UI leaderboards; programmatic wallet PnL is usually paid or rate-limited. None publishes verified copier returns. Their leaderboards are also the KOL "bait" surface described in 2601.08641. Since we record every curve trade ourselves, we can compute better per-wallet PnL than these tools. GMGN's PnL reportedly does not reliably deduct priority fees and tips.

### Cited Findings
- GMGN: a third-party guide says the Agent API is free to register for, reads are free, and trades through it pay GMGN's 1% fee. It also says displayed PnL does not reliably deduct priority fees and tips. — [gmgnaiapp.com guide (unofficial)](https://gmgnaiapp.com/api/gmgn-api/). An unofficial parse.bot listing (Jun 2026) shows credit tiers from $0 to $1,000/month, with a free tier of 200 credits at 5 requests/min. — [parse.bot](https://parse.bot/marketplace/042b4dd6-3a7e-4d36-a81d-90fb8557a9db/gmgn-ai-api). Not confirmed against GMGN's own docs.
- Cielo: a review puts the free tier at 50 Solana and 250 EVM wallets with 120 alerts/hour, and Pro at $59/month. — [WalletMaster](https://www.walletmaster.tools/blog/best-cielo-alternatives/). The API charges credits, for example 20 credits for profitability/performance stats and 5 for token PnL. — [Cielo docs](https://docs.cielo.finance/api-reference/wallet-pnl-and-stats); [Cielo developer reference](https://developer.cielo.finance/reference/gettokenspnl)
- Birdeye: Pro is about $45/month per Solana Compass (Oct 2026); another blog says $9/month, which conflicts. API plans start at $39/month (Lite). The free Standard tier has basic price and token-list endpoints, and wallet PnL appears to be paid. — [Solana Compass](https://solanacompass.com/projects/birdeye); [WalletMaster GMGN alternatives](https://www.walletmaster.tools/blog/best-gmgn-alternatives/)
- Solana Tracker Data API: KOL leaderboards at `/v2/pnl/leaderboard/kols` and `/v2/pnl/leaderboard/kols/period` (7d, 30d, or custom dates), plus an all-wallet top-trader board over 1, 7, 30 or 90 days. — [Solana Tracker docs](https://docs.solanatracker.io/guides/pnl-v2/leaderboards); [KOL tracking guide](https://docs.solanatracker.io/guides/kol-tracking)
- MadeOnSol tracks more than 1,000 KOL wallets, with 7d, 30d and all-time PnL boards, a KOL API and deployer scoring. — [MadeOnSol KOL tracker](https://madeonsol.com/kol-tracker); [MadeOnSol KOL API blog](https://madeonsol.com/blog/how-to-track-kol-wallets-solana-api); [Deployer analysis 2026](https://madeonsol.com/blog/pump-fun-deployer-analysis-2026-561k-wallets)
- Kolscan: started as kolscan.io, was acquired by pump.fun in mid-2025 and integrated into it. It shows KOL real-time trades, token PnL and a leaderboard. — [Kalkine](https://kalkinemedia.com/education/guides/kolscan-how-solanas-smart-money-gets-ranked); [Bitget DApp](https://web3.bitget.com/dapp/kolscan-29881)
- Arkham labels KOL wallets (more than 100k X followers). — [BeInCrypto](https://beincrypto.com/arkham-tracking-crypto-influencers-meme-coins/). Bubblemaps maps clusters among the top 150 holders. — [Ledger Academy](https://www.ledger.com/academy/basic-basics/bull-run-security/dyoring-the-memecoin-madness-must-know-tools)
- Data used by researchers: Flipside account-level Solana data (2601.08641), Bitquery DEX trades plus transfers (Bitquery investigation), and Jito's public bundle explorer for checking bundles. — [arXiv 2601.08641](https://arxiv.org/html/2601.08641v2); [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles)
- [marketing claims] Vendor pages say sub-400 ms copy bots work and that copy trading is the best beginner strategy. They give no verified performance. — [uwuu.ai](https://uwuu.ai/blog/how-to-trade-memecoins)

### Inferences
- The leaderboards' one use for us is as a list of contaminated wallets. A wallet visible on GMGN, Kolscan or Solana Tracker attracts copiers, so it is a candidate for bait behavior and its edge is crowded. Wallets that are profitable in our data but missing from public KOL lists may be less crowded.
- For transfer and funding links, which our recorder lacks, the cheapest sources are probably RPC `getSignaturesForAddress` on candidate wallets, Bitquery, or Flipside. Their free-tier limits in 2026 were not verified.

### Gaps
- Official 2026 pricing and free-tier limits for GMGN, Axiom, Photon and Nansen were not confirmed from first-party pages. Axiom and Photon are trading terminals with built-in wallet tracking, and I found no public data API documentation for either.
- No tool publishes audited copy-trading performance for its users.

## 5. How to test these strategies on our recorded data

### Takeaway
The literature's main failure is hindsight selection: wallets, teams and thresholds chosen on the same data they are evaluated on. 2601.08641 used a chronological 70/15/15 split, and Gafarov showed that hindsight results shrink sharply under causal recognition. Our data has every curve trade with wallet, slot, SOL, tokens and reserves, so we can run a correct walk-forward test: pick wallets in period A, then replay copy entries in period B at our real latency, with entry prices recomputed from the reserves.

### Cited Findings (methods to borrow)
- Chronological split by each trader's first transaction in a coin, and wallet features over prior coins (returns on prior coins 1-5, 6-10, 11-15, trade count, volatility, t-stat > 1.645, entry timing, bot flags). — [arXiv 2601.08641](https://arxiv.org/html/2601.08641v2)
- Pre-register the rules and costs (hash them), hold out a later period, correct for multiple testing, and report results without the top 10 trades. — [Arrow Algo](https://arrowalgo.com/solana-memecoin-trading/)
- Online (causal) recognition of who to follow, random-cohort nulls, cash locking, and reporting realized cash separately from marks. — [arXiv 2611.11436](https://arxiv.org/html/2611.11436)
- Wallet rankings persisted across adjacent 10-day windows on another venue (ρ = 0.52, concentrated in the top decile). This is a reference point for measuring persistence in our data. — [arXiv 2608.04373](https://arxiv.org/abs/2608.04373)
- Bundle and sniper labeling rules (launch tx + 4 txs; ≥10 devs in the first 3 blocks; exclude same-tx buy/sell). — [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles)

### Inferences (proposed test design)
1. **Universe and labeling (period A, e.g. 7-14 days):**
   - Compute per-wallet realized PnL after a 1.25% fee/side and estimated priority fees.
   - Label each wallet as one of: deployer/bundle (launch tx + 4 txs of the launch slot; or the same SOL size across ≥10 coins in block 0), sniper (first 3 blocks across ≥10 devs), wash/bump (same amount bought and sold within ≤2 slots), or "other".
   - Keep "other" wallets with at least 30 coins and a t-stat gate on per-coin returns.
   - Record each wallet's entry-age and hold-time distributions.
2. **Copy replay (period B, the next 7 days, no reselection):**
   - For each signal (a selected wallet's buy), simulate our buy at signal slot + d, for d = 1, 2, 3, 5, 10 slots and 2 s, 5 s, 30 s.
   - Reprice from the reconstructed reserves at that slot, including all trades in between and our own price impact.
   - Exit rules to compare: (a) mirror the wallet's sell with the same delay; (b) fixed hold equal to the wallet's median hold; (c) our dev-sell rule.
   - Report the mean and median per trade and realized SOL, with and without the top 10 trades.
3. **Measure the decay curve:** plot copier return against d, per wallet class. Check whether returns are cut far less by delay for slow wallets (entry age ≥ 60 s, hold ≥ 5 min) than for fast ones. The ARu4n5mF profile is the test case.
4. **Crowding and bait checks:**
   - For each selected wallet in period B, measure how much other buying lands within 1-3 slots after its buys. That buying is the copier crowd.
   - Check whether the wallet sells into it: does its sell size correlate with buys from known copy bots?
   - Measure whether the wallet's PnL falls as its copier count rises. If it does not, the wallet may be profiting from its copiers.
5. **Avoid-filter test:** on the base entry strategy (dip entry, the normal/Mayhem split), add exclusions for dev-owned share > X% at entry, the presence of known factory wallets (same-size deployer sets), and KOL-linked buyers. Compare out-of-sample.
6. **Robustness:**
   - Roll the A→B windows forward, for example weekly.
   - Compare against random wallet cohorts with the same activity, following Gafarov's nulls.
   - Report how many selected wallets stay active in B. Wallet churn is likely high, since deployers rotate wallets.
7. **Limitation of our data:** no SOL-transfer graph, so gradual bundles, side wallets and factory links are invisible. If those results matter, add transfer collection for candidate wallets only.

### Gaps
- No published walk-forward copy test at 1-10 slot delays on pump.fun exists to benchmark against. Our results would be novel, but we cannot validate them against the literature.
- I found no evidence on how often slow, profitable non-deployer wallets like ARu4n5mF exist or persist across periods. That is the key unknown the test above would answer.
