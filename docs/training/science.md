# Training science library

The research the app's training logic is judged against. One recreational lifter, 3–4 days a week, upper/lower split, logging weight × reps × RPE in Hevy. Each topic says what the research found, how sure we can be, and the papers behind it; the numbered **practical rules for the app (S1, S2, …)** at the end turn that into checks code and reviews can cite ("S11 says a stall needs ≥ 3 weeks").

The `training-scientist` agent (`.claude/agents/training-scientist.md`) reads this file first and judges the app and the owner's results against it.

## How it was made

- **Peer-reviewed sources only:** randomized trials, systematic reviews, meta-analyses, consensus papers and position stands. No blogs, no coaching sites, no commercial pages.
- **Each paper was checked on PubMed on 27.11.2026** (NCBI E-utilities): its title, authors, journal, year, DOI and PMID were copied from the PubMed record and its abstract was read there. Where the abstract had no numbers, the full text was opened (PubMed Central, Europe PMC, or the authors' repository copy) — this is said where it happened.
- **Flags:**
  - **Preprint** — not peer reviewed. Only the detailed numbers of Pelland et al. (§6.1) come from one, and every place they are used says so.
  - **Expert practice** — a rule experts use that no trial has tested (for example the double-progression trigger).
  - **App choice** — a threshold this library picks inside what the evidence allows (for example the ±2-day "moved" window). It is not a value a study measured.
  - **Narrative review** — a review that is not systematic.
- Two earlier research notes were merged here: load progression and autoregulation (sections 1–4) and volume, frequency and scheduling (sections 6–10). Section 5 (estimated 1RM) was added in the same build, checked the same way.

## How to extend it

- Run new research the same way: PubMed first, peer-reviewed sources only, read the abstract (and the full text when the numbers are not in it), copy the citation from the PubMed record. **Never** a blog, a coaching site, a forum or a product page — not even as a lead you then cite.
- Add a new topic as a new section (or a new subsection), with its claim, numbers, confidence and citations in the same shape as the others. Write the date it was checked.
- A new practical rule takes the **next free S number**. Never renumber or reuse an S number: code comments and reviews cite them. A rule that is no longer right is marked **withdrawn** with the date and reason, and stays in the list.
- Flag a preprint, an expert-practice rule, an app choice and a narrative review as above.
- The `training-scientist` agent writes a finding as a proposed addition; the lead adds it here in a PR.

## Confidence labels

- **High** — several meta-analyses agree.
- **Moderate** — one good meta-analysis, or consistent randomized trials.
- **Low** — small trials, mechanism studies, expert opinion, or a rule this library derives from indirect evidence.

## Words used here (plain explanations)

- **1RM (one-repetition maximum):** the heaviest weight you can lift once. "80 % 1RM" means 80 % of that weight.
- **e1RM (estimated 1RM):** a 1RM worked out from a heavier-than-light set (for example 80 kg × 8) with a formula, instead of tested. It is an estimate (§5).
- **RIR (repetitions in reserve):** how many more reps you could have done before failing. Stop a set of 8 when you could have done 2 more: that is 2 RIR.
- **RPE (rating of perceived exertion), RIR-based:** a 1–10 score tied to RIR. RPE 10 = 0 RIR (no rep left). RPE 9.5 = no rep left, but you could have used a little more weight. RPE 9 = 1 RIR. RPE 8.5 = 1–2 RIR. RPE 8 = 2 RIR, and so on down (Helms et al. 2016, 2018).
- **Momentary failure:** you try a rep and cannot finish it.
- **Autoregulation:** adjusting today's weight or sets from how you perform today (RPE, reps, bar speed) instead of from a fixed plan.
- **Double progression:** keep the weight and add reps until you reach the top of a rep range (for example 3 × 8–12), then raise the weight and start again near the bottom.
- **APRE (autoregulatory progressive resistance exercise):** a fixed set scheme where the reps you manage in an all-out set decide next week's weight.
- **Set volume:** hard sets per muscle per week. A hard set is a working set taken reasonably close to failure; warm-ups don't count. Example: 3 sets of bench press + 3 sets of dips = 6 chest sets that week.
- **Direct and indirect sets:** a curl is a direct set for the biceps. A row is an indirect set for the biceps: it works them, but they are not the main target.
- **Fractional counting:** a direct set counts 1, an indirect set 0.5. Example: 4 curls + 6 rows = 4 + 3 = 7 biceps sets.
- **Frequency:** how many separate days in a week a muscle is trained.
- **Volume-equated:** two groups do the same weekly sets and differ only in how they are spread across the week.
- **MPS (muscle protein synthesis):** the rate at which muscle builds new protein. It rises after a workout and falls back over the next day or two.
- **Detraining:** stopping training, and the losses that follow.
- **Deload:** a planned easier period, usually about a week with fewer sets or lighter loads (sometimes no training at all), meant to shed fatigue.
- **Meta-analysis:** a study that pools the results of many studies. A **meta-regression** also fits a curve, for example "how much more growth per extra set".
- **Effect size (ES / SMD, standardized mean difference):** how big a difference is, measured in standard deviations. Roughly: 0.2 small, 0.5 medium, 0.8 large.
- **95 % CI / CrI (confidence or credible interval):** the range the true value probably lies in. If it crosses zero, the study could not show a real difference.
- **CV (coefficient of variation):** typical day-to-day scatter as a percentage. CV 5 % on an 80 kg load is about ±4 kg from day to day.
- **SEE (standard error of the estimate):** the typical miss of a prediction formula, in the formula's own unit (kg here).

---

## 1. Progression and load

### 1.1 When should load increase? What the position stands say

**Claim.** The ACSM 2009 position stand says to raise the load by **2–10 %** once you can do **1–2 reps more than the target** with the current weight. Novices should train with an 8–12 RM load. Intermediate and advanced lifters should use 1–12 RM, periodized, with more heavy work (1–6 RM) for strength and an emphasis on 6–12 RM for hypertrophy. The 2026 ACSM update (an overview of 137 systematic reviews) keeps "perform progressive RT". It found that strength responds best to **≥ 80 % 1RM** loads, 2–3 sets, full range of motion, and ≥ 2 sessions a week. Hypertrophy responds best to **≥ 10 sets per muscle per week**. Training to failure and periodization models did **not** consistently change outcomes.

**From the full text (earlier repo check, not re-opened on 27.11.2026).** The app's earlier fact-check (`docs/training-health/research/verify-science.json`) quotes the ACSM 2009 full text: the 2–10 % step applies when the lifter does 1–2 reps over target **"on two consecutive training sessions"** (Evidence category B), with the **lower percentage for small-muscle exercises and the higher for large-muscle ones**. It also notes ACSM gives no upper-body/lower-body sub-bands: splits such as "2.5–5 % upper, 5–10 % lower" are a practitioner convention.

**Practical rule it supports.** Suggest a load increase only after the lifter has done **more** than the target reps with the current load, not as soon as they reach the target once. The step should be small, a few percent.

**Numbers.** 2–10 % step. Trigger: 1–2 reps over target (on two consecutive sessions, per the full text). ACSM 2026: strength ≥ 80 % 1RM; hypertrophy ≥ 10 sets/week.

**Confidence: moderate.** Expert consensus statements built on systematic reviews. The specific "2–10 % after 1–2 extra reps" rule is practice wisdom (**expert practice**): no trial has tested it against alternatives.

**Citations.**
- American College of Sports Medicine. Progression models in resistance training for healthy adults. *Med Sci Sports Exerc.* 2009;41(3):687–708. DOI 10.1249/MSS.0b013e3181915670 · PMID 19204579.
- Currier BS, D'Souza AC, Singh MAF, et al. ACSM Position Stand. Resistance training prescription for muscle function, hypertrophy, and physical performance in healthy adults: an overview of reviews. *Med Sci Sports Exerc.* 2026;58(4):851–872. DOI 10.1249/MSS.0000000000003897 · PMID 41843416 · PMC12965823.

### 1.2 Progress reps first, then load? (double progression)

**Claim.** Adding **reps at the same load** works about as well as adding load at the same reps, at least over 8 weeks in trained people. **Plotkin et al. 2022:** 43 trained participants, lower body, 4 sets × 4 exercises, twice a week. The REPS group (fixed load, reps added) and the LOAD group (fixed rep range, load added) had similar results. Rectus femoris growth modestly favoured REPS (+2.8 mm, 90 % CI −0.5 to 5.8). Smith-machine squat 1RM slightly favoured LOAD (+2.0 kg, CI −2.4 to 7.8). Other differences were negligible. The older practice of "add reps up to a ceiling, then add a fixed increment" is what Hostler et al. 2001 call the *traditional* progressive resistance method: in their study, a lifter who reached 7 reps on the final set added 2.2 kg to the bench press.

There is **no trial that tests double progression's exact trigger** ("all sets at the top of the range at ≤ RPE X") against other triggers. The rule is **expert practice**, consistent with ACSM 2009 (§1.1) and with the evidence that both reps and load are valid ways to progress.

**Practical rule it supports.** Double progression is a sound default. While a load jump isn't due, **more reps at the same load count as progress**, and the app should show them as progress rather than as a plateau.

**Confidence: moderate** that rep progression and load progression give similar results (one good RCT plus support from §4.1: hypertrophy is similar across a wide range of loads). **Low** for any specific trigger threshold: it is untested.

**Citations.**
- Plotkin D, Coleman M, Van Every D, et al. Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations. *PeerJ.* 2022;10:e14142. DOI 10.7717/peerj.14142 · PMID 36199287.
- Hostler D, Crill MT, Hagerman FC, Staron RS. The effectiveness of 0.5-lb increments in progressive resistance exercise. *J Strength Cond Res.* 2001;15(1):86–91. PMID 11708713 (no DOI listed in PubMed).

### 1.3 Smallest useful increments (microloading, dumbbell jumps)

**Claim 1: tiny increments work but are not proven better.** In Hostler et al. 2001, after 8 weeks of standard training, one group kept using 2.2 kg (bench) and 1.1 kg (triceps) steps. The other switched to 0.22–0.44 kg steps for 8 more weeks. Strength gains were similar. The authors add, from preliminary data, that the bigger standard steps *might* work better over a longer period. 19 people.

**Claim 2: one rep is worth about 2–3 % of 1RM near failure, and day-to-day noise is 3–6 %.** In Lovegrove et al. 2022 (15 young novice men), the load that left 1 RIR was 88 / 84 / 79 % 1RM on deadlift and 93 / 87 / 80 % 1RM on bench for sets of 3 / 5 / 8 reps. That is about 1.8 % (deadlift) to 2.7 % (bench) per rep. The test-retest scatter of the RIR-chosen load was CV 2.7–6.2 % (ICC 0.95–0.99). Helms et al. 2016 make the same point: 6 reps at 0 RIR ≈ 5 at 1 RIR ≈ 4 at 2 RIR ≈ 3 at 3 RIR at roughly the same load.

**What follows (derived, not tested directly).** A step bigger than about 2.5 % should cost about one rep for each 2–3 % of jump. Example: going from 10 kg to 12 kg dumbbells is a **+20 %** jump. At the same effort that costs roughly **7–10 reps**, more than the width of an 8–12 range. So a lifter who just hit 3 × 12 at 10 kg will likely manage only about 4–6 reps per set at 12 kg. Fixed increments such as +2.5 kg are a small percentage on a 100 kg squat (2.5 %) but a large one on a 10 kg lateral raise (25 %). A jump smaller than about 3 % sits inside normal day-to-day scatter, so on its own it does not show progress or the lack of it.

**Practical rule it supports.** Express increments as a **percentage of the working load**, not in fixed kilos. When the smallest available step is large (roughly > 10 %), ask for more reps above the top of the range before suggesting the jump, or suggest a wider rep range (for example 8–15), and accept that reps will reset to the bottom of the range, or below it, after the jump.

**Confidence: low–moderate.** The rep-to-load slope is supported by Lovegrove and Helms. The rule built on it is arithmetic, not a trial. The microloading evidence is one small study from 2001.

**Citations.**
- Hostler D, et al. 2001 (§1.2). PMID 11708713.
- Lovegrove S, Hughes LJ, Mansfield SK, Read PJ, Price P, Patterson SD. Repetitions in reserve is a reliable tool for prescribing resistance training load. *J Strength Cond Res.* 2022;36(10):2696–2700. DOI 10.1519/JSC.0000000000003952 · PMID 36135029.
- Helms ER, Cronin J, Storey A, Zourdos MC. 2016 (§2). PMID 27531969.

### 1.4 How fast to progress: novice versus trained

**Claim.** Strength gains are fastest early and slow down as a lifter gets stronger and more experienced.
- **Rhea et al. 2003 (meta-analysis, 140 studies, 1,433 effect sizes).** The largest gains came at about 60 % 1RM average intensity in untrained people and about 80 % in trained people. Untrained people gained most from 3 sessions per muscle per week, trained people from 2. Responses differed clearly by training status.
- **Latella et al. 2020.** 1,897 competitive powerlifters over 15 years. The average gain in the total (squat + bench + deadlift) was **about 0.12–0.15 kg per day**, roughly 4 kg per month across all three lifts. The strongest men gained about half as fast as the weakest quartile (0.10 vs 0.21 kg/day).
- **Steele et al. 2023.** Records of 14,690 adults (mean age 48) on minimal-dose training: 1 session a week, single sets to failure. Strength rose about 30–50 % in the first year, then flattened. It had practically plateaued by 1–2 years and was about 50–60 % above baseline after 6 years.
- **Lopez et al. 2021.** Untrained participants gained more muscle than trained ones for the same programme.

**Practical rule it supports.** "On track" depends on training age. A novice may add load nearly every session or week. A trained lifter's real strength trend is a few percent over several weeks, so judge progress from the **e1RM or reps-at-load trend over ≥ 3–4 weeks**, not session to session. Don't flag a stall after one or two flat sessions.

**Confidence: high** that progress slows with training age (meta-analysis, large registries and cohorts agree). **Low** for any exact "expected rate" for one recreational lifter: the registry data are competitive powerlifters and a supervised minimal-dose gym.

**Citations.**
- Rhea MR, Alvar BA, Burkett LN, Ball SD. A meta-analysis to determine the dose response for strength development. *Med Sci Sports Exerc.* 2003;35(3):456–464. DOI 10.1249/01.MSS.0000053727.63505.D4 · PMID 12618576.
- Latella C, Teo WP, Spathis J, van den Hoek D. Long-term strength adaptation: a 15-year analysis of powerlifting athletes. *J Strength Cond Res.* 2020;34(9):2412–2418. DOI 10.1519/JSC.0000000000003657 · PMID 32865942.
- Steele J, Fisher JP, Giessing J, et al. Long-term time-course of strength adaptation to minimal dose resistance training through retrospective longitudinal growth modeling. *Res Q Exerc Sport.* 2023;94(4):913–930. DOI 10.1080/02701367.2022.2070592 · PMID 35591809.
- Lopez P, et al. 2021 (§4.1). PMID 33433148.

### 1.5 Risks of increasing too soon, and of grinding to failure

**Claim.** There is **no direct study** of injury or stalling caused by raising load too early in recreational lifters. The indirect evidence:
- **Fatigue and recovery.** Sets taken to failure (3 × 10 with a 10RM load) caused a larger immediate drop in performance than the same volume stopped halfway (6 × 5 with the 10RM load), and slower recovery: the non-failure protocols recovered significantly faster between 24 and 48 h (Morán-Navarro et al. 2017, 10 trained men). Failure also felt worse: over 8 weeks, failure sets drew higher discomfort and RPE and less positive feelings than stopping at 1–2 RIR (Refalo et al. 2025).
- **Injury rate.** Weight-training sports have **low injury rates** compared with team sports. Bodybuilding has about 0.24–1 injury per 1,000 h. The most-injured sites are the shoulder, lower back, knee, elbow and wrist, mostly strains and tendinitis (Keogh & Winwood 2017). Most of the evidence is retrospective, and none of it links injuries to progression speed.
- **Too-small steps are not risk-free either.** Hostler 2001 hints that tiny increments may progress less over long periods (§1.3).

**Practical rule it supports.** A load increase that pushes the lifter to **RPE 10 or missed reps** on a compound lift is the clearest sign it came too early. Then hold or step back rather than push again. Occasional failure on isolation or machine work is fine.

**Confidence: low** for any rule about "too soon" (no outcome data). **Moderate** that failure training costs extra recovery time and feels worse.

**Citations.**
- Morán-Navarro R, Pérez CE, Mora-Rodríguez R, et al. Time course of recovery following resistance training leading or not to failure. *Eur J Appl Physiol.* 2017;117(12):2387–2399. DOI 10.1007/s00421-017-3725-7 · PMID 28965198.
- Refalo MC, Helms ER, Hamilton DL, Fyfe JJ. The effect of proximity-to-failure on perceptual responses to resistance training. *Eur J Sport Sci.* 2025;25(3):e12266. DOI 10.1002/ejsc.12266 · PMID 39960821.
- Keogh JW, Winwood PW. The epidemiology of injuries across the weight-training sports. *Sports Med.* 2017;47(3):479–501. DOI 10.1007/s40279-016-0575-0 · PMID 27328853.

---

## 2. Autoregulation: RPE/RIR versus fixed percentages

**Claim.** Choosing the load from a target RPE works **at least as well** as fixed percentage-of-1RM plans, and sometimes slightly better for strength. Hypertrophy is similar either way.

- **Helms et al. 2018.** 21 trained men, 8 weeks of squat and bench 3× a week, sets and reps matched. Both groups gained. The RPE group gained slightly more: squat +17.1 vs +13.9 kg; bench +10.7 vs +9.6 kg. The difference was not significant (p > 0.05). Magnitude-based inference gave a 57–79 % chance of a small edge for RPE (squat ES 0.50 ± 0.63). Muscle thickness gains were the same. Their load rule: when a set came in above the target RPE range, the next set's load **dropped 2 % for every 0.5 RPE over**; when it came in below, the load **rose by the same steps** (+4 % at 1 point under, +8 % at 2 points under, and so on). Each missed rep counted as one full RPE point. The RPE group lifted heavier on bench (84 % vs 79 % 1RM) and rated sets harder (RPE 7.3 vs 5.8). (Full text read on PMC.)
- **Graham & Cleather 2021.** 31 trained men, 12 weeks of squats twice a week, RIR-based autoregulation (AR) vs fixed loading (FL), volume matched. Front squat +11.7 % AR vs +8.3 % FL (p = 0.004). Back squat +10.8 % vs +7.1 % (p = 0.006). The AR group trained heavier on average (about 83 % vs 80 % 1RM). (Full text read on the St Mary's University repository.)
- **Mann et al. 2010 (APRE).** 23 college football players, 6 weeks. APRE beat linear periodization on bench 1RM, estimated squat 1RM and reps at 102 kg (225 lb). Small sample; athletes.
- **Zhang et al. 2021 (meta-analysis).** 8 studies, 166 athletes, 5–10 weeks. Autoregulation beat fixed loading for maximal strength: ES 0.64, I² = 0 %. APRE had the largest effect (ES 0.78). Caution: the subgroup effect sizes in the abstract (4.64 for squat, 3.21 for bench) are implausibly large and suggest a pooling or scaling problem.
- **Hickmott et al. 2022 (meta-analysis).** 6 load-autoregulation studies in trained people. **No significant difference** in 1RM between autoregulated and standard loading: +2.07 kg (95 % CI −0.32 to 4.46), SMD 0.21. With sets and relative intensity equated, velocity-loss thresholds **≤ 25 %** (stopping further from failure) gave slightly more strength (SMD 0.23); thresholds **> 25 %** (closer to failure) gave more hypertrophy (SMD 0.28–0.34).
- **Larsen et al. 2021 (systematic review, 14 studies, 356 people).** Every autoregulated protocol raised 1RM, with small to large effects. RIR-based RPE and velocity methods can be effective. No pooled comparison.
- **Helms et al. 2020 (systematic review, 90 studies).** RIR-based RPE and velocity are practical and reliable, with preliminary benefit for individualizing load progression.
- **Helms et al. 2016 (practical article).** Prescribe reps × target RPE, let the lifter pick the load, and adjust the load when the RPE misses the target. Novices should not base progression on RIR alone until their ratings are reliable.

**Practical rule it supports.** Using the logged RPE to steer the next session's load is evidence-based. A simple between-session rule: **about 2 % load per 0.5 RPE** that the last top set was above or below the target range.

**Confidence: moderate** that RPE-based loading is at least as good as fixed loading. **Low** that it is clearly better: the trials are small, short and mostly in trained young men or athletes, and the best pooled analysis (Hickmott 2022) found no significant difference. The 2 %-per-0.5-RPE step is one study's protocol, not a tested optimum.

**Citations.**
- Helms ER, Byrnes RK, Cooke DM, et al. RPE vs. percentage 1RM loading in periodized programs matched for sets and repetitions. *Front Physiol.* 2018;9:247. DOI 10.3389/fphys.2018.00247 · PMID 29628895.
- Graham T, Cleather DJ. Autoregulation by "repetitions in reserve" leads to greater improvements in strength over a 12-week training program than fixed loading. *J Strength Cond Res.* 2021;35(9):2451–2456. DOI 10.1519/JSC.0000000000003164 · PMID 31009432.
- Mann JB, Thyfault JP, Ivey PA, Sayers SP. The effect of autoregulatory progressive resistance exercise vs. linear periodization on strength improvement in college athletes. *J Strength Cond Res.* 2010;24(7):1718–1723. DOI 10.1519/JSC.0b013e3181def4a6 · PMID 20543732.
- Zhang X, Li H, Bi S, Luo Y, Cao Y, Zhang G. Auto-regulation method vs. fixed-loading method in maximum strength training for athletes: a systematic review and meta-analysis. *Front Physiol.* 2021;12:651112. DOI 10.3389/fphys.2021.651112 · PMID 33776802.
- Hickmott LM, Chilibeck PD, Shaw KA, Butcher SJ. The effect of load and volume autoregulation on muscular strength and hypertrophy: a systematic review and meta-analysis. *Sports Med Open.* 2022;8(1):9. DOI 10.1186/s40798-021-00404-9 · PMID 35038063.
- Larsen S, Kristiansen E, van den Tillaar R. Effects of subjective and objective autoregulation methods for intensity and volume on enhancing maximal strength during resistance-training interventions: a systematic review. *PeerJ.* 2021;9:e10663. DOI 10.7717/peerj.10663 · PMID 33520457.
- Helms ER, Kwan K, Sousa CA, Cronin JB, Storey AG, Zourdos MC. Methods for regulating and monitoring resistance training. *J Hum Kinet.* 2020;74:23–42. DOI 10.2478/hukin-2020-0011 · PMID 33312273.
- Helms ER, Cronin J, Storey A, Zourdos MC. Application of the repetitions in reserve-based rating of perceived exertion scale for resistance training. *Strength Cond J.* 2016;38(4):42–49. DOI 10.1519/SSC.0000000000000218 · PMID 27531969.

---

## 3. How accurate is RPE/RIR self-rating? (8.5 vs 9.5)

**Claim.** People are **imperfect** at rating RIR. The typical error is about **1 rep, or more in long sets**. Accuracy improves **near failure, in heavier and shorter sets, and in later sets**. Experience helps little or not at all.
- **Halperin et al. 2022 (scoping review + exploratory meta-analysis, 12 studies, 414 people).** On average people **underpredicted** reps to failure by **0.95 reps** (95 % CI 0.17–1.73), with very high heterogeneity (I² = 97.9 %). Accuracy improved slightly closer to failure and in later sets. It was much worse in sets of **> 12 reps** (β 0.47 vs 0.06 for ≤ 12). Training status did **not** change accuracy. The spread between participants was SD 1.45 reps.
- **Zourdos et al. 2021.** 25 trained men, one squat set to failure at 70 % 1RM, averaging 16 reps. The error when calling RPE 9 / 7 / 5 was **2.05 / 3.65 / 5.15 reps**. More reps per set meant bigger errors. Training age did not predict accuracy.
- **Refalo et al. 2024 (JSCR).** 24 trained men and women, bench press at 75 % 1RM. Calls of 1 RIR and 3 RIR were **accurate**: mean absolute error **0.65 reps**, with a slight tendency to underpredict. Accuracy was equivalent for 1 vs 3 RIR, set 1 vs set 2, and session 1 vs session 2. Sex and experience had no effect.
- **Remmert, Laurson & Zourdos 2023 (58 men and women; curls, pushdowns, rows at 72.5 % 1RM).** More accurate closer to failure and in later sets. Sex, training experience and experience using RIR had no effect.
- **Remmert et al. 2023 (9 trained men, bench, 6 weeks, 3×/week).** Absolute accuracy did **not improve with practice**, with a growing tendency to underestimate RIR in later sessions and in higher-rep sets.
- **Steele et al. 2017 (141 people).** People underpredicted, with a standard error of measurement of 2.6–3.4 reps, and a *tendency* toward better accuracy with experience.
- **Armes et al. 2020 (trained, knee extension, deception design).** People underpredicted by about **2 reps** (95 % CI 0.0–4.0).
- **Zourdos et al. 2016; Ormsbee et al. 2019.** RPE relates strongly to bar speed (r ≈ −0.77 to −0.88). Experienced lifters rate a true 1RM closer to 10 (bench: 9.86 vs 9.35 in novices). Otherwise novices and experienced lifters gave similar ratings at submaximal loads.
- **Helms et al. 2017 (12 powerlifters).** When choosing a load to hit a target RPE, they landed within **0.33 ± 0.28 RPE** of the target on average; better on 3-rep RPE 9 sets than on 2-rep RPE 8 sets, and some lifts took about 3 weeks to reach peak accuracy. Note: this measures agreement between the target and the lifter's *own* rating, not accuracy against true failure.

**What this means for RPE 8.5 vs 9.5.** The scale has half points, and experienced lifters can *report* to within about 0.3–0.5 RPE of a target. But measured accuracy against real failure is about ±0.65–1 rep in the best case (trained lifters, ≤ 10 reps, at 1–3 RIR), and worse in long sets or far from failure. A one-point gap (8.5 vs 9.5, "1–2 RIR" vs "0 RIR but could add weight") is **at the limit of what self-rating can reliably separate**. A single logged half-point difference is noise. Ratings at 9–10 on short sets are the most trustworthy; ratings of 5–7, or any rating on sets of 15+ reps, the least.

**Practical rule it supports.** Treat logged RPE as a **band**, not a precise number: ≤ 7.5 = easy (≥ 3 RIR); 8–9 = working zone (1–2 RIR); ≥ 9.5 = at or near the limit. Only act on a band repeated over sessions. Expect lifters to **underpredict** reps left (they have about 1 rep more than they think), so an RPE 8 set is often really about RPE 7.

**Confidence: high** that RIR ratings are imperfect, with a typical error of about 1 rep that grows with set length and distance from failure. **Moderate** that experience doesn't help much (mixed: Steele 2017 vs Halperin 2022 and Remmert 2023). **Low** for any claim that half-point resolution is meaningful.

**Citations.**
- Halperin I, Malleron T, Har-Nir I, et al. Accuracy in predicting repetitions to task failure in resistance exercise: a scoping review and exploratory meta-analysis. *Sports Med.* 2022;52(2):377–390. DOI 10.1007/s40279-021-01559-x · PMID 34542869.
- Zourdos MC, Goldsmith JA, Helms ER, et al. Proximity to failure and total repetitions performed in a set influences accuracy of intraset repetitions in reserve-based rating of perceived exertion. *J Strength Cond Res.* 2021;35(Suppl 1):S158–S165. DOI 10.1519/JSC.0000000000002995 · PMID 30747900.
- Zourdos MC, Klemp A, Dolan C, et al. Novel resistance training-specific rating of perceived exertion scale measuring repetitions in reserve. *J Strength Cond Res.* 2016;30(1):267–275. DOI 10.1519/JSC.0000000000001049 · PMID 26049792.
- Ormsbee MJ, Carzoli JP, Klemp A, et al. Efficacy of the repetitions in reserve-based rating of perceived exertion for the bench press in experienced and novice benchers. *J Strength Cond Res.* 2019;33(2):337–345. DOI 10.1519/JSC.0000000000001901 · PMID 28301439.
- Refalo MC, Remmert JF, Pelland JC, et al. Accuracy of intraset repetitions-in-reserve predictions during the bench press exercise in resistance-trained male and female subjects. *J Strength Cond Res.* 2024;38(3):e78–e85. DOI 10.1519/JSC.0000000000004653 · PMID 37967832.
- Remmert JF, Laurson KR, Zourdos MC. Accuracy of predicted intraset repetitions in reserve (RIR) in single- and multi-joint resistance exercises among trained and untrained men and women. *Percept Mot Skills.* 2023;130(3):1239–1254. DOI 10.1177/00315125231169868 · PMID 37036795.
- Remmert JF, Robinson ZP, Pelland JC, et al. Changes in intraset repetitions in reserve prediction accuracy during six weeks of bench press training in trained men. *Percept Mot Skills.* 2023;130(5):2139–2160. DOI 10.1177/00315125231189098 · PMID 37436724.
- Steele J, Endres A, Fisher J, Gentil P, Giessing J. Ability to predict repetitions to momentary failure is not perfectly accurate, though improves with resistance training experience. *PeerJ.* 2017;5:e4105. DOI 10.7717/peerj.4105 · PMID 29204323.
- Armes C, Standish-Hunt H, Androulakis-Korakakis P, et al. "Just one more rep!" – ability to predict proximity to task failure in resistance trained persons. *Front Psychol.* 2020;11:565416. DOI 10.3389/fpsyg.2020.565416 · PMID 33424678.
- Helms ER, Brown SR, Cross MR, Storey A, Cronin J, Zourdos MC. Self-rated accuracy of rating of perceived exertion-based load prescription in powerlifters. *J Strength Cond Res.* 2017;31(10):2938–2943. DOI 10.1519/JSC.0000000000002097 · PMID 28933716.

---

## 4. Rep ranges and failure

### 4.1 Load and rep range: hypertrophy versus strength

**Claim.** When sets go to (or near) failure, **muscle growth is similar across a wide range of loads**: from heavy (≤ 8 RM) to light (> 15 RM). **Maximal strength (1RM) is clearly better with heavy loads.**
- **Schoenfeld et al. 2017 (meta-analysis, 21 studies, all sets to failure).** 1RM gains were significantly greater with high loads (> 60 % 1RM). Hypertrophy was similar. Isometric strength did not differ.
- **Lopez et al. 2021 (network meta-analysis, 28 studies, 747 adults, sets to failure).** Hypertrophy did not differ between low (> 15 RM), moderate (9–15 RM) and high (≤ 8 RM) loads. For strength, high beat low (SMD 0.60–0.63) and moderate beat low (SMD 0.34–0.35). High vs moderate was SMD 0.26–0.28, not significant (p = 0.068).
- **ACSM 2026:** voluntary strength was enhanced by ≥ 80 % 1RM (about ≤ 8 reps near failure).
- **Schoenfeld et al. 2021 (narrative review):** the old "repetition continuum" (heavy for strength, moderate for size, light for endurance) is only partly supported; hypertrophy can be achieved across a wide spectrum of loads.

**Practical rule it supports.** For **hypertrophy** exercises, any rep range from about 5 to 30 works if the sets are hard; in practice prefer **≤ 12–15 reps**, because RIR self-ratings get less accurate in long sets (§3). For **strength** main lifts, keep regular exposure to heavy sets, about ≤ 6–8 reps, ≥ 80 % 1RM.

**Confidence: high** (several consistent meta-analyses).

**Citations.**
- Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW. Strength and hypertrophy adaptations between low- vs. high-load resistance training: a systematic review and meta-analysis. *J Strength Cond Res.* 2017;31(12):3508–3523. DOI 10.1519/JSC.0000000000002200 · PMID 28834797.
- Lopez P, Radaelli R, Taaffe DR, et al. Resistance training load effects on muscle hypertrophy and strength gain: systematic review and network meta-analysis. *Med Sci Sports Exerc.* 2021;53(6):1206–1216. DOI 10.1249/MSS.0000000000002585 · PMID 33433148.
- Schoenfeld BJ, Grgic J, Van Every DW, Plotkin DL. Loading recommendations for muscle strength, hypertrophy, and local endurance: a re-examination of the repetition continuum. *Sports (Basel).* 2021;9(2):32. DOI 10.3390/sports9020032 · PMID 33671664. (Narrative review.)
- Currier BS, et al. 2026 (§1.1). PMID 41843416.

### 4.2 Proximity to failure: hypertrophy versus strength

**Claim.** Sets must be **hard but need not reach failure**. For hypertrophy, stopping closer to failure helps up to a point. For strength, proximity to failure barely matters.
- **Refalo et al. 2023 (meta-analysis, 15 studies).** Training to any kind of set failure gave a **trivial** hypertrophy advantage over non-failure: ES 0.19 (95 % CI 0.00–0.37). Momentary failure vs non-failure: ES 0.12 (−0.13 to 0.37), not significant. The relationship is probably non-linear: closer helps, but the last reps add little.
- **Grgic et al. 2022 (meta-analysis, 15 studies).** Failure vs non-failure: no difference for strength (ES −0.09) or hypertrophy (ES 0.22, CI −0.11 to 0.55). When volume was not equated, non-failure was better for strength (ES −0.32). In resistance-trained people, failure gave a small hypertrophy edge (ES 0.15, CI 0.03–0.26).
- **Robinson et al. 2024 (series of meta-regressions, exploratory, RIR estimated from study descriptions).** Hypertrophy **increased as sets ended closer to failure** (the RIR slope was negative, CI excluding zero). Strength gains were **similar across a wide range of RIR**.
- **Refalo et al. 2024 (RCT, 18 trained people, within-person legs, 8 weeks).** Leg press and leg extension to momentary failure vs 1–2 RIR gave **equal quadriceps growth**: +0.181 vs +0.182 cm. Failure caused more acute fatigue and rep loss.
- **Vasconcelos et al. 2026 (RCT, 19 trained people, leg extension, within-person).** Failure vs 1–3 RIR made a negligible difference for both muscle thickness (−0.019 cm) and 1RM (+0.2 kg).
- **Pareja-Blanco et al. 2017 (22 men, squat, 8 weeks).** Stopping at 20 % bar-speed loss (further from failure) gave the same squat strength with 40 % fewer reps, and better jump gains. The 40 % speed-loss group (closer to failure) grew more muscle in two quadriceps heads. Hickmott 2022's pooled data agree (§2).
- **ACSM 2026:** training to momentary fatigue did not consistently change outcomes.

**Practical rule it supports.** Working sets aim at **RPE 7–9.5 (about 0–3 RIR)**. Hypertrophy work prefers the upper end (RPE 8–9.5). Heavy compound strength work needs only **RPE 7–9**, which saves recovery. Failure (RPE 10) is optional and best kept to isolation or machine exercises, or the last set.

**Confidence: moderate–high** that failure isn't required and that 1–3 RIR gives similar hypertrophy (consistent meta-analyses and RCTs). **Moderate** for the dose-response slope: Robinson 2024 is exploratory and uses *estimated* RIR.

**Citations.**
- Refalo MC, Helms ER, Trexler ET, Hamilton DL, Fyfe JJ. Influence of resistance training proximity-to-failure on skeletal muscle hypertrophy: a systematic review with meta-analysis. *Sports Med.* 2023;53(3):649–665. DOI 10.1007/s40279-022-01784-y · PMID 36334240.
- Grgic J, Schoenfeld BJ, Orazem J, Sabol F. Effects of resistance training performed to repetition failure or non-failure on muscular strength and hypertrophy: a systematic review and meta-analysis. *J Sport Health Sci.* 2022;11(2):202–211. DOI 10.1016/j.jshs.2021.01.007 · PMID 33497853.
- Robinson ZP, Pelland JC, Remmert JF, et al. Exploring the dose-response relationship between estimated resistance training proximity to failure, strength gain, and muscle hypertrophy: a series of meta-regressions. *Sports Med.* 2024;54(9):2209–2231. DOI 10.1007/s40279-024-02069-2 · PMID 38970765.
- Refalo MC, Helms ER, Robinson ZP, Hamilton DL, Fyfe JJ. Similar muscle hypertrophy following eight weeks of resistance training to momentary muscular failure or with repetitions-in-reserve in resistance-trained individuals. *J Sports Sci.* 2024;42(1):85–101. DOI 10.1080/02640414.2024.2321021 · PMID 38393985.
- Vasconcelos T, Ruivo A, Refalo MC, et al. Comparative adaptations to different leg extension set-termination strategies in trained men and women: a unilateral within-participant study. *J Strength Cond Res.* 2026;40(10):1205–1213. DOI 10.1519/JSC.0000000000005494 · PMID 42617172.
- Pareja-Blanco F, Rodríguez-Rosell D, Sánchez-Medina L, et al. Effects of velocity loss during resistance training on athletic performance, strength gains and muscle adaptations. *Scand J Med Sci Sports.* 2017;27(7):724–735. DOI 10.1111/sms.12678 · PMID 27038416.

---

## 5. Estimated 1RM (e1RM)

**What the app computes.** One formula everywhere: Epley, `e1RM = weight × (1 + reps / 30)`, and only for sets of 12 reps or fewer (`est1RM` in `src/features/training/progressAggregate.ts`). Example: 80 kg × 8 → 80 × (1 + 8/30) ≈ 101.3 kg.

**Claim.** Formulas that predict 1RM from reps to failure are **useful but not exact**. They track the real 1RM closely across a group, but each formula over- or under-predicts by some kilos for a given person, and the error grows with the number of reps.
- **Mayhew et al. 1995.** 220 men of different training levels did a 1RM bench test and, 4–10 days later, as many reps as possible with a chosen weight. Six prediction equations correlated well with the real 1RM (r = 0.86–0.98 per group; 0.82–0.98 overall). But with ≤ 10 reps, three equations significantly **overpredicted** and two **underpredicted**; with > 10 reps, three overpredicted and three underpredicted. Brzycki was the most accurate at ≤ 10 reps. Averaging two equations may reduce the error.
- **Reynolds et al. 2006.** 70 adults (34 men, 36 women, 18–69 years) tested 1, 5, 10 and 20RM on bench and leg press. The load falls **non-linearly** as reps rise. Predictions from **5RM were the most accurate** (R² 0.993 bench, 0.974 leg press), then 10RM, then 20RM. The 5RM equation's typical miss (SEE) was **2.98 kg on bench and 16.16 kg on leg press**. The authors: use **no more than 10 reps** in linear equations (Epley is one).
- **Nickerson et al. 2020.** 20 trained people (half women), bench press, reps to failure at 70 % 1RM. Epley gave smaller mean differences from the measured 1RM than the Wathen and Mayhew equations, and the **lowest standard error** of the methods tested (including a velocity-based one).

**Practical rule it supports.** e1RM is an **estimate** for following one exercise's trend over time — the same exercise, the same formula, similar rep counts — not a true max and not a number to compare between exercises or people. It is most trustworthy from sets of about 3–10 reps taken close to failure. A small session-to-session change is noise (§1.3: day-to-day scatter of 3–6 %).

**Confidence: moderate** that rep-based formulas track 1RM well at low reps and worse at high reps (several studies agree). **Low** for a single percentage error that fits every exercise: the studies are bench and leg press, mostly with sets taken to true failure, and errors differ by exercise and person. A set logged at RPE 7 (not to failure) makes the estimate lower than it would be at failure.

**Citations.**
- Mayhew JL, Prinster JL, Ware JS, Zimmer DL, Arabas JR, Bemben MG. Muscular endurance repetitions to predict bench press strength in men of different training levels. *J Sports Med Phys Fitness.* 1995;35(2):108–113. PMID 7500624 (no DOI listed in PubMed).
- Reynolds JM, Gordon TJ, Robergs RA. Prediction of one repetition maximum strength from multiple repetition maximum testing and anthropometry. *J Strength Cond Res.* 2006;20(3):584–592. DOI 10.1519/R-15304.1 · PMID 16937972.
- Nickerson BS, Williams TD, Snarr RL, Garza JM, Salinas G. Evaluation of load-velocity relationships and repetitions-to-failure equations in the presence of male and female spotters. *J Strength Cond Res.* 2020;34(9):2427–2433. DOI 10.1519/JSC.0000000000003731 · PMID 32740290.

---

## 6. Volume

### 6.1 Weekly sets per muscle: more sets, more growth, with diminishing returns

**Claim.** Weekly sets per muscle are the main lever for muscle growth. Growth keeps rising with more sets, but each extra set adds less than the one before. Strength levels off much sooner: a few sets per week already give most of the strength gain, so more strength comes from frequency and practice with the lift rather than from extra sets.

**Numbers.**
- **Schoenfeld, Ogborn & Krieger 2017** (meta-analysis; 15 studies, 34 groups). Each extra weekly set added about 0.37 % muscle growth (ES +0.023 per set). Higher volume beat lower volume by about 3.9 % growth (ES difference 0.241). Across the groups < 5, 5–9 and 10+ sets per muscle per week, 10+ trended best (p = 0.074).
- **Pelland, Remmert, Robinson, Hinson & Zourdos 2026** (Sports Med; online 04.12.2025). Meta-regression of 67 studies and 2,058 participants, 79 % men. Fractional counting fit the data best. The chance that more volume means more growth was 100 % for size and for strength, with diminishing returns, much stronger for strength.
  - **Preprint numbers.** The detailed numbers below come from the **preprint** (SportRxiv 2024, not peer reviewed; full text read). The published version has the same abstract, but its tables could not be checked (paywall).
  - Growth: +0.24 % per extra fractional set at the average volume (95 % CrI 0.15–0.33 %). The minimum effective dose is about 4 fractional sets per week. Bands from there: 5–10 sets "higher efficiency" (about 6 extra sets per detectable step of growth), 11–18 "intermediate" (about 8.5), 19–29 "lower" (about 10.75), 30–42 "lowest" (about 12.5). Above 43 there are too few data. Few studies tested more than about 25 sets.
  - Strength: about 1 fractional set per week is the minimum effective dose. Detectable extra gains stop at about 4–5 sets per week (a "functional plateau").
  - Conflict of interest: the authors are also fitness coaches and writers, and they disclose it.
- **Baz-Valle et al. 2022** (systematic review and meta-analysis; trained men only, 7 RCTs). 12–20 sets per muscle per week did as well as more than 20 for the quadriceps and biceps; more than 20 did better only for the triceps. The authors propose 12–20 weekly sets as the standard range for trained men.
- **Schoenfeld et al. 2019 (MSSE)** (RCT; 34 trained men; 8 weeks; 3 sessions a week on non-consecutive days). Growth rose with volume: 1, then 3, then 5 sets per exercise per session. Strength did not differ between groups, and even about 13 minutes of training per session gave clear strength gains. (Full text read on PMC.)
- **Ralston et al. 2017** (meta-analysis, strength). More than 5 sets per exercise per week gave more strength than 5 or fewer (ES difference 0.18, 95 % CI 0.06–0.30).
- **Androulakis-Korakakis et al. 2020** (systematic review and meta-analysis; trained men). Even one set per exercise, 1–3 times a week, raised squat and bench 1RM, by about 12 kg overall (95 % CI 8–16 kg): "suboptimal yet significant".
- **ACSM 2026 (Currier et al.)** (overview of 137 systematic reviews, more than 30,000 participants; full text read on PMC). Hypertrophy was greater with 10 or more sets per muscle group per week. Strength was greater with 2–3 sets per exercise per session, 2 or more sessions a week, and heavy loads (≥ 80 % 1RM).

**Practical rule it supports.** Count weekly hard sets per muscle with fractional counting (direct = 1, indirect = 0.5). Below 4: "below the minimum for growth". 4–9: "low, but it works". 10–20: "typical target". Above 20: "fine, extra sets add less each" — never an error. Above about 30–40: "little extra expected, evidence thin".

**Confidence: high** that more sets give more growth with diminishing returns (four meta-analyses and ACSM 2026 agree). **Moderate** for the exact band edges: they come from preprint tables, and data above about 25 sets are thin. **High** that strength needs only a few sets.

**Citations.**
- Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. *J Sports Sci.* 2017;35(11):1073–1082. DOI 10.1080/02640414.2016.1210197 · PMID 27433992.
- Pelland JC, Remmert JF, Robinson ZP, Hinson SR, Zourdos MC. The resistance training dose response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gains. *Sports Med.* 2026;56(2):481–505. DOI 10.1007/s40279-025-02344-w · PMID 41343037. Detailed numbers from the **preprint**: SportRxiv 2024, preprint 460, not peer reviewed.
- Baz-Valle E, Balsalobre-Fernández C, Alix-Fages C, Santos-Concejero J. A systematic review of the effects of different resistance training volumes on muscle hypertrophy. *J Hum Kinet.* 2022;81:199–210. DOI 10.2478/hukin-2022-0017 · PMID 35291645 · PMC8884877.
- Schoenfeld BJ, Contreras B, Krieger J, et al. Resistance training volume enhances muscle hypertrophy but not strength in trained men. *Med Sci Sports Exerc.* 2019;51(1):94–103. DOI 10.1249/MSS.0000000000001764 · PMID 30153194 · PMC6303131.
- Ralston GW, Kilgore L, Wyatt FB, Baker JS. The effect of weekly set volume on strength gain: a meta-analysis. *Sports Med.* 2017;47(12):2585–2601. DOI 10.1007/s40279-017-0762-7 · PMID 28755103 · PMC5684266.
- Androulakis-Korakakis P, Fisher JP, Steele J. The minimum effective training dose required to increase 1RM strength in resistance-trained men: a systematic review and meta-analysis. *Sports Med.* 2020;50(4):751–765. DOI 10.1007/s40279-019-01236-0 · PMID 31797219.
- Currier BS, et al. 2026 (§1.1). PMID 41843416 · PMC12965823.

---

## 7. Frequency and recovery

### 7.1 Frequency per muscle

**Claim.** For muscle size, what counts is the week's total sets, not how many days they are spread over. Training a muscle twice a week mainly helps because it makes higher weekly volume easier to fit in. For strength, practising a lift more often gives a small extra benefit, with diminishing returns above about 2 times a week.

**Numbers.**
- **Schoenfeld, Ogborn & Krieger 2016** (meta-analysis). Higher frequency gave more growth than lower (ES 0.49 vs 0.30), but most comparisons were not volume-equated. The authors concluded "at least twice a week".
- **Schoenfeld, Grgic & Krieger 2019** (meta-analysis; 25 studies). With volume equated, no significant difference between frequencies, also in trained lifters, for upper and lower body, and with direct measures of growth: "individuals can choose a weekly frequency per muscle group based on personal preference". This updates the 2016 paper.
- **Grgic, Schoenfeld & Latella 2019** (review). With volume equated, once a week gave growth similar to 2–3 times a week.
- **Grgic et al. 2018** (meta-analysis, strength; 22 studies). Effect sizes rose with frequency: 0.74, 0.82, 0.93 and 1.08 for 1, 2, 3 and 4+ times a week. With volume equated there was no significant effect (p = 0.421); the gain was mostly extra volume.
- **Pelland et al. 2026** (**preprint** numbers). Size: +0.32 % per extra session (95 % CrI −0.14 to 0.82 %), a 91 % chance of being above zero — a negligible effect. Strength: +3.27 % per extra session (95 % CrI 2.74–3.84 %), 100 % chance above zero; about 12.7 % gain at 1 session a week vs 17.3 % at 2, with diminishing returns after that.
- **Saric et al. 2019** (RCT; 27 trained men; 6 weeks; volume-equated). 3 and 6 times a week gave similar strength and growth.
- **ACSM 2026.** Strength: 2 or more sessions a week helps. Hypertrophy: with total volume equated, no difference between 1 day a week and more than 5.

**Practical rule it supports.** Judge each muscle on its sets over a rolling 7 days, not on which weekday it was trained. By default hit each major muscle at least twice in 7 days, for strength and to make volume easier to fit. Don't warn if a muscle got its weekly sets in a single session.

**Confidence: high** for size (several meta-analyses and ACSM 2026 agree). **Moderate** for the small strength benefit of frequency: the latest model finds it, but volume-equated subgroups have not.

**Citations.**
- Schoenfeld BJ, Ogborn D, Krieger JW. Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis. *Sports Med.* 2016;46(11):1689–1697. DOI 10.1007/s40279-016-0543-8 · PMID 27102172.
- Schoenfeld BJ, Grgic J, Krieger J. How many times per week should a muscle be trained to maximize muscle hypertrophy? A systematic review and meta-analysis of studies examining the effects of resistance training frequency. *J Sports Sci.* 2019;37(11):1286–1295. DOI 10.1080/02640414.2018.1555906 · PMID 30558493.
- Grgic J, Schoenfeld BJ, Latella C. Resistance training frequency and skeletal muscle hypertrophy: a review of available evidence. *J Sci Med Sport.* 2019;22(3):361–370. DOI 10.1016/j.jsams.2018.09.223 · PMID 30236847.
- Grgic J, Schoenfeld BJ, Davies TB, et al. Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis. *Sports Med.* 2018;48(5):1207–1220. DOI 10.1007/s40279-018-0872-x · PMID 29470825.
- Saric J, Lisica D, Orlic I, et al. Resistance training frequencies of 3 and 6 times per week produce similar muscular adaptations in resistance-trained men. *J Strength Cond Res.* 2019;33 Suppl 1:S122–S129. DOI 10.1519/JSC.0000000000002909 · PMID 30363041.
- Pelland et al. 2026 and Currier et al. 2026: see §6.1.

### 7.2 Recovery between two sessions for the same muscle (the 24–48 h window)

**Claim.**
- After a hard session, MPS roughly doubles at 24 h and is back near baseline by about 36–48 h.
- In trained muscle the rise is shorter: back at baseline by 28 h in one study.
- In the first weeks of a new or harder programme, much of that rise goes to repairing damage rather than to growth (Damas 2016).
- Performance recovers faster when sets stop short of failure: sets to failure slowed recovery for 24–48 h.
- So the same muscle can be trained again after about 48 h, and probably after 24 h if the sets were not taken to failure.

**Numbers.**
- **MacDougall et al. 1995.** 6 young men, 12 heavy sets of elbow flexion: MPS +50 % at 4 h, +109 % at 24 h, back within 14 % of baseline (not significant) at about 36 h.
- **Phillips et al. 1997.** 8 untrained adults: MPS +112 % at 3 h, +65 % at 24 h, +34 % at 48 h. Net protein balance stayed improved up to 48 h.
- **Tang et al. 2008.** After 8 weeks of training, MPS in the trained leg was back at rest by 28 h; in the untrained leg it was still +70 % at 28 h.
- **Damas et al. 2016.** 10 young men measured in weeks 1, 3 and 10. In week 1, MPS over 0–48 h was highest but did not relate to growth; muscle damage was highest then. By weeks 3 and 10, MPS correlated with growth (r ≈ 0.9). (Full text read on PMC.) Damas et al. 2015 is the review behind this work.
- **Morán-Navarro et al. 2017** (§1.5). With the same total reps, sets to failure slowed recovery of jump height and bar speed for 24–48 h compared with stopping halfway.
- **Yang et al. 2018** (RCT; 30 recreationally active men; 12 weeks) and **da Silva Carvalho & Rodrigues Santos 2018** (RCT; 21 men; 7 weeks). Full-body training on 3 consecutive days gave strength and body-composition gains similar to 3 non-consecutive days. Both small, with indirect measures of muscle.

**Practical rule it supports.** When the app moves a session, aim for about 48 h between two hard sessions for the same muscle. Allow 24 h (consecutive days) without a warning when the session trains different muscles (upper after lower is always fine) or the planned effort is not to failure. A gentle note, never a block.

**Confidence: moderate** for the MPS time-course (consistent, but small mechanism studies, mostly untrained, and MPS is not the same thing as growth). **Low to moderate** that consecutive days are fine for the same muscle (two small RCTs in non-advanced men).

**Citations.**
- MacDougall JD, Gibala MJ, Tarnopolsky MA, et al. The time course for elevated muscle protein synthesis following heavy resistance exercise. *Can J Appl Physiol.* 1995;20(4):480–486. DOI 10.1139/h95-038 · PMID 8563679.
- Phillips SM, Tipton KD, Aarsland A, Wolf SE, Wolfe RR. Mixed muscle protein synthesis and breakdown after resistance exercise in humans. *Am J Physiol.* 1997;273(1 Pt 1):E99–E107. DOI 10.1152/ajpendo.1997.273.1.E99 · PMID 9252485.
- Tang JE, Perco JG, Moore DR, Wilkinson SB, Phillips SM. Resistance training alters the response of fed state mixed muscle protein synthesis in young men. *Am J Physiol Regul Integr Comp Physiol.* 2008;294(1):R172–R178. DOI 10.1152/ajpregu.00636.2007 · PMID 18032468.
- Damas F, Phillips SM, Libardi CA, et al. Resistance training-induced changes in integrated myofibrillar protein synthesis are related to hypertrophy only after attenuation of muscle damage. *J Physiol.* 2016;594(18):5209–5222. DOI 10.1113/JP272472 · PMID 27219125 · PMC5023708.
- Damas F, Phillips S, Vechin FC, Ugrinowitsch C. A review of resistance training-induced changes in skeletal muscle protein synthesis and their contribution to hypertrophy. *Sports Med.* 2015;45(6):801–807. DOI 10.1007/s40279-015-0320-0 · PMID 25739559.
- Morán-Navarro R, et al. 2017 (§1.5). PMID 28965198.
- Yang Y, Bay PB, Wang YR, et al. Effects of consecutive versus non-consecutive days of resistance training on strength, body composition, and red blood cells. *Front Physiol.* 2018;9:725. DOI 10.3389/fphys.2018.00725 · PMID 29967584 · PMC6015912.
- da Silva Carvalho AD, Rodrigues Santos JA. Nonconsecutive versus consecutive-day resistance training in recreationally trained subjects. *J Sports Med Phys Fitness.* 2018;58(3):233–240. DOI 10.23736/S0022-4707.16.06660-3 · PMID 27682004.

---

## 8. Moved and missed sessions

### 8.1 Moved sessions and flexible schedules

**Claim.** No study tests "the same session done 1–2 days late" directly. Three lines of evidence say it does not matter: with weekly volume equal, how sets are spread across days does not change growth and changes strength little (§7.1); letting the lifter choose which planned workout to do on a given day ("flexible" periodization) gave equal or better results than a fixed order; and periodization patterns themselves have small effects on strength and none on size.

**Numbers.**
- **McNamara & Stearne 2010.** 16 beginners, twice a week for 12 weeks, same total reps (3,680) in both groups. The flexible group picked on the day which of the 10-, 15- or 20-RM workouts to do. It gained more on the leg press (+62 kg vs +16 kg); chest press and long jump did not differ. Small study. PubMed lists two records of the same article.
- **McNamara & Stearne 2013.** 20 students on a flexible nonlinear programme twice a week for 12 weeks improved strength and power. No fixed-order control group, so this shows only that the method works.
- **Colquhoun et al. 2017.** 25 trained men, 9 weeks. Flexible daily undulating periodization (the lifter chooses the order of the week's heavy, medium and light days) matched the fixed order in squat, bench, deadlift and fat-free mass. Powerlifting total +36.8 kg flexible vs +40.4 kg fixed, not significantly different. Motivation, session RPE and satisfaction did not differ.
- **Moesgaard et al. 2022** (meta-analysis; 35 studies; volume-equated). Periodized beat non-periodized training for 1RM (ES 0.31) but not for size (ES 0.13, not significant). Undulating beat linear for 1RM only in trained lifters (ES 0.61).
- **ACSM 2026.** Periodization (linear, undulating, or none) did not consistently change outcomes.

**Practical rule it supports.** Treat the plan as a sequence (A → B → C → D), not a list of fixed weekdays. A planned session done up to 2 days before or after its planned date, before the next session in the sequence, counts as that session done: "moved", not "missed". "What to do next" is the next undone session in the sequence, whatever the weekday.

**Confidence: moderate** that moving sessions within the week doesn't hurt (indirect but consistent; RCTs show flexible ordering is not worse). **Low** for the exact ±2-day window (**app choice**, chosen so a moved session still fits in the same 7-day volume count). Claim only "flexible is not worse", never "flexible is better": McNamara 2010's leg-press result has not been replicated.

**Citations.**
- McNamara JM, Stearne DJ. Flexible nonlinear periodization in a beginner college weight training class. *J Strength Cond Res.* 2010;24(1):17–22. DOI 10.1519/JSC.0b013e3181bc177b · PMID 20042923. Duplicate PubMed record: 2010;24(8):2012–2017, DOI 10.1519/JSC.0b013e3181b1b15d, PMID 19858756.
- McNamara JM, Stearne DJ. Effect of concurrent training, flexible nonlinear periodization, and maximal-effort cycling on strength and power. *J Strength Cond Res.* 2013;27(6):1463–1470. DOI 10.1519/JSC.0b013e318274f343 · PMID 23037617.
- Colquhoun RJ, Gai CM, Walters J, et al. Comparison of powerlifting performance in trained men using traditional and flexible daily undulating periodization. *J Strength Cond Res.* 2017;31(2):283–291. DOI 10.1519/JSC.0000000000001500 · PMID 28129275. An erratum exists: DOI 10.1519/JSC.0000000000001850.
- Moesgaard L, Beck MM, Christiansen L, Aagaard P, Lundbye-Jensen J. Effects of periodization on strength and muscle hypertrophy in volume-equated resistance training programs: a systematic review and meta-analysis. *Sports Med.* 2022;52(7):1647–1666. DOI 10.1007/s40279-021-01636-1 · PMID 35044672.
- Currier et al. 2026: see §6.1.

### 8.2 A missed session: shift, skip or merge?

**Claim.** No trial compares shift, skip and merge after a missed session, so the answer is built from §6, §7, §8.1 and §9:
1. **Shift** (do the missed session next and push the rest back). Keeps the weekly volume and the sequence, and the exact weekday barely matters (§7.1, §8.1). The best default.
2. **Skip.** Missing one session in a 3–4 day split loses about a quarter to a third of that week's sets for its muscles. That week costs a little growth (§6.1: about 0.2–0.4 % per weekly set, at the margin). Nothing already built is lost: there is no measurable detraining under 2–3 weeks, and one session a week holds gains for months (§9). Safe, just slightly less productive.
3. **Merge** (add the missed work to the next session). Weekly volume is what matters, so adding a few sets of the missed muscles to other sessions makes sense. But nobody has measured the cost of a very long session — Pelland's team lists per-session volume as an open question and their per-session analysis is not peer reviewed — and extra fatigue slows recovery (§7.2).

**Numbers.** None direct; see §6.1, §7.1, §8.1 and §9.

**Practical rule it supports.** Default: **shift** — "what to do next" is the missed session. If shifting would put two hard sessions for the same muscle within 24 h, or the week is nearly over, offer **skip** or **partial merge** (up to about 2–4 sets for each missed muscle across the remaining sessions). Never two full sessions in one day. Never show a missed session as lost progress.

**Confidence: low.** Derived from indirect evidence; no study tests this choice. The direction (shift ≥ merge ≥ skip, all acceptable) follows from high-confidence volume and frequency findings; the thresholds are **app choices**.

**Citations.** As in §6.1, §7.1, §7.2, §8.1 and §9.

---

## 9. Breaks and detraining

**Claim.**
- Short breaks of up to about 2–3 weeks cost little or nothing measurable in trained or recently trained young adults.
- Longer breaks cost strength and size, but these come back quickly on retraining ("muscle memory" in practice). Over months, people who took breaks ended up where continuous trainers did.
- Losses grow with break length and are larger in older and untrained people.
- Very little training holds gains: one session a week, or about a third of the usual volume, at the same heavy intensity.

**Numbers.**
- **Bosquet et al. 2013** (meta-analysis; 103 studies). Stopping training lowered submaximal strength (SMD −0.62), maximal force (−0.46) and maximal power (−0.20). Losses grew with the length of the stop and were larger in people over 65 and inactive people than in recreational athletes. The paper's week-by-week numbers were not verified (paywall), so none are quoted.
- **Hwang et al. 2017.** 20 trained men: 4 weeks of training, 2 weeks off, 4 weeks of retraining. No drop in leg press strength after the 2 weeks off; lean mass kept.
- **Ogasawara et al. 2011.** Previously untrained men. A 3-week break after 6 weeks of bench training caused no significant loss of muscle size or 1RM. After 15 weeks, the group with a break matched the continuous group.
- **Ogasawara et al. 2013.** Over 24 weeks, cycles of 6 weeks training and 3 weeks off gave the same muscle size and strength as continuous training. Retraining after each break went faster than continued training.
- **Halonen et al. 2024** (RCT; 55 untrained adults, 45 % women; twice-weekly full-body). 10 weeks training, 10 off, 10 training, against 20 weeks continuous. The break lowered strength and size, but the losses came back within the first 5 weeks of retraining and both groups ended the same: trainees "should not be too concerned about occasional short-term training breaks".
- **Pritchard et al. 2018.** 8 trained men. After 4 weeks of training, 3.5 or 5.5 days fully off slightly *increased* isometric bench force and jump height (ES 0.21–0.30): a short break can sharpen performance by clearing fatigue.
- **Bickel et al. 2011** (RCT; 70 adults; 16 weeks of training, then 32 weeks). In young adults, one-third of the volume (even one-ninth) kept the muscle gained; strength was largely kept even with no training. Older adults needed more.
- **Spiering et al. 2021** (**narrative review**). In younger adults, strength and size can be kept for up to 32 weeks with one session a week and one set per exercise, as long as the relative load (intensity) is kept.
- A "Hwang/Schoenfeld 2022" paper on breaks, named in the original research brief, could not be found as a peer-reviewed paper; Hwang et al. 2017 and Halonen et al. 2024 are used instead.

**Practical rule it supports.** Gap of 14 days or less since a muscle was last trained: resume the plan where it stopped, no load change, no warning. 15–28 days: resume, but make the first 1–2 sessions slightly lighter or with more reps in reserve. More than 28 days: a "comeback" — start the first week lighter and expect progress back within a few weeks. In busy weeks, offer "maintenance": at least 1 heavy session, about a third of the usual sets.

**Confidence: moderate** that breaks of 2–3 weeks cost little (several small RCTs, consistent with the meta-analysis). **Moderate** that losses return fast and long-term results match. **Low** for the 14- and 28-day cut-offs (**app choices**; Bosquet's week-level data were not verified). Most break studies used untrained or recently trained people.

**Citations.**
- Bosquet L, Berryman N, Dupuy O, et al. Effect of training cessation on muscular performance: a meta-analysis. *Scand J Med Sci Sports.* 2013;23(3):e140–e149. DOI 10.1111/sms.12047 · PMID 23347054.
- Hwang PS, Andre TL, McKinley-Barnard SK, et al. Resistance training-induced elevations in muscular strength in trained men are maintained after 2 weeks of detraining and not differentially affected by whey protein supplementation. *J Strength Cond Res.* 2017;31(4):869–881. DOI 10.1519/JSC.0000000000001807 · PMID 28328712.
- Ogasawara R, Yasuda T, Sakamaki M, Ozaki H, Abe T. Effects of periodic and continued resistance training on muscle CSA and strength in previously untrained men. *Clin Physiol Funct Imaging.* 2011;31(5):399–404. DOI 10.1111/j.1475-097X.2011.01031.x · PMID 21771261.
- Ogasawara R, Yasuda T, Ishii N, Abe T. Comparison of muscle hypertrophy following 6-month of continuous and periodic strength training. *Eur J Appl Physiol.* 2013;113(4):975–985. DOI 10.1007/s00421-012-2511-9 · PMID 23053130.
- Halonen EJ, Gabriel I, Kelahaara MM, Ahtiainen JP, Hulmi JJ. Does taking a break matter — adaptations in muscle strength and size between continuous and periodic resistance training. *Scand J Med Sci Sports.* 2024;34(10):e14739. DOI 10.1111/sms.14739 · PMID 39364857.
- Pritchard HJ, Barnes MJ, Stewart RJC, Keogh JWL, McGuigan MR. Short-term training cessation as a method of tapering to improve maximal strength. *J Strength Cond Res.* 2018;32(2):458–465. DOI 10.1519/JSC.0000000000001803 · PMID 29369954.
- Bickel CS, Cross JM, Bamman MM. Exercise dosing to retain resistance training adaptations in young and older adults. *Med Sci Sports Exerc.* 2011;43(7):1177–1187. DOI 10.1249/MSS.0b013e318207c15d · PMID 21131862.
- Spiering BA, Mujika I, Sharp MA, Foulis SA. Maintaining physical performance: the minimal dose of exercise needed to preserve endurance and strength over time. *J Strength Cond Res.* 2021;35(5):1449–1458. DOI 10.1519/JSC.0000000000003964 · PMID 33629972. (Narrative review.)

---

## 10. Deloads

**Claim.**
- Experts agree a deload is "a period of reduced training stress designed to mitigate physiological and psychological fatigue, promote recovery, and enhance preparedness for subsequent training" (Bell et al. 2023, Delphi consensus).
- They also agreed a deload can be pre-planned, autoregulated (triggered by signs such as stalled performance or soreness), or both, and that how often depends on how the person responds.
- Hard evidence that deloads improve results is thin: in one RCT a full week off mid-programme did not change muscle growth but slightly reduced strength gains; in another, with untrained men, a reduced-volume deload week cost nothing.
- Practitioners deload about every 4–8 weeks for about a week, mostly by cutting sets and effort while keeping frequency.

**Numbers.**
- **Bell et al. 2023** (Delphi consensus: 34 coaches in round 1, 21 by round 3; full text read on PMC). 100 % agreed that deloading "could be pre-planned", "could be autoregulatory", and that "deload frequency may depend on how athlete responds". Typical practice is every 4–6 weeks for about 7 days (range: one session to 2 weeks); regular pre-planned deloads (every 4–8 weeks) are mostly precautionary, and "regular pre-planned periods of reduced training stress might not be necessary". Expert opinion: the lowest level of evidence.
- **Bell et al. 2022** (qualitative interviews with coaches). The basis for the Delphi.
- **Rogerson et al. 2024** (survey of 246 competitive strength and physique athletes). A deload lasted on average 6.4 ± 1.7 days, every 5.6 ± 2.3 weeks; planned ahead (or planned plus autoregulated), with fewer sets and reps, lighter loads and more reps in reserve, keeping frequency and exercises.
- **Coleman et al. 2024** (RCT; 39 trained adults; 9 weeks; about 90 weekly sets in total; each muscle twice a week; full text read on PMC). A deload week with **no training** at week 5 gave the same quadriceps and calf growth, endurance and power as continuous training, but dynamic and isometric lower-body strength improved less. The authors: programmes of 9 weeks or less at 90 or fewer weekly sets "do not require deloads" in young people. Funded by a grant from Renaissance Periodization; one author co-founded it.
- **Pancar et al. 2026** (within-subject RCT; 19 untrained men; 8 weeks). In weeks 4 and 8 one limb dropped to 1 session a week and 2 sets (from 2 sessions and 6–8 sets). Growth and 10RM matched the continuously trained limb.
- **Pritchard et al. 2018** (§9). A few days fully off after a hard block can raise performance a little, which is why deloads are used before testing.

**Practical rule it supports.** Don't force a deload. Offer one when (a) 4–8 weeks of continuous training have passed with no break, or (b) fatigue signs build: top-set performance stalled or dropped across 2–3 sessions in a row, or the user reports high soreness, joint aches or low motivation. A deload is about 1 week, the same sessions and frequency, about half the sets, a little lighter or 2–3 more reps in reserve — not complete rest. A week with missed sessions, a holiday or illness counts as one.

**Confidence: low.** Two small RCTs plus a consensus and a survey. The finding that a full week off slightly hurt strength is from one study: **moderate** at best.

**Citations.**
- Bell L, Strafford BW, Coleman M, Androulakis Korakakis P, Nolan D. Integrating deloading into strength and physique sports training programmes: an international Delphi consensus approach. *Sports Med Open.* 2023;9(1):87. DOI 10.1186/s40798-023-00633-0 · PMID 37730925 · PMC10511399.
- Bell L, Nolan D, Immonen V, Helms E, et al. "You can't shoot another bullet until you've reloaded the gun": coaches' perceptions, practices and experiences of deloading in strength and physique sports. *Front Sports Act Living.* 2022;4:1073223. DOI 10.3389/fspor.2022.1073223 · PMID 36619355 · PMC9811819.
- Rogerson D, Nolan D, Androulakis Korakakis P, Immonen V, Wolf M, Bell L. Deloading practices in strength and physique sports: a cross-sectional survey. *Sports Med Open.* 2024;10(1):26. DOI 10.1186/s40798-024-00691-y · PMID 38499934 · PMC10948666.
- Coleman M, Burke R, Augustin F, et al. Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations. *PeerJ.* 2024;12:e16777. DOI 10.7717/peerj.16777 · PMID 38274324 · PMC10809978.
- Pancar Z, Ilhan MT, Darendeli MK, et al. Effects of deload periods in resistance training on muscle hypertrophy and strength endurance in untrained young men using a randomized within subject design. *Sci Rep.* 2026;16(1):10299. DOI 10.1038/s41598-026-40612-5 · PMID 41730991 · PMC13031491.

---

## Practical rules for the app

Each rule can be checked against logged Hevy data (weight, reps, RPE per set) and the training plan. "Working sets" are the non-warm-up sets of one exercise in one session. Each rule names its evidence (section) and confidence; *(app choice)* marks a threshold this library picks within what the evidence allows, and *(expert practice)* a rule no trial has tested.

These rules are what the science supports. Where the app does something else today, that is a finding to report, not a bug to fix silently: the owner decides (`AGENTS.md`: the owner's words are the spec).

### Load progression

- **S1. Every exercise has a rep range `[lo, hi]` and a goal (strength or hypertrophy).** Defaults: strength main lifts 3–8 reps; hypertrophy and accessory lifts 6–12. Allow up to 15–20 for small isolation lifts, but say RPE is less reliable above 12 reps. (§4.1, §3; high)
- **S2. Suggest a load increase only when, in the latest session, every working set reached `hi` reps and the hardest set's logged RPE was ≤ 9 (≥ 1 RIR).** If any set was RPE ≥ 9.5, or any set fell short of `hi`, keep the load and aim for more reps. (§1.1 ACSM 2009 "1–2 reps over target" — its full text asks for two consecutive sessions, which S3 adds; §1.2; *expert practice*, trigger untested — low)
- **S3. Stricter trigger when the next step is a large one (S5):** require the S2 condition in **two consecutive sessions**, or `hi + 1` reps or more on the first set. (§1.3 day-to-day CV 3–6 %; §1.1; low)
- **S4. Size the step as a percentage of the current load:** about 2.5–5 % for upper-body or small-muscle lifts, about 5–10 % for large lower-body lifts, rounded to the nearest available plate or dumbbell. (§1.1 ACSM 2009: 2–10 %, lower for small-muscle and higher for large-muscle exercises; the upper/lower sub-bands are a practitioner convention — moderate for 2–10 %, low for the sub-bands)
- **S5. If the smallest available step is larger than 10 % of the load (typical for light dumbbells and cable stacks), don't suggest the jump at `hi`.** Either suggest continuing to `hi + ceil(step% / 2.5)` reps first, or suggest widening the range (for example 8–15). After the jump, expect reps to fall by about 1 per 2–3 % of load added. (§1.3 Lovegrove 2022, derived slope; arithmetic — low)
- **S6. After a load increase, the new load "holds" if the first working set reaches ≥ `lo` reps at RPE ≤ 9.5.** If in **two consecutive sessions** any working set falls below `lo` reps, or is logged at RPE 10 or with a failed rep, suggest going back to the previous load (or about −5 %) and progressing reps again. (§1.5; §2 Helms 2018 missed-rep rule — low)
- **S7. Between-session RPE correction:** top set's RPE above the target band → about −2 % load per 0.5 RPE over; below the band (and reps hit `hi`) → about +2 % per 0.5 RPE under. Cap the step at about 10 %. Apply only when the same direction shows in two sessions. (§2 Helms 2018 protocol; §3 noise — low)

### RPE and effort

- **S8. Treat RPE as bands, not exact values:** ≤ 7.5 easy, 8–9 working, ≥ 9.5 limit. A 0.5-point change in one session never changes a suggestion on its own. (§3 Halperin 2022, Zourdos 2021, Refalo 2024 — high that ratings are noisy)
- **S9. Target bands by goal: hypertrophy sets RPE 8–9.5 (0–2 RIR); strength sets RPE 7–9 (1–3 RIR).** Flag a working set logged at RPE ≤ 6 as "probably too easy to count fully". Don't encourage RPE 10 on barbell compound lifts; failure is fine on isolation or machine lifts. (§4.2 Refalo 2023, Robinson 2024, Refalo 2024; §1.5 Morán-Navarro 2017 — moderate–high)
- **S10. A missing RPE is not treated as easy.** If RPE wasn't logged, S2 requires `hi` reps on all sets in **two** consecutive sessions instead. (§3: RPE is the safety check; without it, repetition is — low)
- **S11. Lifters tend to underestimate their reps in reserve, so allow a margin.** An explanation may say a set rated 8 likely had about 3 reps left, not 2. Never push the user toward failure because of this. (§3 Halperin 2022, Armes 2020, Steele 2017 — high for the direction)

### Progress and plateaus

- **S12. Count more reps at the same load, or a higher e1RM, as progress.** A week with no load increase but more reps in the same RPE band is progress, not a plateau. (§1.2 Plotkin 2022 — moderate)
- **S13. Detect a plateau from the trend, not single sessions.** An exercise is "stalled" only if its best e1RM (or reps at the same load) has not improved over **≥ 3 weeks and ≥ 4 sessions** of that exercise. A single lower session is ignored. (§1.4 Latella 2020, Steele 2023; §1.3 day-to-day CV — moderate for the idea, low for the exact numbers)
- **S14. Expectations scale with training age.** In the first months on an exercise, a load increase every 1–2 sessions is plausible; with years of training, a few percent over a block of several weeks is normal. Wording never implies slow progress is failure. (§1.4 Rhea 2003, Latella 2020 — high for the direction)

### Estimated 1RM

- **S15. e1RM is an estimate, shown as one.** One formula for every screen (Epley today); computed only from sets of about ≤ 10–12 reps; compared only within the same exercise over time, never between exercises or people. Say it is estimated wherever it is shown. (§5 Reynolds 2006, Mayhew 1995, Nickerson 2020 — moderate)
- **S16. A small e1RM change is not a signal.** A session-to-session change smaller than day-to-day scatter (about 3–6 %, §1.3) is noise; read the trend over weeks (S13). (§1.3, §5; derived — low)

### Volume and frequency

- **S17. Weekly sets per muscle** = hard sets over a rolling 7 days ending today. Direct set 1, indirect set 0.5, warm-up 0. (§6.1 — moderate)
- **S18. Volume bands per muscle per 7 days:** below 4 = "below minimum"; 4–9 = "low"; 10–20 = "target"; 21–30 = "high, extra sets add less"; above 30 = "very high, little extra expected". No band is shown as an error. (§6.1; high for direction, moderate for the edges — **preprint** numbers)
- **S19. Frequency:** the default plan hits each major muscle at least 2 times in 7 days. Never warn when a muscle's weekly sets came from a single session. (§7.1; high for size, moderate for strength)

### Schedule: moved and missed sessions

- **S20. Moved, not missed:** a planned session done within ±2 calendar days of its planned date, and before the next session in the sequence, counts as that session and is labelled "moved". *(±2 days: app choice)* (§7.1, §8.1; moderate in direction, low for the window)
- **S21. Missed:** a planned session not done within its ±2-day window, or skipped over (a later session in the sequence was done first), is "missed". A missed session never reduces any progress or strength figure. (§8.2, §9)
- **S22. What to do next** = the earliest undone session in the plan's sequence, not the session tied to today's weekday. (§8.1 — moderate)
- **S23. After a missed session, the default is shift:** the missed session becomes next and the rest move back. (§8.2 — low)
- **S24. Same-muscle spacing:** when a shift would put two hard sessions for the same muscle less than 24 h apart, offer skip or partial merge instead; 24–48 h apart, a soft note only. Upper and lower on consecutive days is always fine. *(24/48 h: app choice from MPS and recovery data)* (§7.2 — moderate/low)
- **S25. Partial merge:** add at most about 2–4 sets per missed muscle to the remaining sessions of the week. Never two full sessions on one day. *(2–4: app choice)* (§8.2 — low)
- **S26. No catch-up stacking:** never move more than one missed session into the following week. Older misses are dropped (skip): weekly volume going forward matters more than repaying old sessions. (§6.1, §8.2, §9 — low)

### Breaks, maintenance and deloads

- **S27. Short gap (14 days or less since a muscle was last trained):** resume the plan unchanged, no warning. (§9 — moderate)
- **S28. Medium gap (15–28 days):** resume the plan; suggest slightly lighter loads or 2 more reps in reserve for the first 1–2 sessions. *(app choice)* (§9 — low)
- **S29. Long gap (more than 28 days):** "comeback". The first week runs at about half the sets and lighter loads, then returns to the plan. Tell the user losses come back within a few weeks. (§9; moderate that it comes back fast, low for the cut-off)
- **S30. Maintenance for busy weeks:** 1 or more sessions per 7 days, heavy (same loads), about one-third of the usual sets. This holds strength and size for months. (§9 Bickel 2011, Spiering 2021 — moderate)
- **S31. Deload suggestion — offer, never force — when either** (a) 4–8 weeks have passed since the last easy week or break, or (b) the top-set load × reps of a main lift has not risen in its last 3 sessions, or the user reports high fatigue or soreness. The deload is 1 week, same sessions, about half the sets, 2–3 more reps in reserve. (§10 — low)
- **S32. A week with 50 % or fewer of its planned sessions (holiday, illness) counts as a deload;** the S31(a) clock resets. (§9, §10 — low)

---

## Open questions and weak evidence

**Progression and RPE**
- **Double-progression triggers are untested.** No RCT compares "all sets at top of range" vs "first set only" vs "RPE ≤ 8 vs ≤ 9" triggers. S2, S3, S6 and S10 are expert practice consistent with ACSM 2009, not tested optimums.
- **ACSM 2009 full text.** It was not re-opened on 27.11.2026 (paywall). The "two consecutive sessions" wording and the small/large-muscle split come from the repo's earlier check (`docs/training-health/research/verify-science.json`); the ACSM 2026 full text was read on PMC but its progression details were taken from the abstract.
- **Increment size.** One small, old microloading trial (Hostler 2001, n = 19, 8 weeks); its hint that bigger steps work better long-term is "preliminary". The rep-per-load slope behind S5 comes from novices on deadlift and bench (Lovegrove 2022) and may differ for isolation lifts and dumbbells.
- **Risk of increasing too soon.** No data link progression speed to injury or stalling in recreational lifters. Injury epidemiology is mostly retrospective and in competitive sports (Keogh 2017).
- **Autoregulation's advantage is small and uncertain.** The positive trials are small, short (6–12 weeks) and in young trained men or athletes; the best pooled estimate in trained people is not significant (Hickmott 2022: +2 kg, CI crosses zero); Zhang 2021's subgroup effect sizes look implausibly large. APRE evidence comes mostly from athletes (Mann 2010, n = 23) and is untested in recreational upper/lower splits.
- **RPE accuracy data are mostly squat and bench, often single sets to failure in a lab.** Hevy RPE is logged *after* the set, while most studies used *intraset* calls; whether post-set RPE is more or less accurate is not well studied. Few women in most datasets, though Refalo 2024 and Remmert 2023 found no sex effect.
- **Does practice improve RIR accuracy?** Mixed: Steele 2017 says somewhat; Halperin 2022 and Remmert 2023 (6 weeks of practice) found no clear improvement.
- **Proximity-to-failure dose-response.** Robinson 2024 is exploratory and uses RIR *estimated* from study descriptions. The RIR that is "enough" for hypertrophy is not pinned down; 0–3 RIR is the defensible range.
- **Long-term progression rates for recreational lifters.** The registry data are competitive powerlifters (Latella 2020) or once-a-week supervised minimal-dose training (Steele 2023); neither matches a 3–4 day split.

**Estimated 1RM**
- **No single verified error figure for Epley in our setting.** The studies (§5) are bench and leg press with sets to true failure; Hevy sets usually stop short of failure, which makes e1RM read low. Reynolds 2006 advises ≤ 10 reps for linear equations, while the app accepts up to 12 (`EST_1RM_MAX_REPS`). A percentage error (for example "±10 %") should not be quoted until a paper that states it has been checked.

**Volume and schedule**
- **No direct trial of a missed or moved session.** Shift vs skip vs merge, and the ±2-day "counts as done" window, are built from indirect evidence (volume-equated frequency studies, flexible periodization RCTs). This is the weakest link for the app's schedule features.
- **Per-session volume ceiling.** Whether merging sessions into a very long one wastes sets is unknown; the Pelland group's per-session work is not peer reviewed as of 27.11.2026.
- **Pelland et al. numbers.** The band edges and slopes come from the 2024 preprint; the peer-reviewed version (Sports Med 2026) could not be read past the paywall and may differ slightly. Very few studies tested more than about 25 sets per muscle per week.
- **Training status and sex.** Most frequency, break and MPS studies used untrained or lightly trained young men. Trained lifters have shorter MPS rises (Tang 2008) and may respond differently to breaks. Women are under-represented (about 21 % in Pelland, 45 % in Halonen).
- **Bosquet 2013's week-by-week detraining curve** was not verified (paywall), so the 14- and 28-day cut-offs are app choices.
- **Deloads.** Two small RCTs — one with full rest (Coleman 2024, industry-funded) and one in untrained men (Pancar 2026) — plus expert consensus and surveys. Nobody has compared planned with autoregulated deloads.
- **Consecutive-day training of the same muscle** rests on two small RCTs with full-body programmes and indirect measures of muscle.
- **Flexible periodization** trials are small (16–25 people). McNamara & Stearne 2010's large leg-press advantage has not been replicated, so claim only "flexible is not worse".
