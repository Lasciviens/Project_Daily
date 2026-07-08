import type { MiniMetricConfig } from './MetricMiniCard'

// Every remaining HealthKit metric Health Auto Export sends us, grouped onto
// the section it's most conceptually related to (no dedicated "Activity" or
// "Nutrition" page exists yet, so these ride along under Steps/Energy/Heart/
// Sleep/Body as a mini-card matrix below each section's main widget).

export const STEPS_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'walking_speed', icon: '🚶‍♂️', title: 'Walking Speed', unit: 'km/h', decimals: 2,
    description: 'Average pace while walking — a steady/rising trend usually tracks fitness.' },
  { metric: 'walking_step_length', icon: '📏', title: 'Step Length', unit: 'm', decimals: 2,
    description: 'Distance covered per step — tends to shorten with fatigue, age, or injury.' },
  { metric: 'walking_asymmetry_percentage', icon: '⚖️', title: 'Walk Asymmetry', unit: '%', decimals: 1,
    description: 'How unevenly your left/right steps land — 0% is perfectly symmetric gait.' },
  { metric: 'stair_speed_up', icon: '⬆️', title: 'Stair Speed Up', unit: 'ft/s', decimals: 2,
    description: 'How fast you climb stairs — Apple’s cardio-fitness proxy from the Watch.' },
  { metric: 'stair_speed_down', icon: '⬇️', title: 'Stair Speed Down', unit: 'ft/s', decimals: 2,
    description: 'How fast you descend stairs — a balance & mobility indicator.' },
  { metric: 'walking_heart_rate_average', icon: '❤️‍🔥', title: 'Walking HR', unit: 'bpm', decimals: 0,
    description: 'Average heart rate during normal walking — trends down as fitness improves.' },
  { metric: 'physical_effort', icon: '💪', title: 'Physical Effort', unit: 'MET', decimals: 2,
    description: 'Metabolic intensity of daily movement — higher means more strenuous activity.' },
  { metric: 'apple_stand_time', icon: '🧍', title: 'Stand Time', unit: 'min', decimals: 0,
    description: 'Total minutes spent standing/moving today — feeds the Stand ring on Overview.' },
  { metric: 'apple_move_time', icon: '🏃', title: 'Move Time', unit: 'min', decimals: 0,
    description: 'Minutes with any detected movement across the day.' },
  { metric: 'flights_climbed', icon: '🏢', title: 'Flights Climbed', unit: 'floors', decimals: 0,
    description: 'Equivalent flights of stairs climbed today.' },
  { metric: 'push_count', icon: '🦽', title: 'Pushes', unit: 'pushes', decimals: 0,
    description: 'Wheelchair push count — only populates in wheelchair mode.' },
  { metric: 'time_in_daylight', icon: '☀️', title: 'Daylight Time', unit: 'min', decimals: 0,
    description: 'Minutes spent in outdoor daylight — linked to sleep quality & mood.' },
]

export const ENERGY_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'dietary_water', icon: '💧', title: 'Water', unit: 'ml', decimals: 0, description: 'Fluids logged today.' },
  { metric: 'dietary_sugar', icon: '🍬', title: 'Sugar', unit: 'g', decimals: 0, description: 'Sugar intake logged today.' },
  { metric: 'protein', icon: '🥩', title: 'Protein', unit: 'g', decimals: 0, description: 'Protein intake logged today.' },
  { metric: 'carbohydrates', icon: '🍞', title: 'Carbs', unit: 'g', decimals: 0, description: 'Carbohydrate intake logged today.' },
  { metric: 'fiber', icon: '🌾', title: 'Fiber', unit: 'g', decimals: 0, description: 'Dietary fiber logged today.' },
  { metric: 'caffeine', icon: '☕', title: 'Caffeine', unit: 'mg', decimals: 0, description: 'Caffeine intake logged today.' },
  { metric: 'total_fat', icon: '🧈', title: 'Fat', unit: 'g', decimals: 0, description: 'Total fat intake logged today.' },
  { metric: 'vitamin_d', icon: '🌞', title: 'Vitamin D', unit: 'µg', decimals: 0, description: 'Vitamin D intake logged today.' },
  { metric: 'magnesium', icon: '🧂', title: 'Magnesium', unit: 'mg', decimals: 0, description: 'Magnesium intake logged today.' },
]

export const HEART_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'cardio_recovery', icon: '💓', title: 'Cardio Recovery', unit: 'bpm', decimals: 0,
    description: 'How much your heart rate drops in the minute after exercise — higher is fitter.' },
]

export const SLEEP_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'respiratory_rate', icon: '🫁', title: 'Respiratory Rate', unit: 'br/min', decimals: 1,
    description: 'Breaths per minute — mostly captured overnight by the Watch during sleep.' },
  { metric: 'apple_sleeping_wrist_temperature', icon: '🌡️', title: 'Wrist Temp', unit: '°C', decimals: 1,
    description: 'Overnight skin temperature deviation — can flag illness or cycle changes.' },
]

export const BODY_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'environmental_audio_exposure', icon: '🔊', title: 'Ambient Noise', unit: 'dB', decimals: 0,
    description: 'Average environmental sound level around you today.' },
  { metric: 'headphone_audio_exposure', icon: '🎧', title: 'Headphone Audio', unit: 'dB', decimals: 0,
    description: 'Average headphone volume today — sustained high levels risk hearing damage.' },
  { metric: 'uv_exposure', icon: '🕶️', title: 'UV Exposure', unit: 'index', decimals: 1,
    description: 'Estimated UV exposure today — higher means more sun protection needed.' },
  { metric: 'handwashing', icon: '🧼', title: 'Handwashing', unit: 'min', decimals: 0,
    description: 'Total time spent handwashing today.' },
  { metric: 'toothbrushing', icon: '🪥', title: 'Toothbrushing', unit: 'min', decimals: 0,
    description: 'Total time spent brushing teeth today.' },
  { metric: 'mindful_minutes', icon: '🧘', title: 'Mindful Minutes', unit: 'min', decimals: 0,
    description: 'Minutes spent in mindfulness/breathing sessions today.' },
  { metric: 'number_of_times_fallen', icon: '⚠️', title: 'Falls Detected', unit: 'falls', decimals: 0,
    description: 'Hard falls detected by the Watch today.' },
  { metric: 'sexual_activity', icon: '💑', title: 'Sexual Activity', unit: 'logged', decimals: 0,
    description: 'Logged occurrences today.' },
]
