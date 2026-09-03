# References

Cited during the algorithm-review rounds that shaped this engine (both a
`sports-scientist` and a `strength-coach` agent review, plus the brief's
own reference list). Used as context/grounding for the small number of
genuinely evidence-backed pieces of this engine — most thresholds here are
explicitly `product_rule`/`program_policy`, not scientific findings (see
`DECISION_RULES.md`).

- Currier, B.S. et al. (2026). "Resistance Training Prescription for Muscle
  Function, Hypertrophy, and Physical Performance in Healthy Adults: An
  Overview of Reviews." *Medicine & Science in Sports & Exercise*. PMID
  41843416. https://pubmed.ncbi.nlm.nih.gov/41843416/
- American College of Sports Medicine (2009). "Progression Models in
  Resistance Training for Healthy Adults." *Med Sci Sports Exerc* 41(3):
  687-708. PMID 19204579; DOI 10.1249/MSS.0b013e3181915670. Used only as
  broad historical context for the load-increment ladder — never as an
  automatic per-exercise/per-equipment rule.
  https://pubmed.ncbi.nlm.nih.gov/19204579/
- Plotkin, D. et al. (2022). "Progressive overload without progressing
  load?" *PeerJ* 10:e14142. DOI 10.7717/peerj.14142.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/ — both load progression
  and repetition progression are legitimate strategies; the engine
  recognizes both (`REP_INCREASE`/rep-delta as a first-class signal, not
  just load transitions).
- Nuzzo, J.L. et al. (2024). *Sports Medicine* 54:303-321. DOI
  10.1007/s40279-023-01937-7. Reps at a given %1RM vary substantially by
  exercise/equipment — supports treating load increments as
  equipment-class defaults, never a universal number.
  https://pubmed.ncbi.nlm.nih.gov/37792272/
- Macarilla, C.T. et al. (2022). *Journal of Human Kinetics*. PMID
  36196346. e1RM validity is exercise/context-dependent — supports keeping
  Estimated Strength secondary and always labeled.
  https://pubmed.ncbi.nlm.nih.gov/36196346/
- Helms, E.R. et al. (2016). *Strength & Conditioning Journal*. DOI
  10.1519/SSC.0000000000000218. RIR-based scale usefulness/limitations —
  informed the decision to make RPE/RIR strictly optional context, never a
  gate (see `DATA_AND_LIMITATIONS.md`).
- Refalo, M.C. et al. (2023). *Sports Medicine* 53(3):649-665. Proximity-
  to-failure/RIR effect size — small but real; its absence is treated as a
  real information gap, not disqualifying.
- Grgic, J. et al. (2022). *J Sport Health Sci* 11(2):202-211. Same topic,
  corroborating.
- LeSuer, D.A. et al. (1997). *J Strength Cond Res* 11(4):211-213. Supports
  the ≤12-rep e1RM eligibility ceiling (`EST_1RM_MAX_REPS`,
  `progressAggregate.ts`) already established in this app's pre-existing
  Personal Records feature and reused unchanged here.
- Damas, F. et al. (2016). *J Physiol* 594(18):5209-5222. Used only
  analogically — single-point signals misrepresent a training response
  over time — to support checking every prescribed set, not just the top
  set.
- Schoenfeld, B.J. et al. (2017); Morton, R.W. et al. (2016) — already
  cited elsewhere in this repo's Training feature documentation
  (`CLAUDE.md`) for the rep-range-distribution boundaries; not re-derived
  here, referenced for consistency since this engine's rep-delta logic
  touches the same rep-range territory.
