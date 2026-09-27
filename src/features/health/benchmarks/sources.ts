// Citations behind every reference range and guidance sentence on the Health
// page. Pure data, import-free. Each entry was checked against the primary
// source during the 2026-09 research pass; where the fact-check corrected the
// research, the corrected figure is the one used in healthBenchmarks.ts /
// healthGuidance.ts.

export interface Source {
  citation: string
  url: string
}

export const SRC = {
  friend2015: {
    citation: 'Kaminsky LA et al. Reference standards for cardiorespiratory fitness measured with CPX (FRIEND). Mayo Clin Proc 2015 — Table 3, treadmill',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4919021/',
  },
  friend2022: {
    citation: 'Kaminsky LA et al. Updated reference standards for cardiorespiratory fitness (FRIEND). Mayo Clin Proc 2022',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34809986/',
  },
  hunt3: {
    citation: 'Loe H et al. Aerobic capacity reference data in 3816 healthy men and women 20–90 years (HUNT3). PLoS One 2013',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3654926/',
  },
  ntnuCerg: {
    citation: 'NTNU CERG — Fitness numbers (HUNT reference means)',
    url: 'https://www.ntnu.edu/cerg/fitness-numbers',
  },
  mandsager2018: {
    citation: 'Mandsager K et al. Association of cardiorespiratory fitness with long-term mortality among adults undergoing exercise treadmill testing. JAMA Netw Open 2018',
    url: 'https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2707428',
  },
  kodama2009: {
    citation: 'Kodama S et al. Cardiorespiratory fitness as a quantitative predictor of all-cause mortality and cardiovascular events. JAMA 2009',
    url: 'https://pubmed.ncbi.nlm.nih.gov/19454641/',
  },
  lang2024: {
    citation: 'Lang JJ et al. Cardiorespiratory fitness is a strong and consistent predictor of morbidity and mortality among adults. Br J Sports Med 2024',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11103301/',
  },
  lambe2025: {
    citation: 'Lambe R et al. Investigating the accuracy of Apple Watch VO2 max measurements. PLoS One 2025',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12080799/',
  },
  lambe2026: {
    citation: 'Accuracy of VO2 max estimates from Apple Watch Series 10. Mayo Clin Proc Digit Health 2026',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13141568/',
  },
  caserman2024: {
    citation: 'Caserman P et al. Accuracy of smartwatch-based VO2max estimation using Apple Watch Series 7. JMIR Biomed Eng 2024',
    url: 'https://biomedeng.jmir.org/2024/1/e59459',
  },
  appleCardio: {
    citation: 'Apple Support — Cardio Fitness (VO2 max) on Apple Watch',
    url: 'https://support.apple.com/en-us/108790',
  },
  milanovic2015: {
    citation: 'Milanović Z et al. Effectiveness of high-intensity interval training and continuous endurance training for VO2max improvements. Sports Med 2015',
    url: 'https://pubmed.ncbi.nlm.nih.gov/26243014/',
  },
  helgerud2007: {
    citation: 'Helgerud J et al. Aerobic high-intensity intervals improve VO2max more than moderate training. Med Sci Sports Exerc 2007',
    url: 'https://rcc.hslu.ch/fileadmin/user_upload/downloads/sport/Aerobic_High-Intensity_Intervals_Improve_J.Helgerud_2007.pdf',
  },
  storoschuk2025: {
    citation: 'Storoschuk KL et al. Much ado about Zone 2: a narrative review. Sports Med 2025',
    url: 'https://pubmed.ncbi.nlm.nih.gov/40560504/',
  },
  montero2017: {
    citation: 'Montero D, Lundby C. Refuting the myth of non-response to exercise training. J Physiol 2017',
    url: 'https://pubmed.ncbi.nlm.nih.gov/28133739/',
  },
  tanaka2001: {
    citation: 'Tanaka H et al. Age-predicted maximal heart rate revisited. J Am Coll Cardiol 2001',
    url: 'https://pubmed.ncbi.nlm.nih.gov/11153730/',
  },
  nhanesPulse: {
    citation: 'Ostchega Y et al. Resting pulse rate reference data for the United States, 1999–2008. National Health Statistics Reports 41, 2011',
    url: 'https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf',
  },
  zhang2016: {
    citation: 'Zhang D et al. Resting heart rate and all-cause and cardiovascular mortality in the general population: a meta-analysis. CMAJ 2016',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4754196/',
  },
  aune2017: {
    citation: 'Aune D et al. Resting heart rate and the risk of cardiovascular disease, total cancer, and all-cause mortality. Nutr Metab Cardiovasc Dis 2017',
    url: 'https://pubmed.ncbi.nlm.nih.gov/28552551/',
  },
  reimers2018: {
    citation: 'Reimers AK et al. Effects of exercise on the resting heart rate: a systematic review and meta-analysis. J Clin Med 2018',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6306777/',
  },
  appleWatchHrv2024: {
    citation: 'The validity of Apple Watch Series 9 and Ultra 2 for serial measurements of heart rate variability and resting heart rate. 2024',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11478500/',
  },
  voss2015: {
    citation: 'Voss A et al. Short-term heart rate variability — influence of gender and age in healthy subjects. PLoS One 2015',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4378923/',
  },
  hillebrand2013: {
    citation: 'Hillebrand S et al. Heart rate variability and first cardiovascular event in populations without known cardiovascular disease. Europace 2013',
    url: 'https://pubmed.ncbi.nlm.nih.gov/23370966/',
  },
  shaffer2017: {
    citation: 'Shaffer F, Ginsberg JP. An overview of heart rate variability metrics and norms. Front Public Health 2017',
    url: 'https://pubmed.ncbi.nlm.nih.gov/29034226/',
  },
  plews2013: {
    citation: 'Plews DJ et al. Training adaptation and heart rate variability in elite endurance athletes. Sports Med 2013',
    url: 'https://pubmed.ncbi.nlm.nih.gov/23852425/',
  },
  hrvExercise2024: {
    citation: 'Effects of exercise training on heart rate variability in healthy adults: a systematic review and meta-analysis of RCTs. Cureus 2024',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11250637/',
  },
  paluch2022: {
    citation: 'Paluch AE et al. Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts. Lancet Public Health 2022',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9289978/',
  },
  banach2023: {
    citation: 'Banach M et al. The association between daily step count and all-cause and cardiovascular mortality: a meta-analysis. Eur J Prev Cardiol 2023',
    url: 'https://pubmed.ncbi.nlm.nih.gov/37555441/',
  },
  ding2025: {
    citation: 'Ding D et al. Daily steps and health outcomes in adults: a systematic review and dose-response meta-analysis. Lancet Public Health 2025',
    url: 'https://pubmed.ncbi.nlm.nih.gov/40713949/',
  },
  wristSteps: {
    citation: 'Wrist- vs hip-worn accelerometer step counts in free living. Front Med 2019',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6849483/',
  },
  watson2015: {
    citation: 'Watson NF et al. Recommended amount of sleep for a healthy adult: AASM/SRS joint consensus. Sleep 2015',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/',
  },
  hirshkowitz2015: {
    citation: 'Hirshkowitz M et al. National Sleep Foundation’s sleep time duration recommendations. Sleep Health 2015',
    url: 'https://pubmed.ncbi.nlm.nih.gov/29073412/',
  },
  cappuccio2010: {
    citation: 'Cappuccio FP et al. Sleep duration and all-cause mortality: a systematic review and meta-analysis. Sleep 2010',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2864873/',
  },
  windred2024: {
    citation: 'Windred DP et al. Sleep regularity is a stronger predictor of mortality risk than sleep duration. Sleep 2024',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/',
  },
  boulos2019: {
    citation: 'Boulos MI et al. Normal polysomnography parameters in healthy adults: a systematic review and meta-analysis. Lancet Respir Med 2019',
    url: 'https://pubmed.ncbi.nlm.nih.gov/31006560/',
  },
  craven2022: {
    citation: 'Craven J et al. Effects of acute sleep loss on physical performance. Sports Med 2022',
    url: 'https://pubmed.ncbi.nlm.nih.gov/35708888/',
  },
  nedeltcheva2010: {
    citation: 'Nedeltcheva AV et al. Insufficient sleep undermines dietary efforts to reduce adiposity. Ann Intern Med 2010',
    url: 'https://pubmed.ncbi.nlm.nih.gov/20921542/',
  },
  lamon2021: {
    citation: 'Lamon S et al. The effect of acute sleep deprivation on skeletal muscle protein synthesis. Physiol Rep 2021',
    url: 'https://pubmed.ncbi.nlm.nih.gov/33400856/',
  },
  gallagher2000: {
    citation: 'Gallagher D et al. Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index. Am J Clin Nutr 2000',
    url: 'https://pubmed.ncbi.nlm.nih.gov/10966886/',
  },
  ace: {
    citation: 'American Council on Exercise — body fat percentage categories',
    url: 'https://www.acefitness.org/about-ace/press-room/in-the-news/8602/body-fat-percentage-charting-averages-in-men-and-women-very-well-health/',
  },
  gbmc2016: {
    citation: 'Global BMI Mortality Collaboration. Body-mass index and all-cause mortality: individual-participant-data meta-analysis. Lancet 2016',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4995441/',
  },
  nice246: {
    citation: 'NICE NG246 — Identifying and assessing overweight, obesity and central adiposity',
    url: 'https://www.nice.org.uk/guidance/ng246/chapter/Identifying-and-assessing-overweight-obesity-and-central-adiposity',
  },
  who2008Waist: {
    citation: 'WHO. Waist circumference and waist–hip ratio: report of a WHO expert consultation, 2008',
    url: 'https://iris.who.int/server/api/core/bitstreams/ca408ade-05c9-4b7c-8967-6ee5b5e0ccd8/content',
  },
  ashwell2012: {
    citation: 'Ashwell M et al. Waist-to-height ratio is a better screening tool than waist circumference and BMI. Obes Rev 2012',
    url: 'https://pubmed.ncbi.nlm.nih.gov/22106927/',
  },
  who2020: {
    citation: 'Bull FC et al. WHO 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med 2020',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/',
  },
  arem2015: {
    citation: 'Arem H et al. Leisure time physical activity and mortality: a detailed pooled analysis of the dose-response relationship. JAMA Intern Med 2015',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4451435/',
  },
  garber2011: {
    citation: 'Garber CE et al. ACSM position stand: quantity and quality of exercise for developing and maintaining fitness. Med Sci Sports Exerc 2011',
    url: 'https://pubmed.ncbi.nlm.nih.gov/21694556/',
  },
  momma2022: {
    citation: 'Momma H et al. Muscle-strengthening activities are associated with lower risk and mortality in major non-communicable diseases. Br J Sports Med 2022',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9209691/',
  },
  saeidifard2019: {
    citation: 'Saeidifard F et al. The association of resistance training with mortality: a systematic review and meta-analysis. Eur J Prev Cardiol 2019',
    url: 'https://pubmed.ncbi.nlm.nih.gov/31104484/',
  },
  schumann2022: {
    citation: 'Schumann M et al. Compatibility of concurrent aerobic and strength training for skeletal muscle size and function. Sports Med 2022',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34757594/',
  },
  wilson2012: {
    citation: 'Wilson JM et al. Concurrent training: a meta-analysis examining interference of aerobic and resistance exercises. J Strength Cond Res 2012',
    url: 'https://pubmed.ncbi.nlm.nih.gov/22002517/',
  },
  cole1999: {
    citation: 'Cole CR et al. Heart-rate recovery immediately after exercise as a predictor of mortality. N Engl J Med 1999',
    url: 'https://pubmed.ncbi.nlm.nih.gov/10536127/',
  },
  qiu2017: {
    citation: 'Qiu S et al. Heart rate recovery and risk of cardiovascular events and all-cause mortality: a meta-analysis. J Am Heart Assoc 2017',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5524096/',
  },
  studenski2011: {
    citation: 'Studenski S et al. Gait speed and survival in older adults. JAMA 2011',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3080184/',
  },
  bohannon2011: {
    citation: 'Bohannon RW, Williams Andrews A. Normal walking speed: a descriptive meta-analysis. Physiotherapy 2011',
    url: 'https://pubmed.ncbi.nlm.nih.gov/21820535/',
  },
  natarajan2021: {
    citation: 'Natarajan A et al. Measurement of respiratory rate using wearable devices and applications to COVID-19 detection. npj Digit Med 2021',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8443549/',
  },
  whoOximetry: {
    citation: 'WHO Pulse Oximetry Training Manual (normal saturation 95–100%)',
    url: 'https://cdn.who.int/media/docs/default-source/patient-safety/pulse-oximetry/who-ps-pulse-oxymetry-training-manual-en.pdf',
  },
  appleSpo2Review: {
    citation: 'Accuracy of the Apple Watch oxygen saturation measurement in adults: a systematic review. Cureus 2023',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10039641/',
  },
  mifflin1990: {
    citation: 'Mifflin MD et al. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr 1990',
    url: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
  },
} as const satisfies Record<string, Source>
