// The research the Training tabs cite — one list, so a source is named the
// same way everywhere. Citations and URLs come from
// docs/training-health/research/research-science.json, fact-checked in
// verify-science.json (a correction there wins; e.g. ACSM 2009's load rule is
// 2–10% after two consecutive sessions, with no upper/lower-body split).

export interface Source { id: string; short: string; citation: string; url: string }

export const SOURCES = {
  pelland2025: {
    id: 'pelland2025', short: 'Pelland 2025',
    citation: 'Pelland JC et al. The Resistance Training Dose Response: meta-regressions of weekly volume and frequency. Sports Med 2025 (67 studies).',
    url: 'https://pubmed.ncbi.nlm.nih.gov/41343037/',
  },
  acsm2026: {
    id: 'acsm2026', short: 'ACSM 2026',
    citation: 'Currier BS et al. ACSM Position Stand: Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults. Med Sci Sports Exerc 2026.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/41843416/',
  },
  acsm2009: {
    id: 'acsm2009', short: 'ACSM 2009',
    citation: 'ACSM Position Stand. Progression models in resistance training for healthy adults. Med Sci Sports Exerc 2009;41:687-708.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/19204579/',
  },
  plotkin2022: {
    id: 'plotkin2022', short: 'Plotkin 2022',
    citation: 'Plotkin D et al. Progressive overload without progressing load? Load vs repetition progression. PeerJ 2022;10:e14142.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/36199287/',
  },
  schoenfeld2017: {
    id: 'schoenfeld2017', short: 'Schoenfeld 2017',
    citation: 'Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass. J Sports Sci 2017;35:1073-82.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/27433992/',
  },
  bazValle2022: {
    id: 'bazValle2022', short: 'Baz-Valle 2022',
    citation: 'Baz-Valle E et al. A Systematic Review of the Effects of Different Resistance Training Volumes on Muscle Hypertrophy. J Hum Kinet 2022.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/35291645/',
  },
  schoenfeld2019: {
    id: 'schoenfeld2019', short: 'Schoenfeld 2019',
    citation: 'Schoenfeld BJ, Grgic J, Krieger J. How many times per week should a muscle be trained to maximize muscle hypertrophy? J Sports Sci 2019.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/30558493/',
  },
  kolber2009: {
    id: 'kolber2009', short: 'Kolber 2009',
    citation: 'Kolber MJ et al. Shoulder joint and muscle characteristics in the recreational weight training population. J Strength Cond Res 2009.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/19077737/',
  },
  vanDyk2019: {
    id: 'vanDyk2019', short: 'van Dyk 2019',
    citation: 'van Dyk N, Behan FP, Whiteley R. Including the Nordic hamstring exercise in injury prevention programmes halves the rate of hamstring injuries. Br J Sports Med 2019.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/30808663/',
  },
  watson2015: {
    id: 'watson2015', short: 'AASM/SRS 2015',
    citation: 'Watson NF et al. Recommended Amount of Sleep for a Healthy Adult: AASM/SRS Joint Consensus Statement. J Clin Sleep Med 2015.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/25979105/',
  },
  craven2022: {
    id: 'craven2022', short: 'Craven 2022',
    citation: 'Craven J et al. Effects of Acute Sleep Loss on Physical Performance: A Systematic and Meta-Analytical Review. Sports Med 2022.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/35708888/',
  },
  bell2023: {
    id: 'bell2023', short: 'Bell 2023',
    citation: 'Bell L et al. Integrating Deloading into Strength and Physique Sports Training Programmes: An International Delphi Consensus Approach. Sports Med Open 2023.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/37730925/',
  },
  // RPE / reps in reserve (the Next card's effort note and the RPE explainer).
  robinson2024: {
    id: 'robinson2024', short: 'Robinson 2024',
    citation: 'Robinson ZP et al. Exploring the Dose-Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy. Sports Med 2024.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/38970765/',
  },
  refalo2023: {
    id: 'refalo2023', short: 'Refalo 2023',
    citation: 'Refalo MC et al. Influence of Resistance Training Proximity-to-Failure on Skeletal Muscle Hypertrophy. Sports Med 2023.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/36334240/',
  },
  halperin2022: {
    id: 'halperin2022', short: 'Halperin 2022',
    citation: 'Halperin I et al. Accuracy in Predicting Repetitions to Task Failure in Resistance Exercise. Sports Med 2022.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34542869/',
  },
} as const satisfies Record<string, Source>

export type SourceId = keyof typeof SOURCES
