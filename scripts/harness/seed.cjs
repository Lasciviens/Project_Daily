'use strict'
// The harness's made-up data: one signed-in owner (Ola Nordmann) and enough
// rows that every page and its main tabs render with content. Every date is
// relative to "today" in Europe/Oslo, so the data never goes stale.
// Nothing here is real: names are placeholders (Ola and Kari Nordmann), places
// public landmarks (Jernbanetorget), links example.com, titles invented, and
// the health numbers are generated.
//
// Shapes follow the app's own types (src/features/<feature>/types.ts and the
// api files). To add a table, return another key from buildTables(); an embed
// whose foreign key isn't `<embedded table, singular>_id` goes into RELATIONS.

const crypto = require('node:crypto')

const OWNER = { id: '00000000-0000-4000-8000-000000000001', email: 'ola.nordmann@example.com', name: 'Ola Nordmann' }
const ZONE = 'Europe/Oslo'

// Embeds the naming rules in postgrest.cjs can't infer.
const RELATIONS = {
  'food_log_entries.recipe_ingredient_library': { kind: 'one', local: 'library_ingredient_id', foreign: 'id' },
  'supplement_schedules.recipe_ingredient_library': { kind: 'one', local: 'library_ingredient_id', foreign: 'id' },
  'user_tv_entries.tv_series': { kind: 'one', local: 'tv_series_id', foreign: 'id' },
  'user_tv_episodes.tv_series': { kind: 'one', local: 'tv_series_id', foreign: 'id' },
  'user_tv_episodes.user_tv_entries': { kind: 'one', local: 'tv_entry_id', foreign: 'id' },
  'user_movie_entries.media_watches': { kind: 'many', local: 'id', foreign: 'movie_entry_id' },
  'user_tv_episodes.media_watches': { kind: 'many', local: 'id', foreign: 'episode_id' },
}

// ── Dates on Oslo's clock ────────────────────────────────────────────────────

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const partsFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })

const osloDay = (date) => dayFormat.format(date)
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay() // 0 = Sunday
/** Minutes Oslo is ahead of UTC at that instant. */
function zoneOffsetMinutes(utcMs) {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]))
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(utcMs / 60000) * 60000) / 60000
}
/** The UTC instant of an Oslo wall-clock time, as an ISO string. */
function osloInstant(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  return new Date(guess - zoneOffsetMinutes(guess) * 60000).toISOString()
}
/** Health Auto Export's local-time form: "2026-07-17 07:27:08 +0200". */
function haeLocal(day, hhmm) {
  const off = zoneOffsetMinutes(Date.parse(osloInstant(day, hhmm)))
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  return `${day} ${hhmm}:00 ${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`
}
const plusMinutes = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString()

// ── Ids: valid UUIDs, the same on every run ──────────────────────────────────

function idMaker(name) {
  const prefix = crypto.createHash('sha1').update(name).digest('hex').slice(0, 8)
  let n = 0
  return () => {
    n += 1
    return `${prefix}-${n.toString(16).padStart(4, '0')}-4000-8000-${n.toString(16).padStart(12, '0')}`
  }
}

// A small deterministic wobble, so the series aren't flat lines.
const wobble = (i, spread) => Math.round(Math.sin(i * 1.7) * spread * 10) / 10
const round1 = (x) => Math.round(x * 10) / 10

function buildTables(now = new Date()) {
  const today = osloDay(now)
  const day = (n) => addDays(today, n)
  const at = (n, hhmm) => osloInstant(day(n), hhmm)
  const owner = OWNER.id
  const stamp = (n = -30, hhmm = '09:00') => ({ created_at: at(n, hhmm), updated_at: at(n, hhmm) })
  // Monday of this week, as an offset from today.
  const mondayOffset = -((weekdayOf(today) + 6) % 7)
  const tables = {}

  // ── Training: exercises, routines, the weekly plan, logged workouts ────────
  const templateTitles = {
    A1B2C301: ['Bench Press (Barbell)', 'weight_reps', 'chest', ['triceps', 'shoulders']],
    A1B2C302: ['Incline Bench Press (Dumbbell)', 'weight_reps', 'chest', ['shoulders']],
    A1B2C303: ['Overhead Press (Barbell)', 'weight_reps', 'shoulders', ['triceps']],
    A1B2C304: ['Lateral Raise (Dumbbell)', 'weight_reps', 'shoulders', []],
    A1B2C305: ['Pull Up', 'bodyweight_reps', 'lats', ['biceps']],
    A1B2C306: ['Bent Over Row (Barbell)', 'weight_reps', 'upper_back', ['lats', 'biceps']],
    A1B2C307: ['Bicep Curl (Dumbbell)', 'weight_reps', 'biceps', []],
    A1B2C308: ['Triceps Pushdown (Cable)', 'weight_reps', 'triceps', []],
    A1B2C309: ['Squat (Barbell)', 'weight_reps', 'quadriceps', ['glutes', 'hamstrings']],
    A1B2C30A: ['Romanian Deadlift (Barbell)', 'weight_reps', 'hamstrings', ['glutes', 'lower_back']],
    A1B2C30B: ['Leg Press (Machine)', 'weight_reps', 'quadriceps', ['glutes']],
    A1B2C30C: ['Lying Leg Curl (Machine)', 'weight_reps', 'hamstrings', []],
    A1B2C30D: ['Standing Calf Raise (Machine)', 'weight_reps', 'calves', []],
    A1B2C30E: ['Hip Thrust (Barbell)', 'weight_reps', 'glutes', ['hamstrings']],
    A1B2C30F: ['Lat Pulldown (Cable)', 'weight_reps', 'lats', ['biceps']],
    A1B2C310: ['Plank', 'duration', 'abdominals', []],
  }
  const muscleId = idMaker('hevy_exercise_template_muscles')
  tables.hevy_exercise_templates = Object.entries(templateTitles).map(([id, [title, type, primary]]) => ({
    id, user_id: owner, title, type, primary_muscle_group: primary, is_custom: false, thumbnail_url: null,
    created_at: at(-200, '12:00'), synced_at: at(-1, '06:00'),
  }))
  tables.hevy_exercise_template_muscles = Object.entries(templateTitles).flatMap(([id, [, , , secondary]]) =>
    secondary.map(muscle_group => ({ id: muscleId(), user_id: owner, exercise_template_id: id, muscle_group })))

  // [template, rep range start, end, working weight kg (0 = body weight), seconds for a timed set]
  const routineDefs = [
    { title: 'Upper A', weekday: 1, time: '07:00', ex: [['A1B2C301', 5, 8, 82.5], ['A1B2C306', 6, 10, 70], ['A1B2C303', 6, 10, 47.5], ['A1B2C307', 10, 12, 14], ['A1B2C308', 10, 12, 32.5]] },
    { title: 'Lower A', weekday: 2, time: '07:00', ex: [['A1B2C309', 5, 8, 105], ['A1B2C30A', 8, 10, 92.5], ['A1B2C30C', 10, 12, 45], ['A1B2C30D', 10, 15, 60], ['A1B2C310', 0, 0, 0, 60]] },
    { title: 'Upper B', weekday: 4, time: '07:00', ex: [['A1B2C302', 8, 10, 30], ['A1B2C305', 6, 10, 0], ['A1B2C30F', 8, 12, 62.5], ['A1B2C304', 12, 15, 10], ['A1B2C307', 10, 12, 14]] },
    { title: 'Lower B', weekday: 6, time: '10:00', ex: [['A1B2C30B', 10, 12, 180], ['A1B2C30E', 8, 10, 100], ['A1B2C30A', 8, 10, 87.5], ['A1B2C30D', 12, 15, 60]] },
  ]
  const routineId = idMaker('hevy_routines'), rexId = idMaker('hevy_routine_exercises'), rsetId = idMaker('hevy_routine_sets')
  tables.hevy_routine_folders = [{ id: 1, user_id: owner, title: 'Autumn block', created_at: at(-70, '12:00'), synced_at: at(-1, '06:00') }]
  tables.hevy_routines = []
  tables.hevy_routine_exercises = []
  tables.hevy_routine_sets = []
  for (const r of routineDefs) {
    r.id = routineId()
    tables.hevy_routines.push({
      id: r.id, user_id: owner, folder_id: 1, title: r.title, notes: 'Rest 2–3 min on the first lift.',
      hevy_updated_at: at(-20, '18:00'), hevy_created_at: at(-70, '18:00'), created_at: at(-70, '18:00'), synced_at: at(-1, '06:00'),
    })
    r.ex.forEach(([tpl, lo, hi, kg, secs], index) => {
      const exId = rexId()
      tables.hevy_routine_exercises.push({
        id: exId, user_id: owner, hevy_routine_id: r.id, exercise_template_id: tpl, index, title: templateTitles[tpl][0],
        notes: null, rest_seconds: index === 0 ? '180' : '90', supersets_id: null, created_at: at(-70, '18:00'),
      })
      for (let s = 0; s < 3; s++) {
        tables.hevy_routine_sets.push({
          id: rsetId(), user_id: owner, hevy_routine_exercise_id: exId, index: s, type: 'normal',
          weight_kg: kg || null, reps: null, rep_range_start: secs ? null : lo, rep_range_end: secs ? null : hi,
          distance_meters: null, duration_seconds: secs || null, rpe: null, custom_metric: null, created_at: at(-70, '18:00'),
        })
      }
    })
  }
  const programId = idMaker('current_program_routines')
  tables.current_program_routines = routineDefs.map(r => ({ id: programId(), user_id: owner, routine_id: r.id, created_at: at(-60, '12:00') }))

  // Logged workouts: every planned day of the last eight weeks, before today.
  const workoutId = idMaker('hevy_workouts'), wexId = idMaker('hevy_workout_exercises'), setId = idMaker('hevy_sets')
  tables.hevy_workouts = []
  tables.hevy_workout_exercises = []
  tables.hevy_sets = []
  const workoutOn = new Map() // `${routine}|${day}` → workout
  for (let week = 7; week >= 0; week--) {
    for (const r of routineDefs) {
      const offset = mondayOffset - week * 7 + ((r.weekday + 6) % 7)
      if (offset >= 0) continue
      const start = at(offset, r.time)
      const end = plusMinutes(start, 58 + (week % 3) * 4)
      const w = {
        id: workoutId(), user_id: owner, title: r.title, routine_id: r.id, description: week === 0 ? 'Felt strong today.' : null,
        start_time: start, end_time: end, hevy_updated_at: end, hevy_created_at: end, created_at: end, synced_at: end,
      }
      tables.hevy_workouts.push(w)
      workoutOn.set(`${r.id}|${day(offset)}`, w)
      r.ex.forEach(([tpl, lo, hi, kg, secs], index) => {
        const exId = wexId()
        tables.hevy_workout_exercises.push({
          id: exId, user_id: owner, hevy_workout_id: w.id, exercise_template_id: tpl, index, title: templateTitles[tpl][0],
          notes: null, supersets_id: null, created_at: end,
        })
        const progressed = kg ? Math.max(0, kg - week * 1.25) : 0
        for (let s = 0; s < 3; s++) {
          tables.hevy_sets.push({
            id: setId(), user_id: owner, hevy_exercise_id: exId, exercise_template_id: tpl, index: s, type: 'normal',
            weight_kg: kg ? Math.round(progressed * 4) / 4 : null,
            reps: secs ? null : Math.max(lo, hi - s - (week % 2)),
            distance_meters: null, duration_seconds: secs ? secs - s * 5 : null,
            rpe: secs ? null : 7 + s * 0.5, custom_metric: null, created_at: end,
          })
        }
      })
    }
  }
  tables.hevy_account = [{
    user_id: owner, username: 'ola_nordmann', weight_unit: 'kg', distance_unit: 'kilometers', is_pro: true,
    hevy_workout_count: tables.hevy_workouts.length, count_checked_at: at(-1, '06:00'), synced_at: at(-1, '06:00'), last_error: null, last_error_at: null,
  }]
  tables.hevy_workout_events_cursor = [{ user_id: owner, last_events_since: at(-1, '06:00'), created_at: at(-60, '12:00'), updated_at: at(-1, '06:00') }]
  tables.athlete_profile = [{
    user_id: owner, goal: 'hypertrophy', experience_level: 'intermediate', training_age_years: 4, training_days_per_week: 4,
    equipment_access: 'gym', notes: 'Prefers morning sessions.', birth_year: 1990, sex: 'male', height_cm: 181,
    goal_weight_kg: 78, goal_body_fat_pct: 15, goal_muscle_mass_kg: null, phase_start_date: day(-42), updated_at: at(-42, '09:00'),
  }]
  const stravaId = idMaker('strava_activities')
  tables.strava_activities = [3, 6, 10, 13, 17, 20].map((ago, i) => ({
    id: stravaId(), user_id: owner, strava_activity_id: 7100 + i, type: i === 2 ? 'walk' : 'run',
    title: i === 2 ? 'Evening walk' : 'Morning run', start_date: at(-ago, '06:30'),
    distance_meters: i === 2 ? 3800 : 5200 + i * 300, duration_seconds: i === 2 ? 2700 : 1680 + i * 60, elevation_gain_m: 35 + i * 4,
    avg_heart_rate: i === 2 ? 104 : 151 - i, avg_pace_sec_per_km: i === 2 ? 710 : 323 - i * 2, notes: null, ...stamp(-ago, '08:00'),
  }))

  // ── Plans on the calendar: repeats (schedule_blocks) and one-off slots ─────
  const scheduleId = idMaker('schedule_blocks')
  const repeat = (title, days, start, end, category, extra = {}) => ({
    id: scheduleId(), user_id: owner, title, days_of_week: days, start_time: start, end_time: end, color: 'accent', category,
    effective_from: day(-63), except_dates: [], repeat_kind: 'weekly', repeat_interval: null, repeat_unit: null, repeat_dates: null,
    google_calendar_event_id: null, google_calendar_horizon: null, google_calendar_time_zone: null, time_zone: ZONE, place: null,
    google_calendar_from: null, busy: true, google_target: 'none', domain: 'personal', priority: 'medium', notes: null,
    ...stamp(-63), ...extra,
  })
  tables.schedule_blocks = [
    ...routineDefs.map(r => {
      const hh = Number(r.time.slice(0, 2)) + 1
      r.plan = repeat(r.title, [r.weekday], `${r.time}:00`, `${String(hh).padStart(2, '0')}:${r.time.slice(3)}:00`, 'training')
      return r.plan
    }),
    repeat('Morning walk', [1, 2, 3, 4, 5], '07:45:00', '08:00:00', 'daily', { busy: false }),
    repeat('Stretch and foam roll', [0, 3, 6], '21:00:00', '21:20:00', 'daily'),
    repeat('Team stand-up', [1, 2, 3, 4, 5], '09:00:00', '09:15:00', 'work', { domain: 'work' }),
  ]

  // ── Tasks: today, overdue, the week, the month, no date, work, projects ────
  const taskId = idMaker('tasks')
  const taskBase = {
    user_id: owner, description: null, domain: 'personal', section: 'backlog', status: 'open', priority: 'medium',
    start_date: null, due_date: null, due_time: null, waiting_for: null, is_focused: false, source_type: 'manual', source_id: null,
    sort_order: 0, google_task_id: null, google_calendar_event_id: null, parent_task_id: null, google_tasklist_id: null, labels: [],
    completed_at: null, google_position: null, google_etag: null, google_updated_at: null, google_web_view_link: null, google_links: null,
    google_hidden: false, google_deleted: false, google_local_edit_at: null, google_sync_enabled: false, hevy_routine_id: null,
    hevy_workout_id: null, google_target: 'none', schedule_block_id: null, occurrence_date: null, closed_reason: null,
    first_plan_date: null, project_id: null, project_phase_id: null,
  }
  let order = 0
  const task = (offset, title, extra = {}) => {
    const due = offset == null ? null : day(offset)
    const t = {
      ...taskBase, id: taskId(), title, due_date: due, section: offset === 0 ? 'today' : 'backlog', sort_order: order++,
      ...stamp(Math.min(offset ?? -10, 0) - 3, '08:30'), ...extra,
    }
    if (t.status === 'done' && !t.completed_at) t.completed_at = at(offset == null ? -1 : Math.min(offset, 0), '16:20')
    if (t.status === 'cancelled' && !t.completed_at) t.completed_at = at(offset == null ? -1 : Math.min(offset, 0), '18:00')
    return t
  }
  const tasks = [
    task(0, 'Buy a birthday card for Kari', { priority: 'high', due_time: '17:00:00', labels: ['errand'] }),
    task(0, 'Call the plumber about the kitchen tap', { labels: ['home'] }),
    task(0, 'Pick up the parcel at Jernbanetorget', { status: 'in_progress', is_focused: true }),
    task(0, 'Send the flat inspection photos to the landlord', { status: 'waiting', waiting_for: 'Reply from the landlord' }),
    task(0, 'Sort the receipts from the last three months for the tax return and upload them to the shared folder', { priority: 'low' }),
    task(0, 'Renew the parking permit', { status: 'done', completed_at: at(0, '09:12') }),
    task(null, 'Water the plants', { section: 'today' }),
    task(-2, 'Return the library books', { priority: 'high' }),
    task(-5, 'Book a dentist appointment'),
    task(-4, 'Pay the electricity bill', { status: 'done' }),
    task(-3, 'Clean the bathroom', { status: 'done' }),
    task(-3, 'Fix the squeaky door', { status: 'cancelled' }),
    task(-1, 'Take the winter tyres to the garage', { status: 'done', priority: 'high' }),
    task(1, 'Meal prep for the week', { due_time: '16:00:00' }),
    task(1, 'Call Mum'),
    task(2, 'Order new running shoes', { labels: ['errand'] }),
    task(3, 'Change the bed linen'),
    task(5, 'Recycle the glass and metal'),
    task(9, 'Service the bike', { priority: 'high' }),
    task(12, 'Renew the travel insurance'),
    task(16, 'Plan the Christmas dinner', { labels: ['family'] }),
    task(20, 'Book the train to Bergen'),
    task(null, 'Plan a weekend trip to Bergen', { priority: 'low' }),
    task(null, 'Fix the rear brake on the bike'),
    task(null, 'Learn the basics of sourdough', { section: 'inbox', priority: 'low' }),
    // Work
    task(2, 'Prepare the Q4 planning slides', { domain: 'work', status: 'in_progress', priority: 'high', is_focused: true }),
    task(3, 'Review the onboarding checklist', { domain: 'work' }),
    task(-1, 'Reply to the supplier about the delivery date', { domain: 'work', status: 'waiting', waiting_for: 'Supplier' }),
    task(null, 'Update the team wiki page', { domain: 'work', priority: 'low' }),
    task(-2, 'Fix the build pipeline warning', { domain: 'work', status: 'done' }),
    task(6, 'Draft the budget proposal', { domain: 'work', priority: 'high' }),
    task(2, 'Notes for the one-to-one', { domain: 'work', due_time: '13:30:00' }),
    task(0, 'Answer the customer survey email', { domain: 'work' }),
  ]

  // Repeats' days are tasks on their day (156): today's, plus the training plan's past weeks.
  for (const b of tables.schedule_blocks.filter(x => x.category !== 'training')) {
    if (!b.days_of_week.includes(weekdayOf(today))) continue
    tasks.push(task(0, b.title, {
      domain: b.domain || 'personal', due_time: b.start_time, schedule_block_id: b.id, occurrence_date: today, first_plan_date: today,
    }))
  }
  for (let week = 3; week >= 0; week--) {
    for (const r of routineDefs) {
      const offset = mondayOffset - week * 7 + ((r.weekday + 6) % 7)
      if (offset > 0) continue
      const w = workoutOn.get(`${r.id}|${day(offset)}`)
      tasks.push(task(offset, r.title, {
        due_time: `${r.time}:00`, source_type: 'training_session', source_id: r.id, hevy_routine_id: r.id,
        hevy_workout_id: w ? w.id : null, status: w ? 'done' : 'open', completed_at: w ? w.end_time : null,
        schedule_block_id: r.plan.id, occurrence_date: day(offset), first_plan_date: day(offset),
      }))
    }
  }

  // ── Projects ───────────────────────────────────────────────────────────────
  const projectId = idMaker('projects'), phaseId = idMaker('project_phases'), blockId = idMaker('project_blocks'), entryId = idMaker('project_entries')
  const projects = [
    { name: 'Garage workshop', kind: 'hardware', color: 'amber', status: 'active', area: 'personal', description: 'A workbench, wall storage and better light in the garage.', status_line: 'Workbench frame done; waiting for the plywood top.', target_on: day(45) },
    { name: 'Home office makeover', kind: 'home', color: 'violet', status: 'active', area: 'personal', description: 'A calmer desk corner: new lamp, cable tray, acoustic panels.', status_line: 'Comparing desk lamps.', target_on: day(20) },
    { name: 'Customer portal relaunch', kind: 'software', color: 'blue', status: 'active', area: 'work', description: 'The new sign-in flow and the help pages.', status_line: 'Design review on Tuesday.', target_on: day(60) },
    { name: 'Learn Spanish', kind: 'learning', color: 'emerald', status: 'on_hold', area: 'personal', description: 'Twenty minutes a day, A2 by the summer.', status_line: null, target_on: null },
  ].map((p, i) => ({
    id: projectId(), user_id: owner, notes: null, sort_order: i, status_line_at: p.status_line ? at(-2, '18:00') : null,
    started_on: day(-40 + i * 5), link_url: null, ...stamp(-40 + i * 5), ...p,
  }))
  tables.projects = projects
  tables.project_phases = []
  const phaseNames = [['Plan', 'done'], ['Build', 'in_progress'], ['Finish', 'pending']]
  for (const p of projects) {
    p.phases = phaseNames.map(([name, status], i) => {
      const ph = {
        id: phaseId(), project_id: p.id, user_id: owner, name, description: null, status, sort_order: i,
        done_when: i === 1 ? 'Everything has a place' : null, target_on: i === 2 ? p.target_on : null,
        done_at: status === 'done' ? at(-20, '19:00') : null, ...stamp(-40),
      }
      tables.project_phases.push(ph)
      return ph
    })
  }
  tables.project_blocks = []
  tables.project_entries = []
  const garage = projects[0]
  const partsBlock = {
    id: blockId(), user_id: owner, project_id: garage.id, kind: 'table', title: 'Parts', sort_order: 0, ...stamp(-38),
    settings: { columns: [
      { key: 'part', label: 'Part', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'price', label: 'Price', type: 'money' }, { key: 'status', label: 'Status', type: 'status', options: ['Needed', 'Ordered', 'Have'] },
    ], currency: 'NOK' },
  }
  const logBlock = { id: blockId(), user_id: owner, project_id: garage.id, kind: 'log', title: 'Log', sort_order: 1, settings: {}, ...stamp(-38) }
  const linksBlock = { id: blockId(), user_id: owner, project_id: garage.id, kind: 'links', title: 'Links', sort_order: 2, settings: {}, ...stamp(-38) }
  const decisionsBlock = { id: blockId(), user_id: owner, project_id: garage.id, kind: 'decisions', title: 'Decisions', sort_order: 3, settings: {}, ...stamp(-38) }
  tables.project_blocks.push(partsBlock, logBlock, linksBlock, decisionsBlock)
  const entry = (block, sort_order, fields) => ({
    id: entryId(), user_id: owner, project_id: block.project_id, block_id: block.id, title: null, body: null, url: null,
    entry_date: null, state: null, data: {}, sort_order, ...stamp(-30 + sort_order), ...fields,
  })
  tables.project_entries.push(
    entry(partsBlock, 0, { data: { part: 'Plywood top 18 mm', qty: 1, price: 890, status: 'Ordered' } }),
    entry(partsBlock, 1, { data: { part: 'Wall rail system', qty: 3, price: 349, status: 'Needed' } }),
    entry(partsBlock, 2, { data: { part: 'LED batten light', qty: 2, price: 499, status: 'Have' } }),
    entry(logBlock, 0, { title: 'Frame glued and screwed', body: 'Square within a millimetre. Needs a day to cure.', entry_date: day(-6) }),
    entry(logBlock, 1, { title: 'Bought the timber', body: 'Planed spruce, 45×95.', entry_date: day(-15) }),
    entry(linksBlock, 0, { title: 'Workbench plans', url: 'https://example.com/workbench-plans' }),
    entry(decisionsBlock, 0, { title: 'Bench height', body: '92 cm — elbow height minus 10 cm.', state: 'decided' }),
    entry(decisionsBlock, 1, { title: 'Pegboard or slat wall?', body: 'Slat wall holds more but costs twice as much.', state: 'open' }),
  )
  const portal = projects[2]
  tasks.push(
    task(1, 'Cut the plywood top to size', { project_id: garage.id, project_phase_id: garage.phases[1].id, source_type: 'project_item' }),
    task(4, 'Mount the wall rails', { project_id: garage.id, project_phase_id: garage.phases[1].id, source_type: 'project_item' }),
    task(null, 'Seal the bench top', { project_id: garage.id, project_phase_id: garage.phases[2].id, source_type: 'project_item' }),
    task(-8, 'Measure the wall space', { project_id: garage.id, project_phase_id: garage.phases[0].id, status: 'done', source_type: 'project_item' }),
    task(3, 'Order the cable tray', { project_id: projects[1].id, project_phase_id: projects[1].phases[1].id, source_type: 'project_item' }),
    task(2, 'Review the sign-in flow mock-ups', { domain: 'work', project_id: portal.id, project_phase_id: portal.phases[1].id, source_type: 'project_item' }),
    task(8, 'Write the help page outline', { domain: 'work', project_id: portal.id, project_phase_id: portal.phases[1].id, source_type: 'project_item' }),
  )
  tables.tasks = tasks

  // One-off slots on the calendar (time_blocks), some tied to a task.
  const timeBlockId = idMaker('time_blocks')
  const slot = (offset, title, start, minutes, category, extra = {}) => ({
    id: timeBlockId(), user_id: owner, date: day(offset), title, start_time: start, duration_minutes: minutes, color: 'accent', category,
    task_id: null, source_type: 'manual', source_id: null, season_number: null, episode_number: null, notes: null,
    google_calendar_event_id: null, schedule_block_id: null, occurrence_date: null, busy: true, time_zone: ZONE, place: null,
    ...stamp(Math.min(offset, 0) - 2, '10:00'), ...extra,
  })
  const mealPrep = tasks.find(t => t.title === 'Meal prep for the week')
  const plywood = tasks.find(t => t.title === 'Cut the plywood top to size')
  tables.time_blocks = [
    slot(0, 'Coffee with Kari at Jernbanetorget', '12:00:00', 60, 'daily', { place: { name: 'Jernbanetorget', locality: 'Oslo' } }),
    slot(0, 'Grocery run', '15:00:00', 45, 'daily'),
    slot(0, 'Movie night', '20:00:00', 120, 'media', { source_type: 'movie' }),
    slot(-1, 'Dinner with friends', '18:30:00', 150, 'daily'),
    slot(-3, 'Dentist check-up', '08:30:00', 45, 'daily'),
    slot(1, 'Meal prep', '16:00:00', 90, 'daily', { task_id: mealPrep.id }),
    slot(1, 'Work on the garage bench', '11:00:00', 120, 'projects', { task_id: plywood.id, source_type: 'project_item' }),
    slot(2, 'Planning workshop', '13:00:00', 120, 'work'),
    slot(3, 'Evening football: Oslo City vs Fjord United', '19:00:00', 120, 'football'),
    slot(4, 'Haircut', '17:30:00', 30, 'daily'),
    slot(9, 'Bike service drop-off', '08:00:00', 15, 'daily', { busy: false }),
  ]

  // ── Food: foods, recipes, the diary, the plan, water, supplements ─────────
  const foodId = idMaker('recipe_ingredient_library')
  const food = (name, group, kcal, p, c, f, fib, sug, extra = {}) => ({
    id: foodId(), user_id: owner, name, unit: 'g', calories: kcal, protein_g: p, carbs_g: c, fat_g: f, fiber_g: fib, sugar_g: sug,
    serving_label: null, serving_grams: null, food_group_id: null, food_group: group, image_url: null, source: null, source_ref: null,
    created_at: at(-90, '12:00'), ...extra,
  })
  const foods = {
    oats: food('Oats', 'Cereals, bread and cakes', 372, 13.5, 58.7, 7, 10, 1.1),
    yoghurt: food('Greek yoghurt 2 %', 'Dairy products', 73, 9.8, 3.8, 2, 0, 3.8),
    banana: food('Banana', 'Fruit and berries', 89, 1.1, 20.2, 0.3, 2.6, 15.6, { serving_label: '1 piece', serving_grams: 120 }),
    chicken: food('Chicken breast', 'Meat and poultry', 110, 23.4, 0, 1.6, 0, 0),
    rice: food('Rice, cooked', 'Cereals, bread and cakes', 130, 2.7, 28.2, 0.3, 0.4, 0.1),
    broccoli: food('Broccoli', 'Vegetables', 34, 2.8, 4.4, 0.4, 2.6, 1.7),
    salmon: food('Salmon fillet', 'Fish and shellfish', 197, 20, 0, 13, 0, 0),
    potato: food('Potatoes, boiled', 'Potatoes', 77, 1.9, 16.1, 0.1, 1.6, 0.8),
    eggs: food('Eggs', 'Egg', 143, 12.6, 0.7, 9.5, 0, 0.4, { serving_label: '1 piece', serving_grams: 60 }),
    bread: food('Whole-grain bread', 'Cereals, bread and cakes', 238, 9.8, 39.2, 3.6, 7.4, 2.4, { serving_label: '1 slice', serving_grams: 40 }),
    peanut: food('Peanut butter', 'Nuts and seeds', 597, 25, 12, 49, 7, 6),
    milk: food('Milk 1 %', 'Dairy products', 41, 3.5, 4.6, 1, 0, 4.6),
    lentils: food('Red lentils, dry', 'Legumes', 328, 25.8, 48.5, 1.6, 10.8, 1.4),
    tomatoes: food('Chopped tomatoes, tinned', 'Vegetables', 22, 1.1, 3.3, 0.2, 1, 3.3),
    whey: food('Whey protein, vanilla', 'Supplements', 382, 75, 8, 6, 0, 5, { serving_label: '1 scoop', serving_grams: 30, source: 'openfoodfacts', source_ref: '7000000000017' }),
    creatine: food('Creatine monohydrate', 'Supplements', 0, 0, 0, 0, 0, 0, { serving_label: '1 scoop', serving_grams: 5 }),
    cheese: food('Cottage cheese', 'Dairy products', 89, 13, 2.7, 2.3, 0, 2.7),
    apple: food('Apple', 'Fruit and berries', 52, 0.3, 13.8, 0.2, 2.4, 10.4, { serving_label: '1 piece', serving_grams: 150 }),
  }
  tables.recipe_ingredient_library = Object.values(foods)

  const recipeId = idMaker('recipes'), recipeIngId = idMaker('recipe_ingredients')
  tables.recipe_ingredients = []
  const recipe = (title, category, servings, perServing, ingredients, extra = {}) => {
    const r = {
      id: recipeId(), user_id: owner, title, description: null, servings, instructions: null, macro_mode: 'from_ingredients',
      calories: perServing[0], protein_g: perServing[1], carbs_g: perServing[2], fat_g: perServing[3], fiber_g: perServing[4], sugar_g: perServing[5],
      image_url: null, source_url: null, times_cooked: 3, category, is_temp: false, serving_label: null, batch_started_at: null,
      batch_servings: null, batch_cooked_g: null, ...stamp(-80 + tables.recipe_ingredients.length, '19:00'), ...extra,
    }
    ingredients.forEach(([f, grams], i) => tables.recipe_ingredients.push({
      id: recipeIngId(), user_id: owner, recipe_id: r.id, name: f.name, quantity: grams, unit: 'g', note: null, sort_order: i, library_ingredient_id: f.id,
    }))
    return r
  }
  const recipes = {
    oats: recipe('Overnight oats', 'breakfast', 1, [452, 26.6, 63, 10.5, 9.5, 21], [[foods.oats, 70], [foods.yoghurt, 150], [foods.banana, 60], [foods.milk, 100]], { instructions: 'Mix everything the night before and keep it cold.' }),
    bowl: recipe('Chicken rice bowl', 'lunch', 2, [541, 47.1, 64.5, 9.2, 4.2, 2.2], [[foods.chicken, 300], [foods.rice, 400], [foods.broccoli, 200]]),
    salmon: recipe('Salmon with potatoes and greens', 'dinner', 2, [610, 39.1, 46, 27.5, 6.4, 3.6], [[foods.salmon, 360], [foods.potato, 500], [foods.broccoli, 250]]),
    soup: recipe('Red lentil soup', 'dinner', 4, [298, 18.5, 46, 3.1, 11.2, 4.9], [[foods.lentils, 300], [foods.tomatoes, 800], [foods.potato, 200]], { serving_label: 'bowl', times_cooked: 6 }),
    pancakes: recipe('Protein pancakes', 'breakfast', 2, [389, 33.2, 42.1, 9.4, 4.6, 9.5], [[foods.oats, 80], [foods.eggs, 120], [foods.banana, 120], [foods.whey, 30]], { serving_label: 'piece' }),
    pasta: recipe('Creamy tomato pasta with roasted vegetables and plenty of basil from the windowsill', 'dinner', 3, [520, 19, 82, 12, 7, 9], [[foods.tomatoes, 400]], { macro_mode: 'manual' }),
  }
  tables.recipes = Object.values(recipes)

  const logId = idMaker('food_log_entries')
  const snapshot = (src, amount, isRecipe) => {
    const k = isRecipe ? amount : amount / 100
    return {
      calories: round1(src.calories * k), protein_g: round1(src.protein_g * k), carbs_g: round1(src.carbs_g * k),
      fat_g: round1(src.fat_g * k), fiber_g: round1((src.fiber_g || 0) * k), sugar_g: round1((src.sugar_g || 0) * k),
    }
  }
  const logBase = {
    user_id: owner, library_ingredient_id: null, recipe_id: null, custom_title: null, quantity: null, unit: null,
    calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, meal_group_id: null,
    meal_group_title: null, supplement_schedule_id: null, dose_time: null, eaten_time: null, status: 'eaten',
  }
  const eatRecipe = (offset, slotName, r, servings, time, extra = {}) => ({
    ...logBase, id: logId(), date: day(offset), meal_slot: slotName, recipe_id: r.id, quantity: servings, unit: 'serving',
    ...snapshot(r, servings, true), eaten_time: time, created_at: at(offset, time.slice(0, 5)), ...extra,
  })
  const eatFood = (offset, slotName, f, grams, time, extra = {}) => ({
    ...logBase, id: logId(), date: day(offset), meal_slot: slotName, library_ingredient_id: f.id, quantity: grams, unit: 'g',
    ...snapshot(f, grams, false), eaten_time: time, created_at: at(offset, time.slice(0, 5)), ...extra,
  })
  const planRecipe = (offset, slotName, r, servings) => ({
    ...logBase, id: logId(), date: day(offset), meal_slot: slotName, recipe_id: r.id, quantity: servings, unit: 'serving',
    status: 'planned', created_at: at(Math.min(offset, 0) - 1, '20:00'),
  })
  const log = []
  // The last four weeks, a little different each day.
  for (let n = -27; n <= 0; n++) {
    log.push(eatRecipe(n, 'breakfast', n % 3 === 0 ? recipes.pancakes : recipes.oats, 1, '07:30:00'))
    if (n === 0) continue
    log.push(eatRecipe(n, 'lunch', recipes.bowl, 1, '12:15:00'))
    log.push(eatFood(n, 'snack', n % 2 ? foods.apple : foods.banana, n % 2 ? 150 : 120, '15:00:00'))
    log.push(eatRecipe(n, 'dinner', n % 4 === 0 ? recipes.soup : recipes.salmon, 1, '18:30:00'))
    if (n % 5 === 0) log.push({ ...logBase, id: logId(), date: day(n), meal_slot: 'snack', custom_title: 'Cinnamon bun at the café', calories: 420, protein_g: 7, carbs_g: 55, fat_g: 19, fiber_g: 2, sugar_g: 24, eaten_time: '16:10:00', created_at: at(n, '16:10') })
  }
  // Today so far: breakfast (above), a snack and a lunch dish of two foods; dinner is planned.
  const dish = '0d150000-0000-4000-8000-000000000001'
  log.push(
    eatFood(0, 'lunch', foods.chicken, 150, '12:20:00', { meal_group_id: dish, meal_group_title: 'Chicken and rice' }),
    eatFood(0, 'lunch', foods.rice, 200, '12:20:00', { meal_group_id: dish, meal_group_title: 'Chicken and rice' }),
    eatFood(0, 'snack', foods.whey, 30, '10:30:00'),
    eatFood(0, 'snack', foods.banana, 120, '10:30:00'),
    planRecipe(0, 'dinner', recipes.salmon, 1),
  )
  // The meal plan for the coming week.
  const planned = [[1, 'dinner', recipes.soup], [1, 'lunch', recipes.bowl], [2, 'dinner', recipes.salmon], [3, 'dinner', recipes.pasta], [4, 'breakfast', recipes.pancakes], [5, 'dinner', recipes.soup], [6, 'lunch', recipes.bowl]]
  for (const [n, slotName, r] of planned) log.push(planRecipe(n, slotName, r, 1))

  const supplementId = idMaker('supplement_schedules')
  tables.supplement_schedules = [
    {
      id: supplementId(), user_id: owner, title: 'Creatine', library_ingredient_id: foods.creatine.id, recipe_id: null, dose_amount: 5, dose_unit: 'g',
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, times: ['08:00:00'], days_of_week: [0, 1, 2, 3, 4, 5, 6], repeat_kind: 'weekly',
      repeat_interval: null, repeat_unit: null, repeat_dates: null, effective_from: day(-30), except_dates: [], ends_on: null,
      remind: 'off', remind_every_min: 30, remind_until: '22:00:00', paused_from: null, paused_until: null, notes: null,
      stock_amount: 500, stock_set_at: day(-30), refill_days: 7, ...stamp(-30),
    },
    {
      id: supplementId(), user_id: owner, title: 'Vitamin D', library_ingredient_id: null, recipe_id: null, dose_amount: 1, dose_unit: 'capsule',
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, times: ['08:00:00', '20:00:00'], days_of_week: [0, 1, 2, 3, 4, 5, 6], repeat_kind: 'weekly',
      repeat_interval: null, repeat_unit: null, repeat_dates: null, effective_from: day(-60), except_dates: [], ends_on: null,
      remind: 'once', remind_every_min: 30, remind_until: '22:00:00', paused_from: null, paused_until: null, notes: 'With food.',
      stock_amount: 90, stock_set_at: day(-60), refill_days: 10, ...stamp(-60),
    },
  ]
  log.push({ ...logBase, id: logId(), date: today, meal_slot: 'supplement', library_ingredient_id: foods.creatine.id, quantity: 5, unit: 'g', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, supplement_schedule_id: tables.supplement_schedules[0].id, dose_time: '08:00:00', eaten_time: '08:05:00', created_at: at(0, '08:05') })
  tables.food_log_entries = log
  tables.recipe_meal_plans = []
  const waterId = idMaker('water_log_entries')
  tables.water_log_entries = [-2, -1, 0].flatMap(n => [['08:10', 400], ['11:30', 500], ['14:45', 330]]
    .slice(0, n === 0 ? 2 : 3)
    .map(([hhmm, ml]) => ({ id: waterId(), user_id: owner, date: day(n), amount_ml: ml, created_at: at(n, hhmm) })))
  tables.day_targets = [{
    user_id: owner, calories: 2300, protein_g: 160, water_ml: 2500, carbs_g: null, fat_g: null, goal: 'cut', last_calorie_adjust: null,
    phase_start_date: day(-42), goal_weight_kg: 78, goal_body_fat_pct: 15, goal_muscle_mass_kg: null, updated_at: at(-42, '09:00'),
  }]
  tables.day_target_profiles = [
    { id: '3d7a0000-0000-4000-8000-000000000001', user_id: owner, goal: 'cut', calories: 2300, protein_g: 160, water_ml: 2500, carbs_g: null, fat_g: null, ...stamp(-42) },
  ]
  tables.quick_guess_items = [
    ['Pizza slice', '🍕', '1 slice', 285, 12, 36, 10, 4], ['Burger', '🍔', '1 burger', 550, 28, 45, 28, 9],
    ['Sushi box', '🍣', '1 box', 480, 20, 75, 10, 12], ['Kebab plate', '🥙', '1 plate', 780, 38, 70, 38, 6],
  ].map(([name, icon, portion, kcal, p, c, f, s], i) => ({
    id: `9e550000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, name, icon, portion, calories: kcal,
    protein_g: p, carbs_g: c, fat_g: f, sugar_g: s, sort_order: i, options: [], ...stamp(-50),
  }))
  tables.food_favorites = []
  tables.food_recent_hidden = []

  // ── Health (Apple Health through Health Auto Export) ───────────────────────
  const metricId = idMaker('health_metrics')
  const WATCH = "Ola's Apple Watch|Ola's iPhone"
  const metrics = []
  const metric = (name, n, hhmm, unit, value, source = WATCH) => metrics.push({
    id: metricId(), user_id: owner, metric_name: name, date: day(n), recorded_at: at(n, hhmm), unit, source,
    source_family: 'apple', synced_at: at(n, hhmm), value,
  })
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now))
  for (let n = -59; n <= 0; n++) {
    const hours = ['08', '10', '12', '14', '17', '19', '21'].filter(h => n < 0 || Number(h) < Math.max(nowHour, 9))
    const busy = 1 + 0.25 * Math.sin(n * 0.9)
    for (const h of hours) {
      metric('step_count', n, `${h}:00`, 'count', { qty: Math.round(1250 * busy + wobble(n + Number(h), 180)) })
      metric('active_energy', n, `${h}:00`, 'kcal', { qty: round1(68 * busy + wobble(n + Number(h), 9)) })
      metric('basal_energy_burned', n, `${h}:00`, 'kcal', { qty: round1(240 + wobble(n, 6)) })
      metric('heart_rate', n, `${h}:00`, 'count/min', { Min: 58 + (Number(h) % 5), Avg: 74 + Math.round(wobble(n + Number(h), 6)), Max: 104 + (Number(h) % 7) * 6 })
    }
    if (hours.length >= 2) {
      metric('apple_exercise_time', n, `${hours[1]}:00`, 'min', { qty: Math.round(22 * busy) })
      metric('apple_exercise_time', n, `${hours[hours.length - 1]}:00`, 'min', { qty: Math.round(14 * busy) })
    }
    metric('resting_heart_rate', n, '07:00', 'count/min', { qty: 54 + Math.round(wobble(n, 2)) })
    metric('heart_rate_variability', n, '06:30', 'ms', { qty: round1(52 + wobble(n, 7)) })
    metric('respiratory_rate', n, '06:30', 'count/min', { qty: round1(14.6 + wobble(n, 0.5)) })
    metric('blood_oxygen_saturation', n, '05:00', '%', { qty: round1(96.8 + wobble(n, 0.8)) })
    metric('apple_sleeping_wrist_temperature', n, '06:00', 'degC', { qty: round1(35.1 + wobble(n, 0.2)) })
    if (n % 7 === 0) metric('vo2_max', n, '18:00', 'ml/(kg·min)', { qty: round1(46.2 + n / -60) })
    if (n % 2 === 0) {
      // A slow cut: about 82 kg two months ago, 80 kg now.
      const kg = round1(80 - n * 0.034 + wobble(n, 0.25))
      const fat = Math.round((0.18 - n * 0.0003) * 1000) / 1000
      metric('weight_body_mass', n, '07:05', 'kg', { qty: kg }, 'Smart Scale')
      metric('body_fat_percentage', n, '07:05', '%', { qty: fat }, 'Smart Scale')
      metric('lean_body_mass', n, '07:05', 'kg', { qty: round1(kg * (1 - fat)) }, 'Smart Scale')
    }
    // Last night, filed under the day of waking.
    const asleep = round1(7.1 + wobble(n, 0.6))
    metric('sleep_analysis', n, '07:00', 'hr', {
      totalSleep: asleep, core: round1(asleep * 0.56), rem: round1(asleep * 0.24), deep: round1(asleep * 0.2), awake: round1(0.4 + wobble(n, 0.15)),
      asleep: 0, inBed: round1(asleep + 0.6), sleepStart: haeLocal(day(n - 1), '23:15'), sleepEnd: haeLocal(day(n), '06:55'),
      inBedStart: haeLocal(day(n - 1), '23:00'), inBedEnd: haeLocal(day(n), '07:05'),
    })
  }
  tables.health_metrics = metrics
  tables.health_workouts = tables.hevy_workouts.slice(-10).map((w, i) => ({
    id: `4ea70000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, name: 'Traditional Strength Training',
    start_time: w.start_time, end_time: w.end_time, duration_seconds: Math.round((Date.parse(w.end_time) - Date.parse(w.start_time)) / 1000),
    active_energy_kj: 1250 + i * 20, total_energy_kj: 1700 + i * 25, avg_heart_rate: 118 + (i % 5), min_heart_rate: 78, max_heart_rate: 158,
    raw: { name: 'Traditional Strength Training', activeEnergyBurned: { qty: 1250 + i * 20, units: 'kJ' } }, created_at: w.end_time,
  }))
  tables.body_composition_reports = [-50, -29, -8].map((n, i) => ({
    id: `b0d70000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, measured_at: at(n, '07:10'),
    weight_kg: 82.4 - i * 0.9, body_fat_percent: 19.8 - i * 0.6, body_fat_mass_kg: round1((82.4 - i * 0.9) * (0.198 - i * 0.006)),
    lean_body_mass_kg: round1((82.4 - i * 0.9) * (0.802 + i * 0.006)), body_water_percent: 57.1 + i * 0.3, protein_percent: 17.6 + i * 0.1,
    muscle_percent: 75.2 + i * 0.4, skeletal_muscle_percent: 45.3 + i * 0.3, skeletal_muscle_index: 8.4, bmi: round1((82.4 - i * 0.9) / 3.276),
    visceral_fat_index: 8 - i * 0.5, subcutaneous_fat_kg: round1(13.1 - i * 0.6), bmr_kcal: 1780 - i * 6, body_score: 78 + i * 2,
    source: 'Smart Scale report', created_at: at(n, '07:12'),
  }))
  tables.hevy_body_measurements = [-60, -45, -30, -16, -2].map((n, i) => ({
    id: `b0d80000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, date: day(n), weight_kg: 82.6 - i * 0.6,
    lean_mass_kg: null, fat_percent: null, neck_cm: null, shoulder_cm: null, chest_cm: 104, left_bicep_cm: 36.5, right_bicep_cm: 36.8,
    left_forearm_cm: null, right_forearm_cm: null, abdomen_cm: null, waist_cm: 86.5 - i * 0.7, hips_cm: null, left_thigh_cm: 58,
    right_thigh_cm: 58.4, left_calf_cm: null, right_calf_cm: null, ...stamp(n, '07:30'),
  }))
  tables.sleep_night_confirmations = []
  tables.training_skips = []

  // ── Media: films, series, episodes and every watch ─────────────────────────
  const movieId = idMaker('movies'), entryMovieId = idMaker('user_movie_entries'), watchId = idMaker('media_watches')
  const genre = (...names) => names.map((name, i) => ({ id: 18 + i * 10, name }))
  const movieDefs = [
    ['The Quiet Fjord', '2025-03-14', 112, ['Drama'], 'completed', 3, 8],
    ['Northern Signal', '2026-02-06', 128, ['Science Fiction', 'Thriller'], 'completed', 12, 7],
    ['Harbour Lights', '2024-06-21', 98, ['Comedy', 'Romance'], 'wishlist', null, null],
    ['The Extraordinarily Long Voyage of the Midnight Ferry to Bergen', '2023-09-01', 141, ['Adventure', 'Drama'], 'wishlist', null, null],
    ['Ice Road Nine', day(41), 104, ['Action'], 'upcoming', null, null],
    ['Small Hours', '2022-10-28', 104, ['Thriller'], 'completed', 40, 9],
    ['Paper Mountains', '2021-04-02', 95, ['Animation', 'Family'], 'dropped', null, null],
    ['Last Train from Jernbanetorget', '2025-11-21', 119, ['Mystery'], 'watching', null, null],
    ['Glass Garden', '2020-01-17', 110, ['Drama'], 'completed', 70, 6],
    ['Copper Coast', day(13), 101, ['Drama', 'History'], 'wishlist', null, null],
  ]
  tables.movies = []
  tables.user_movie_entries = []
  tables.media_watches = []
  movieDefs.forEach(([title, release, runtime, genres, status, watchedAgo, rating], i) => {
    const m = {
      id: movieId(), tmdb_id: 990001 + i, title, original_title: title, overview: `${title} — a made-up film for the test harness.`,
      release_date: release, runtime, status: release > today ? 'Post Production' : 'Released', poster_path: `/harness-movie-${i + 1}.jpg`,
      backdrop_path: null, genres: genre(...genres), tmdb_rating: 6.4 + (i % 4) * 0.5, tmdb_vote_count: 800 + i * 37,
      imdb_rating: 6.5 + (i % 3) * 0.4, rt_critics: 70 + i, rt_audience: 66 + i, metacritic: 60 + i, letterboxd_rating: 3.4,
      rt_url: null, ratings_fetched_at: at(-5, '03:00'), metadata_json: { original_language: 'en' }, created_at: at(-100 + i, '20:00'),
    }
    tables.movies.push(m)
    const e = {
      id: entryMovieId(), user_id: owner, movie_id: m.id, status, priority: i === 3 ? 'high' : 'medium', personal_note: i === 1 ? 'Seen at the cinema.' : null,
      rating, planned_date: i === 9 ? day(14) : null, notify_before_days: null, repeat_count: watchedAgo == null ? 0 : (i === 5 ? 2 : 1),
      watched_at: watchedAgo == null ? null : at(-watchedAgo, '21:30'), is_favorite: i === 5, rewatch_round: null, rewatch_started_at: null,
      ...stamp(-100 + i * 3, '20:00'),
    }
    tables.user_movie_entries.push(e)
    if (watchedAgo != null) {
      const watches = i === 5 ? [watchedAgo + 300, watchedAgo] : [watchedAgo]
      for (const ago of watches) {
        tables.media_watches.push({
          id: watchId(), user_id: owner, kind: 'movie', movie_entry_id: e.id, episode_id: null, tv_series_id: null, season_number: null,
          episode_number: null, watched_at: at(-ago, '21:30'), trakt_history_id: null, source: 'app', ...stamp(-ago, '23:30'),
        })
      }
    }
  })
  tables.movie_cinema_visits = [{
    id: 'c1e40000-0000-4000-8000-000000000001', user_id: owner, movie_id: tables.movies[1].id, watched_on: day(-12), cinema: 'City Cinema',
    location: 'Oslo', companions: 'Kari', cost: 165, currency: 'NOK', note: null, created_at: at(-12, '23:00'),
  }]

  const seriesId = idMaker('tv_series'), tvEntryId = idMaker('user_tv_entries'), episodeId = idMaker('user_tv_episodes')
  const seriesDefs = [
    ['Fjord Patrol', 3, 24, 'Returning Series', 'watching', [2, 5]],
    ['The Archive', 2, 16, 'Ended', 'completed', [2, 8]],
    ['Midnight Kitchen', 1, 8, 'Returning Series', 'wishlist', [1, 0]],
    ['Signal Lost', 4, 40, 'Ended', 'paused', [3, 2]],
    ['The Lighthouse Keepers of the Northern Coast and Their Very Long Winters', 1, 6, 'Returning Series', 'watching', [1, 3]],
    ['Weekend Builders', 5, 50, 'Returning Series', 'wishlist', [1, 0]],
  ]
  tables.tv_series = []
  tables.user_tv_entries = []
  tables.user_tv_episodes = []
  seriesDefs.forEach(([title, seasons, episodes, status, entryStatus, [curS, curE]], i) => {
    const perSeason = Math.round(episodes / seasons)
    const s = {
      id: seriesId(), tmdb_id: 980001 + i, title, original_title: title, overview: `${title} — a made-up series for the test harness.`,
      first_air_date: `${2019 + i}-0${(i % 8) + 1}-15`, last_air_date: day(-20 - i * 30), status, episode_run_time: 42 + i * 3,
      number_of_seasons: seasons, number_of_episodes: episodes, poster_path: `/harness-series-${i + 1}.jpg`, backdrop_path: null,
      genres: genre(i % 2 ? 'Mystery' : 'Drama', 'Crime'), tmdb_rating: 7.1 + (i % 3) * 0.3, tmdb_vote_count: 400 + i * 51,
      imdb_rating: 7.3, rt_critics: 82, rt_audience: 78, metacritic: 70, letterboxd_rating: null, rt_url: null,
      ratings_fetched_at: at(-5, '03:00'), metadata_json: { original_language: 'no' }, created_at: at(-200 + i, '20:00'),
    }
    tables.tv_series.push(s)
    const e = {
      id: tvEntryId(), user_id: owner, tv_series_id: s.id, status: entryStatus, priority: 'medium', personal_note: null,
      rating: entryStatus === 'completed' ? 8 : null, current_season: curS, current_episode: curE, planned_date: null,
      notify_before_days: null, repeat_count: 0, started_at: curE ? day(-90 + i * 10) : null, finished_at: entryStatus === 'completed' ? day(-60) : null,
      is_favorite: i === 1, rewatch_round: null, rewatch_started_at: null, ...stamp(-120 + i * 5, '20:00'),
    }
    tables.user_tv_entries.push(e)
    // Every episode up to the current one is watched, newest last.
    const watched = []
    for (let season = 1; season <= curS; season++) {
      const last = season < curS ? perSeason : curE
      for (let ep = 1; ep <= last; ep++) watched.push([season, ep])
    }
    watched.forEach(([season, ep], k) => {
      const ago = (watched.length - k) * 3 + i
      const epRow = {
        id: episodeId(), user_id: owner, tv_entry_id: e.id, tv_series_id: s.id, season_number: season, episode_number: ep,
        watched_at: at(-ago, '21:00'), repeat_count: 0, ...stamp(-ago, '22:00'),
      }
      tables.user_tv_episodes.push(epRow)
      tables.media_watches.push({
        id: watchId(), user_id: owner, kind: 'episode', movie_entry_id: null, episode_id: epRow.id, tv_series_id: s.id,
        season_number: season, episode_number: ep, watched_at: epRow.watched_at, trakt_history_id: null, source: 'app', ...stamp(-ago, '22:00'),
      })
    })
  })
  tables.media_follows = []
  tables.media_release_reminders = []

  // ── Shop: wishlist, quick list, owned ──────────────────────────────────────
  const shopCatId = idMaker('shop_categories'), shopId = idMaker('shop_items')
  const cats = Object.fromEntries(['Electronics', 'Home', 'Sports', 'Clothing', 'Groceries'].map((name, i) => [name, {
    id: shopCatId(), user_id: owner, name, parent_id: null, created_at: at(-120 + i, '12:00'),
  }]))
  tables.shop_categories = Object.values(cats)
  const shopBase = {
    user_id: owner, notes: null, price: null, price_source: 'manual', platform: null, url: null, priority: 'medium', region: 'NO',
    planned_date: null, status: 'wishlist', source_type: 'manual', list: 'wishlist', currency: 'NOK', bought_at: null, task_id: null,
    kind: 'item', price_min: null, price_max: null, requirements: null, option_for: null, meets: null, accessory_of: null, reason: 'need',
    wait_for_deal: false, target_price: null, deal_note: null, errand: false, image_url: null, ean: null, fx_nok: 1, fx_source: 'fixed',
    market_price: null, market_currency: null, used: false, got_as_gift: false, for_resale: false, kept: true, approx_dates: false,
    serial: null, warranty_until: null, return_by: null, value_now: null, value_currency: null, value_on: null, disposed_on: null,
    disposal: null, sale_price: null, sale_currency: null, sale_fx_nok: null, sale_fx_source: null, sold_to: null, sale_group: null, chain_name: null,
  }
  let shopN = 0
  const shopItem = (title, category, extra = {}) => ({
    ...shopBase, id: shopId(), title, category_id: category ? cats[category].id : null, ...stamp(-90 + (shopN++) * 3, '19:00'), ...extra,
  })
  const headphones = shopItem('Noise-cancelling headphones', 'Electronics', { price: 3490, priority: 'high', reason: 'fun', url: 'https://example.com/headphones', wait_for_deal: true, target_price: 2990 })
  const jacket = shopItem('Winter jacket', 'Clothing', { kind: 'general', price_min: 1500, price_max: 3500, requirements: 'Warm to −15 °C, hood, long enough to sit on' })
  const laptop = shopItem('Laptop', 'Electronics', { status: 'bought', bought_at: day(-200), price: 14990, serial: 'MOCK-SN-0001', warranty_until: day(530) })
  tables.shop_items = [
    headphones, jacket, laptop,
    shopItem('Parka with a removable hood and plenty of pockets for the long winter walks', 'Clothing', { option_for: jacket.id, price: 2799, url: 'https://example.com/parka' }),
    shopItem('Down jacket', 'Clothing', { option_for: jacket.id, price: 2299, url: 'https://example.com/down-jacket', meets: { warm: true } }),
    shopItem('Coffee grinder', 'Home', { price: 1290, priority: 'low', reason: 'fun' }),
    shopItem('Trail running shoes', 'Sports', { price: 1599, planned_date: day(10) }),
    shopItem('Foam roller', 'Sports', { price: 299, priority: 'low' }),
    shopItem('Laptop sleeve', 'Electronics', { accessory_of: laptop.id, status: 'bought', bought_at: day(-190), price: 349 }),
    shopItem('Robot vacuum', 'Home', { status: 'bought', bought_at: day(-400), price: 3990, warranty_until: day(-35) }),
    shopItem('Old tablet', 'Electronics', { status: 'bought', bought_at: day(-900), price: 4490, kept: false, disposed_on: day(-30), disposal: 'sold', sale_price: 1200, sale_currency: 'NOK', sale_fx_nok: 1, sale_fx_source: 'fixed', sold_to: 'Neighbour' }),
    shopItem('Milk', 'Groceries', { list: 'quick', errand: true, price: 22 }),
    shopItem('Oats', 'Groceries', { list: 'quick', errand: true, price: 35 }),
    shopItem('Light bulbs E27', 'Home', { list: 'quick', errand: true, platform: 'Hardware store' }),
    shopItem('Stamps', null, { list: 'quick', errand: true, planned_date: today }),
  ]
  tables.shop_item_costs = [{
    id: '5c050000-0000-4000-8000-000000000001', user_id: owner, item_id: laptop.id, label: 'Extended warranty', amount: 990, currency: 'NOK',
    spent_on: day(-200), fx_nok: 1, fx_source: 'fixed', ...stamp(-200),
  }]
  tables.shop_item_links = []
  tables.shop_price_watch = [{
    item_id: headphones.id, user_id: owner, url: headphones.url, checked_at: at(-1, '05:00'), status: 'ok', error: null, source: 'store',
    name: 'Noise-cancelling headphones', image: null, low: 3190, high: 3690, offers: 4, currency: 'NOK', in_stock: true, was: 3490,
    return_days: 30, last_ok_at: at(-1, '05:00'), prev_low: 3290, prev_at: at(-8, '05:00'),
  }]
  tables.shop_price_points = [-30, -20, -8, -1].map((n, i) => ({
    id: `5c060000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, item_id: headphones.id, user_id: owner, checked_at: at(n, '05:00'),
    low: [3490, 3390, 3290, 3190][i], high: 3690, offers: 4, currency: 'NOK', source: 'store',
  }))

  // ── Work ───────────────────────────────────────────────────────────────────
  const weekStart = day(mondayOffset)
  tables.work_notes = [{ id: '30c10000-0000-4000-8000-000000000001', user_id: owner, content: 'Ask about the new laptop policy.\nBook a room for the planning workshop.', updated_at: at(-1, '16:40') }]
  tables.work_weekly_goals = ['Ship the Q4 planning slides', 'Finish the onboarding review', 'Clear the support inbox'].map((title, i) => ({
    id: `30c20000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, week_start: weekStart, title, done: i === 2,
    sort_order: i, created_at: at(mondayOffset, '08:30'),
  }))
  tables.work_pinned_links = [['Team wiki', 'https://example.com/wiki'], ['Sprint board', 'https://example.com/board'], ['Expense claims', 'https://example.com/expenses']].map(([title, url], i) => ({
    id: `30c30000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, title, url, sort_order: i, created_at: at(-60, '09:00'),
  }))

  // ── Wishes ─────────────────────────────────────────────────────────────────
  const year = Number(today.slice(0, 4))
  tables.wish_items = [
    ['See the northern lights', 'place', `${year}-11-15`, `${year + 1}-02-28`, 'This winter', 'Tromsø', 'Norway', 'high'],
    ['A long weekend in Lisbon', 'place', `${year + 1}-04-01`, `${year + 1}-05-31`, 'Spring', 'Lisbon', 'Portugal', 'medium'],
    ['Try ice bathing at the fjord', 'thing', day(-10), day(60), 'Before Christmas', null, null, 'medium'],
    ['Learn to make proper pizza dough', 'thing', null, null, null, null, null, 'low'],
    ['Hike to the top of a mountain at sunrise', 'thing', `${year + 1}-06-01`, `${year + 1}-08-31`, 'Summer', null, null, 'medium'],
    ['Christmas market at Spikersuppa', 'place', `${year}-11-20`, `${year}-12-23`, 'Advent', 'Oslo', 'Norway', 'low'],
    ['Visit the island cabin', 'place', null, null, null, 'Hvaler', 'Norway', 'medium'],
  ].map(([title, kind, period_start, period_end, period_label, city, country, priority], i) => ({
    id: `91540000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, title, notes: null, kind, period_start, period_end,
    period_label, city, country, url: null, priority, status: i === 6 ? 'planned' : 'idea', promoted_task_id: null, sort_order: i, ...stamp(-70 + i * 4),
  }))

  // ── Developer: activity, errors, memory, requests ──────────────────────────
  const firstTask = tasks[5]
  tables.audit_logs = [
    ['tasks', 'UPDATE', firstTask.id, { status: 'open' }, { status: 'done' }, 0, '09:12'],
    ['food_log_entries', 'INSERT', log[log.length - 1].id, null, { meal_slot: 'supplement', quantity: 5 }, 0, '08:05'],
    ['tasks', 'INSERT', tasks[0].id, null, { title: tasks[0].title, due_date: today }, -1, '21:40'],
    ['time_blocks', 'UPDATE', tables.time_blocks[0].id, { start_time: '11:00:00' }, { start_time: '12:00:00' }, -1, '20:15'],
    ['shop_items', 'DELETE', '5a5a0000-0000-4000-8000-0000000000ff', { title: 'Old phone case' }, null, -1, '18:02'],
    ['wish_items', 'INSERT', tables.wish_items[0].id, null, { title: tables.wish_items[0].title }, -1, '17:30'],
  ].map(([table_name, operation, row_id, old_data, new_data, n, hhmm], i) => ({
    id: `a0d70000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, seq: i + 1, user_id: owner, table_name, operation, row_id,
    old_data, new_data, actor: 'web', tx_id: 51000 + i, created_at: at(n, hhmm),
  }))
  tables.app_error_logs = [
    ['Weather request failed: network error', { feature: 'home', action: 'weather' }, 0, '07:58'],
    ['Transit departures timed out', { feature: 'home', action: 'transit', stop: 'Jernbanetorget' }, -1, '16:31'],
  ].map(([message, context, n, hhmm], i) => ({ id: `e7700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, message, context, created_at: at(n, hhmm) }))
  tables.ai_memory = [
    ['fact', 'Training days', 'Trains four days a week, mornings before work.', 'user'],
    ['preference', 'Food', 'Prefers simple dinners on weekdays; batch cooks on Sundays.', 'ai'],
    ['note', 'Garage workshop', 'The bench is 92 cm high; the top is 18 mm plywood.', 'user'],
  ].map(([kind, title, content, source], i) => ({ id: `a1e00000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, kind, title, content, source, ...stamp(-20 + i * 6) }))
  tables.dev_requests = [
    ['Week view: show the training sessions as their own row', 'feature', 'medium', 'open', 'daily'],
    ['Food: copy a whole day to another day', 'improvement', 'low', 'open', 'recipes'],
    ['Shop totals flicker while the rates load', 'bug', 'high', 'in_progress', 'shop'],
    ['Dark mode chart colours on Health', 'improvement', 'medium', 'done', 'health'],
  ].map(([title, category, priority, status, page], i) => ({
    id: `de500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, title, description: null, page, category, priority, status,
    effort: 'small', sort_order: i, completed_at: status === 'done' ? at(-3, '15:00') : null, prompted_at: null, ...stamp(-25 + i * 5),
  }))

  // ── Games ──────────────────────────────────────────────────────────────────
  const gameId = idMaker('games'), platformId = idMaker('game_platforms')
  const gameBase = {
    user_id: owner, release_year: null, publisher: null, developer: null, description: null, storyline: null, genres: [], series_name: null,
    play_status: 'backlog', tier: null, rating: null, play_order: null, is_coop: false, coop_notes: null, is_iconic: false, play_notes: null,
    game_log: null, primary_cover_url: null, age_rating: null, players: '1', modes: [], screenshot_url: null, fanart_url: null,
    external_ref: null, external_source: 'manual', synced_at: null, needs_review: false, esde_playcount: null, esde_last_played: null,
    esde_playtime_seconds: null, library: 'retro', play_seconds: null, play_count: null, last_played_at: null, started_at: null,
    finished_at: null, media: null, ss_jeu_id: null, ss_scraped_at: null, provider_kind: null, first_played_at: null, igdb_id: null,
    igdb_slug: null, igdb_url: null, igdb_match: null, igdb_fetched_at: null, igdb_rating: null, igdb_rating_count: null,
    igdb_critic_rating: null, igdb_critic_count: null, igdb_total_rating: null, igdb_total_count: null, ttb_main_seconds: null,
    ttb_extra_seconds: null, ttb_full_seconds: null, ttb_count: null, igdb_data: null, provider_data: null,
  }
  const gameDefs = [
    ['Star Courier', 'steam', 'playing', 2019, ['Adventure', 'Simulation'], { play_order: 1, play_seconds: 151200, play_count: 31, last_played_at: at(-1, '21:30'), rating: 8, external_source: 'steam', external_ref: '900001' }],
    ['Pixel Fjord', 'retro', 'completed', 1994, ['Platform'], { tier: 'A', rating: 9, finished_at: day(-80), esde_playcount: 12, esde_playtime_seconds: 40000, esde_last_played: at(-80, '20:00'), is_iconic: true }],
    ['Lantern Keep', 'playstation', 'backlog', 2023, ['Role-playing'], { play_order: 2, external_source: 'psn', external_ref: 'PSN-0002' }],
    ['Retro Racer 64', 'retro', 'playing', 1998, ['Racing'], { play_order: 3, esde_playcount: 4, esde_playtime_seconds: 9000, esde_last_played: at(-6, '19:00'), last_played_at: at(-6, '19:00'), is_coop: true, coop_notes: 'Split screen' }],
    ['Moonlit Orchard', 'steam', 'wishlist', 2026, ['Puzzle'], { external_source: 'steam', external_ref: '900005' }],
    ['The Very Long Night of the Clockwork Lighthouse: Director’s Cut', 'steam', 'backlog', 2021, ['Adventure', 'Puzzle'], { play_order: 4, external_source: 'steam', external_ref: '900006' }],
    ['Brick Breaker Deluxe', 'retro', 'dropped', 1989, ['Arcade'], { rating: 5 }],
    ['Harbour Tycoon', 'steam', 'completed', 2018, ['Strategy'], { tier: 'B', rating: 7, play_seconds: 230000, play_count: 60, finished_at: day(-150), last_played_at: at(-150, '22:00'), external_source: 'steam', external_ref: '900008' }],
  ]
  tables.games = []
  tables.game_platforms = []
  const systemOf = { retro: 'snes', steam: 'pc', playstation: 'ps5' }
  gameDefs.forEach(([title, library, play_status, release_year, genres, extra], i) => {
    const g = { ...gameBase, id: gameId(), title, library, play_status, release_year, genres, ...stamp(-300 + i * 9, '20:00'), ...extra }
    tables.games.push(g)
    tables.game_platforms.push({
      id: platformId(), user_id: owner, game_id: g.id, system: library === 'retro' && i === 3 ? 'n64' : systemOf[library], emulator: library === 'retro' ? 'RetroArch' : null,
      emulator_type: library === 'retro' ? 'retroarch_core' : null, performance: library === 'retro' ? 'good' : null, performance_notes: null,
      cover_url: null, region: library === 'retro' ? 'eu' : null, rom_status: library === 'retro' ? 'installed' : null, rom_url: null,
      folder_path: null, is_primary_variant: true, version_title: null, rating: null, release_date: null, box_url: null, wheel_url: null,
      external_ref: g.external_ref, external_source: g.external_source, synced_at: null, needs_review: false, esde_system: null, esde_path: null,
      esde_playcount: g.esde_playcount, esde_playtime_seconds: g.esde_playtime_seconds, esde_last_played: g.esde_last_played,
      esde_source_hash: null, esde_assets: {}, ...stamp(-300 + i * 9, '20:00'),
    })
  })
  tables.games_prefs = [{ user_id: owner, prefs: {}, updated_at: at(-10, '12:00') }]

  // ── Books ──────────────────────────────────────────────────────────────────
  const bookId = idMaker('books')
  const bookDefs = [
    ['The Quiet Harbour', 'Kari Nordmann', 'reading', 342, 46, -1],
    ['Notes from a Small Fjord', 'Ola Nordmann', 'finished', 228, 100, -40],
    ['A Field Guide to Northern Birds', 'Kari Nordmann', 'want', 410, 0, null],
    ['The Lighthouse Keeper’s Very Long Winter and Other Stories from the Coast', 'Ola and Kari Nordmann', 'reading', 512, 12, -3],
    ['Bread, Salt and Butter', 'Ola Nordmann', 'paused', 190, 63, -30],
    ['Clockwork Summer', 'Ola and Kari Nordmann', 'finished', 301, 100, -90],
  ]
  tables.books = bookDefs.map(([title, author, read_status, page_count, progress, lastAgo], i) => ({
    id: bookId(), user_id: owner, koreader_md5: null, kobo_content_id: null, file_path: null, title, author, series: null, series_index: null,
    language: 'en', isbn: null, publisher: null, published_year: 2015 + i, description: null, page_count, cover_url: null, read_status,
    rating: read_status === 'finished' ? 4 : null, review: null, notes: null, started_at: lastAgo == null ? null : at(lastAgo - 20, '21:00'),
    finished_at: read_status === 'finished' ? at(lastAgo, '22:00') : null, queue_order: read_status === 'want' ? 1 : null,
    progress_pct: progress, last_read_at: lastAgo == null ? null : at(lastAgo, '22:10'), read_seconds: progress * 300, read_pages: Math.round(page_count * progress / 100),
    on_device: read_status === 'reading', source: 'manual', meta_source: null, meta_checked_at: null, kind: 'book', cover_source: null,
    device_cover_at: null, categories: [], subjects: [], file_size: null, ...stamp(-200 + i * 10, '20:00'),
  }))
  const reading = tables.books[0]
  tables.reading_page_events = Array.from({ length: 14 }, (_, k) => k).filter(k => k % 3 !== 2).flatMap(k => [0, 1, 2].map(j => ({
    id: `4ead0000-0000-4000-8000-${String(k * 3 + j + 1).padStart(12, '0')}`, user_id: owner, book_id: reading.id, page: 100 + k * 9 + j * 3,
    started_at: at(-k, `22:${String(j * 7).padStart(2, '0')}`), duration_seconds: 380,
  })))
  tables.reading_settings = [{ user_id: owner, daily_minutes_goal: 30, streak_min_minutes: 10, updated_at: at(-50, '12:00') }]
  tables.kobo_feed_state = [{
    user_id: owner, last_feed_at: at(-1, '22:00'), last_download_at: at(-3, '20:00'), last_seen_at: at(-1, '22:30'), last_sync_at: at(-1, '22:30'),
    device_id: 'mock-kobo-01', plugin_version: '1.0.0', last_sync_result: { new_events: 9, books_created: 0, books_updated: 1, unmatched: 0, at: at(-1, '22:30') },
    battery: 64, charging: false, koreader_version: 'v2026.07.1', storage_total: 16000000000, storage_free: 11200000000, storage_at: at(-1, '22:30'),
  }]
  tables.book_deliveries = []

  // ── Football, subscriptions, transit ───────────────────────────────────────
  tables.football_follows = [
    ['team', '9001', 'Oslo City FC', 'nor.1', true, true], ['team', '9002', 'Fjord United', 'nor.1', false, false], ['league', 'nor.1', 'Eliteserien', 'nor.1', false, false],
  ].map(([kind, ref, name, league, subscribed, favourite], i) => ({
    id: `f0070000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, kind, ref, name, logo: null, league, subscribed,
    favourite, sort_order: i, ...stamp(-100 + i),
  }))
  tables.football_plans = []
  tables.service_subscriptions = [
    ['streaming', 'Film streaming', 'Standard', 149, 'monthly', 12, 'info'],
    ['music', 'Music service', 'Family', 239, 'monthly', 4, 'info'],
    ['hevy', 'Hevy', 'Pro', 299, 'yearly', 120, 'required'],
    ['cloud', 'Cloud storage', '2 TB', 99, 'monthly', 21, 'info'],
  ].map(([service, name, plan, price, billing_cycle, renewsIn, requirement], i) => ({
    id: `5e510000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: owner, service, name, account: 'ola.nordmann@example.com',
    plan, price, currency: 'NOK', billing_cycle, renews_on: day(renewsIn), requirement, notes: null, active: true, ...stamp(-200 + i),
  }))
  tables.user_transit_stops = [{
    id: '7a510000-0000-4000-8000-000000000001', user_id: owner, stop_id: 'NSR:StopPlace:99001', stop_name: 'Jernbanetorget', stop_locality: 'Oslo',
    label: 'Home', is_default: true, sort_order: 0, quay_id: null, quay_description: null, lat: null, lon: null, created_at: at(-90, '12:00'),
  }]
  tables.user_transit_routes = []
  tables.transit_recent_searches = []
  tables.calendar_prefs = []
  tables.google_task_lists = []
  tables.diary_entries = [{ user_id: owner, day: day(-1), body: 'Long walk along the river after dinner. Slept well.', updated_at: at(-1, '22:40') }]
  tables.push_subscriptions = []
  // Read by the pages and empty for this owner: nothing connected outside, nothing overridden.
  for (const name of [
    'supplement_dose_state', 'athlete_limitations', 'athlete_muscle_preferences', 'exercise_target_overrides',
    'exercise_gif_overrides', 'pt_assessments', 'steam_apps', 'strava_tokens', 'media_follow_events',
  ]) tables[name] = tables[name] || []
  return tables
}

module.exports = { OWNER, RELATIONS, buildTables, osloDay, osloInstant, addDays }
