import type { Source } from '../benchmarks/sources'

// Citations behind the goal report's pace bands, fat-vs-muscle reading,
// energy density and protein floor — the same shape as benchmarks/sources.ts.

export const GOAL_SRC = {
  helms2014prep: {
    citation: 'Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr 2014',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/',
  },
  garthe2011: {
    citation: 'Garthe I et al. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. Int J Sport Nutr Exerc Metab 2011',
    url: 'https://pubmed.ncbi.nlm.nih.gov/21558571/',
  },
  iraki2019: {
    citation: 'Iraki J, Fitschen P, Espinar S, Helms E. Nutrition recommendations for bodybuilders in the off-season: a narrative review. Sports 2019',
    url: 'https://www.mdpi.com/2075-4663/7/7/154',
  },
  looney2024: {
    citation: 'Looney DP et al. Reliability, biological variability, and accuracy of multi-frequency bioelectrical impedance analysis for measuring body composition components. Front Nutr 2024',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11649400/',
  },
  hall2008: {
    citation: 'Hall KD. What is the required energy deficit per unit weight loss? Int J Obes 2008',
    url: 'https://pubmed.ncbi.nlm.nih.gov/17848938/',
  },
  morton2018: {
    citation: 'Morton RW et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength. Br J Sports Med 2018',
    url: 'https://pubmed.ncbi.nlm.nih.gov/28698222/',
  },
  helms2014protein: {
    citation: 'Helms ER et al. A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes. Int J Sport Nutr Exerc Metab 2014',
    url: 'https://pubmed.ncbi.nlm.nih.gov/24092765/',
  },
} satisfies Record<string, Source>

export type GoalSourceKey = keyof typeof GOAL_SRC
