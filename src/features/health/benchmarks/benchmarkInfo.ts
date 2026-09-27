// What each benchmarked metric means, how to move it and what to be careful
// about. Pure data, import-free apart from the citation list. Numbers follow
// the fact-checked research (2026-09); where the fact-check corrected the
// first draft (Mandsager ladder, Cole's adjusted RR, Windred's model, wrist
// step direction, Milanović repetition claim), the corrected form is used.
import { SRC } from './sources'
import type { BenchmarkInfo, BenchmarkMetric } from './types'

const WATCH_VO2 =
  'Apple Watch estimates VO2 max only from outdoor walks, runs and hikes (range 14–65). In validation studies of mostly fit adults it read 4.5–6.3 ml/kg/min below lab tests on average, with a typical error of about ±7; the gap was larger in fitter people and small (not significant) in the lower-fitness subgroup, and one study found overestimation in poorly fit people. Only 14% were placed in the right percentile band. Read the trend, not a single value.'

export const BENCHMARKS: Record<BenchmarkMetric, BenchmarkInfo> = {
  vo2_max: {
    title: 'VO₂ max (cardio fitness)',
    unit: 'ml/kg/min',
    whatItMeans:
      'How much oxygen your body can use per kilogram per minute at full effort — the standard measure of aerobic fitness and one of the strongest markers of long-term health. In a study of 122,007 treadmill tests, low fitness carried more risk than smoking, diabetes or coronary disease (Mandsager 2018).',
    howToImprove:
      'Aerobic training raises it. Across 28 trials in healthy adults aged 18–45, endurance training added about 4.9 ml/kg/min and interval training about 5.5 over a programme compared with no training; interval gains were larger at lower starting fitness and in longer programmes (Milanović 2015). A well-tested protocol is 4 × 4 minutes at 90–95% of max heart rate with 3 easy minutes between, three times a week (Helgerud 2007: +7.2% in 8 weeks). Because it is per kilogram, losing fat raises it too: 5% less body mass at the same heart capacity reads about 5% higher.',
    caveats:
      `${WATCH_VO2} Bands use FRIEND 2015 (directly measured treadmill tests of healthy US adults). The 2022 FRIEND update has medians 1.5–4.6 ml/kg/min lower, so the same value would rank a little higher against it; its full tables could not be verified, so it isn't used. Healthy Norwegian volunteers (HUNT3) average higher than both. Mortality figures come from estimated fitness in clinical referrals, so linking them to FRIEND percentiles is approximate.`,
    sources: [SRC.friend2015, SRC.friend2022, SRC.hunt3, SRC.mandsager2018, SRC.kodama2009, SRC.lang2024, SRC.milanovic2015, SRC.helgerud2007, SRC.lambe2025, SRC.lambe2026, SRC.caserman2024, SRC.appleCardio],
    higherIsBetter: true,
    confidence: 'high',
  },
  resting_heart_rate: {
    title: 'Resting heart rate',
    unit: 'bpm',
    whatItMeans:
      'Your heart rate when fully at rest. Lower usually means a fitter heart; a persistently high one is an independent risk marker — each 10 bpm higher is linked to about 9% higher all-cause mortality (Zhang 2016).',
    howToImprove:
      'Endurance training is the main lever: in men it took resting heart rate from about 70 to 64 bpm (Reimers 2018, 191 studies). Strength training alone lowered it about 2 bpm, which was not significant. It rises for a few days with illness, alcohol, heat, poor sleep or very hard training.',
    caveats:
      'The population figures are a seated clinic pulse (NHANES); Apple estimates resting heart rate from background readings while you are inactive. Apple Watch agrees well with a chest strap here (average error about 3.7 bpm). Use the reference for orientation and your own trend for decisions.',
    sources: [SRC.nhanesPulse, SRC.zhang2016, SRC.aune2017, SRC.reimers2018, SRC.appleWatchHrv2024],
    higherIsBetter: false,
    confidence: 'high',
  },
  heart_rate_variability: {
    title: 'Heart rate variability (SDNN)',
    unit: 'ms',
    whatItMeans:
      'How much the time between heartbeats varies. More variability generally means your rest-and-recover system is active. It falls naturally with age and swings day to day, so it is most useful against your own baseline.',
    howToImprove:
      'Regular exercise raises it moderately (16 randomised trials, SMD 0.58). What lowers resting heart rate — aerobic fitness, enough sleep, less alcohol and stress — tends to raise it.',
    caveats:
      'Apple reports SDNN from roughly one-minute readings every few hours; published norms use 5-minute or 24-hour ECG recordings, which are not interchangeable. Against a chest strap, Apple Watch read about 8 ms lower on average with a wide spread (MAPE 29%). Compare a 7-day average with your own 60-day range, and never compare SDNN with RMSSD (what Oura, Whoop and Garmin show).',
    sources: [SRC.voss2015, SRC.shaffer2017, SRC.plews2013, SRC.hillebrand2013, SRC.hrvExercise2024, SRC.appleWatchHrv2024],
    higherIsBetter: true,
    confidence: 'medium',
  },
  step_count: {
    title: 'Daily steps',
    unit: 'steps/day',
    whatItMeans:
      'Everyday movement outside workouts. More steps are linked to lower mortality up to an age-dependent plateau: about 8,000–10,000 a day under 60 and 6,000–8,000 from 60 (Paluch 2022).',
    howToImprove:
      'About 1,000 more steps a day — roughly 10 minutes of walking — is linked to about 15% lower all-cause mortality (Banach 2023, observational). Walking breaks, walking part of a commute and a short walk after meals add up. A brisker pace was linked to extra benefit beyond the count itself (Paluch 2022).',
    caveats:
      'Most cohorts used hip-worn accelerometers. In daily life wrist devices usually count more steps than hip devices (consumer watches about 3–15% more), so a watch count may place you slightly higher on these ladders than you really are. Arm-heavy activity inflates counts; pushing a trolley or holding a rail deflates them.',
    sources: [SRC.paluch2022, SRC.banach2023, SRC.ding2025, SRC.wristSteps],
    higherIsBetter: true,
    confidence: 'high',
  },
  sleep_duration: {
    title: 'Sleep duration',
    unit: 'h/night',
    whatItMeans:
      'How long you sleep. Adults should regularly get 7 hours or more (AASM/SRS); regularly less is linked to weight gain, diabetes, high blood pressure, heart disease, depression and higher mortality.',
    howToImprove:
      'Give yourself at least 7 hours in bed for sleep, and fix your wake time first — weekends included — so bedtime follows.',
    caveats:
      'Most of the evidence uses self-reported sleep, which runs higher than measured sleep: healthy adults measured in a sleep lab average only 6.2–6.8 h asleep. A watch counts time asleep, not time in bed, so 6.5–7 h on the watch is not the same as "short" by self-report standards. Stage estimates (deep, REM) from the wrist are weak.',
    sources: [SRC.watson2015, SRC.hirshkowitz2015, SRC.cappuccio2010, SRC.windred2024, SRC.boulos2019],
    higherIsBetter: null,
    confidence: 'high',
  },
  sleep_regularity: {
    title: 'Sleep regularity',
    unit: 'min (spread of wake time)',
    whatItMeans:
      'How consistent your sleep and wake times are. In 60,977 people with activity trackers, regularity predicted mortality more strongly than duration: the most regular had 20–30% lower mortality after full adjustment (Windred 2024).',
    howToImprove:
      'Wake at the same time every day, weekends included, and aim to fall asleep within about a one-hour window most nights.',
    caveats:
      'Windred used a Sleep Regularity Index from minute-level data; the app uses the day-to-day spread (standard deviation) of your wake time as a simpler stand-in. The bands (about ±30 min regular, over ±60 min irregular) are a heuristic reading of Windred\'s "about 1-hour vs about 3-hour windows", not published cut-offs. The cohort averaged 63 years old.',
    sources: [SRC.windred2024],
    higherIsBetter: false,
    confidence: 'low',
  },
  body_fat_percentage: {
    title: 'Body fat',
    unit: '%',
    whatItMeans:
      'The share of your weight that is fat. More informative than BMI for muscular people, but only as good as the measuring device.',
    howToImprove:
      'A sustained modest calorie deficit with enough protein and regular resistance training, so the weight lost is fat rather than muscle. Track the trend over weeks.',
    caveats:
      'Gallagher\'s ranges were built by matching healthy BMI ranges to measured body fat; they are provisional, for white and African-American adults (Asian thresholds differ), and were checked against a reproduced chart rather than the original table. Smart-scale bioimpedance can differ from a DEXA scan by several points and swings with hydration, meals and training — compare only readings from the same device under the same conditions, ideally in the morning before eating.',
    sources: [SRC.gallagher2000, SRC.ace],
    higherIsBetter: null,
    confidence: 'medium',
  },
  bmi: {
    title: 'BMI',
    unit: 'kg/m²',
    whatItMeans:
      'Weight relative to height. Mortality in 3.95 million never-smokers was lowest at BMI 20–25 (Global BMI Mortality Collaboration 2016). It cannot tell muscle from fat.',
    howToImprove:
      'For a muscular lifter, check waist-to-height instead — NICE says to interpret BMI with caution in people with high muscle mass and pair it with waist-to-height.',
    caveats:
      'BMI overstates body fat in muscular people and is less reliable from 65. Lower thresholds (overweight from 23, obesity from 27.5) apply to people of South Asian, Chinese, other Asian, Middle Eastern, Black African or African-Caribbean background (NICE).',
    sources: [SRC.gbmc2016, SRC.nice246],
    higherIsBetter: null,
    confidence: 'high',
  },
  waist_to_height: {
    title: 'Waist-to-height ratio',
    unit: 'ratio',
    whatItMeans:
      'Waist divided by height — a measure of belly fat that works for muscular people too. Keep your waist under half your height. It picks out high blood pressure, type 2 diabetes and heart disease risk better than waist size or BMI (Ashwell 2012).',
    howToImprove:
      'Visceral fat responds to a calorie deficit plus regular aerobic and resistance training.',
    caveats:
      'Needs a tape measurement: midway between the bottom of the ribs and the top of the hips, after breathing out naturally (NICE). The NICE classes apply to adults with BMI under 35, both sexes and all ethnicities.',
    sources: [SRC.nice246, SRC.ashwell2012, SRC.who2008Waist],
    higherIsBetter: false,
    confidence: 'high',
  },
  weekly_exercise_minutes: {
    title: 'Weekly activity',
    unit: 'min/week (moderate-equivalent)',
    whatItMeans:
      'Purposeful moderate-to-vigorous activity per week, where 1 vigorous minute counts as 2 moderate ones. WHO 2020 recommends 150–300 moderate or 75–150 vigorous minutes a week, plus muscle strengthening on 2 or more days.',
    howToImprove:
      'For a lifter the usual gap is the aerobic side: brisk walking, cycling or intervals add minutes that also raise VO2 max and lower resting heart rate. Most of the benefit arrives by 300–750 minutes a week (Arem 2015).',
    caveats:
      'Apple\'s Exercise minutes count lifting sessions too and don\'t separate moderate from vigorous, so ring minutes overstate aerobic minutes for someone who lifts. Arem\'s data are self-reported leisure activity.',
    sources: [SRC.who2020, SRC.arem2015, SRC.garber2011],
    higherIsBetter: true,
    confidence: 'high',
  },
  strength_days: {
    title: 'Strength days',
    unit: 'days/week',
    whatItMeans:
      'How many days a week you train your muscles. WHO 2020 recommends muscle-strengthening activity for all major muscle groups on 2 or more days a week.',
    howToImprove:
      'Two full-body sessions or a split that hits each major group twice a week covers the guideline.',
    caveats: 'Health guidance, not a performance target. The link with mortality comes from observational cohorts.',
    sources: [SRC.who2020, SRC.momma2022],
    higherIsBetter: true,
    confidence: 'high',
  },
  strength_minutes: {
    title: 'Strength training time',
    unit: 'min/week',
    whatItMeans:
      'Weekly time spent on muscle-strengthening work. The strongest observed health association is at about 30–60 minutes a week: about 10–20% lower risk of death, cardiovascular disease and cancer (Momma 2022).',
    howToImprove:
      'Going from none to some gives the biggest step. Beyond about an hour a week, extra time is for strength and physique goals — the added health benefit is unclear, not harmful.',
    caveats:
      'The curve is J-shaped in observational data and very likely confounded at high volumes; never read high training volume as a health risk.',
    sources: [SRC.momma2022, SRC.saeidifard2019],
    higherIsBetter: null,
    confidence: 'medium',
  },
  heart_rate_recovery: {
    title: 'Cardio recovery',
    unit: 'bpm drop in 1 min',
    whatItMeans:
      'How far your heart rate falls in the first minute after hard exercise — how quickly your calming nervous system takes over. Faster is better.',
    howToImprove:
      'Aerobic training improves it, through the same route that lowers resting heart rate and raises HRV.',
    caveats:
      'The research used near-maximal treadmill tests in clinical patients; Apple measures after ordinary workouts that may not end at peak effort, and the value depends on whether you stop or keep moving. Compare similar workouts and treat the 12 bpm line as indicative only.',
    sources: [SRC.cole1999, SRC.qiu2017],
    higherIsBetter: true,
    confidence: 'medium',
  },
  walking_speed: {
    title: 'Walking speed',
    unit: 'km/h',
    whatItMeans:
      'Your usual everyday walking pace. In adults over 65 it is one of the best simple predictors of survival (Studenski 2011); in younger adults it mostly matters if it drops.',
    howToImprove:
      'Leg strength and walking habit. A decline over months is the signal to watch, not a single value.',
    caveats:
      'Clinical norms use a timed 4-metre walk; the iPhone measures passively while you carry it on flat ground. The survival thresholds apply to people aged 65 and over.',
    sources: [SRC.studenski2011, SRC.bohannon2011],
    higherIsBetter: true,
    confidence: 'medium',
  },
  respiratory_rate: {
    title: 'Respiratory rate',
    unit: 'breaths/min',
    whatItMeans:
      'Breaths per minute while asleep. It is very stable within a person, so a clear rise above your own baseline means more than the absolute number.',
    howToImprove: 'Not a training target. It rises with illness and with a higher night-time heart rate.',
    caveats:
      'The healthy range comes from 10,000 Fitbit users (Natarajan 2021); Apple\'s algorithm differs, so absolute values may shift slightly.',
    sources: [SRC.natarajan2021],
    higherIsBetter: null,
    confidence: 'medium',
  },
  blood_oxygen: {
    title: 'Blood oxygen',
    unit: '%',
    whatItMeans:
      'The share of your blood\'s haemoglobin carrying oxygen. Healthy lungs at sea level keep it at 95–100% while awake; brief dips during sleep are normal.',
    howToImprove: 'Not a training target. Altitude lowers it.',
    caveats:
      'Apple Watch readings agree with pulse oximeters within about ±3–6 points, with occasional outliers up to 15, and fail with movement or a loose strap. Night readings run lower than daytime ones.',
    sources: [SRC.whoOximetry, SRC.boulos2019, SRC.appleSpo2Review],
    higherIsBetter: null,
    confidence: 'medium',
  },
}
