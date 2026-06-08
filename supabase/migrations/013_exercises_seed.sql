-- ─── System exercise library ─────────────────────────────────────────────────
-- Pre-populate the exercises table with common strength/gym exercises.
-- is_system = true, user_id = NULL → visible to all authenticated users.

INSERT INTO exercises (name, category, muscle_groups, equipment, is_system)
VALUES
  -- ─── Chest ───────────────────────────────────────────────────────────────
  ('Bench Press',              'strength', ARRAY['chest','triceps','shoulders'], 'barbell',    true),
  ('Incline Bench Press',      'strength', ARRAY['chest','triceps','shoulders'], 'barbell',    true),
  ('Decline Bench Press',      'strength', ARRAY['chest','triceps'],             'barbell',    true),
  ('Dumbbell Bench Press',     'strength', ARRAY['chest','triceps','shoulders'], 'dumbbell',   true),
  ('Incline Dumbbell Press',   'strength', ARRAY['chest','triceps','shoulders'], 'dumbbell',   true),
  ('Dumbbell Flyes',           'strength', ARRAY['chest'],                       'dumbbell',   true),
  ('Cable Crossover',          'strength', ARRAY['chest'],                       'cable',      true),
  ('Push-up',                  'strength', ARRAY['chest','triceps','shoulders'], 'bodyweight', true),
  ('Chest Dip',                'strength', ARRAY['chest','triceps'],             'bodyweight', true),
  ('Pec Deck',                 'strength', ARRAY['chest'],                       'machine',    true),

  -- ─── Shoulders ───────────────────────────────────────────────────────────
  ('Overhead Press',           'strength', ARRAY['shoulders','triceps'],         'barbell',    true),
  ('Dumbbell Shoulder Press',  'strength', ARRAY['shoulders','triceps'],         'dumbbell',   true),
  ('Arnold Press',             'strength', ARRAY['shoulders','triceps'],         'dumbbell',   true),
  ('Lateral Raise',            'strength', ARRAY['shoulders'],                   'dumbbell',   true),
  ('Front Raise',              'strength', ARRAY['shoulders'],                   'dumbbell',   true),
  ('Rear Delt Fly',            'strength', ARRAY['shoulders','back'],            'dumbbell',   true),
  ('Face Pull',                'strength', ARRAY['shoulders','back'],            'cable',      true),
  ('Upright Row',              'strength', ARRAY['shoulders','traps'],           'barbell',    true),
  ('Shrug',                    'strength', ARRAY['traps'],                       'barbell',    true),
  ('Cable Lateral Raise',      'strength', ARRAY['shoulders'],                   'cable',      true),

  -- ─── Back ────────────────────────────────────────────────────────────────
  ('Pull-up',                  'strength', ARRAY['back','biceps'],               'bodyweight', true),
  ('Chin-up',                  'strength', ARRAY['back','biceps'],               'bodyweight', true),
  ('Lat Pulldown',             'strength', ARRAY['back','biceps'],               'cable',      true),
  ('Seated Cable Row',         'strength', ARRAY['back','biceps'],               'cable',      true),
  ('Barbell Row',              'strength', ARRAY['back','biceps'],               'barbell',    true),
  ('Dumbbell Row',             'strength', ARRAY['back','biceps'],               'dumbbell',   true),
  ('T-Bar Row',                'strength', ARRAY['back','biceps'],               'barbell',    true),
  ('Deadlift',                 'strength', ARRAY['back','glutes','hamstrings'],  'barbell',    true),
  ('Romanian Deadlift',        'strength', ARRAY['hamstrings','glutes','back'],  'barbell',    true),
  ('Rack Pull',                'strength', ARRAY['back','traps'],                'barbell',    true),
  ('Straight-Arm Pulldown',    'strength', ARRAY['back'],                        'cable',      true),
  ('Hyperextension',           'strength', ARRAY['lower back','glutes'],         'machine',    true),

  -- ─── Biceps ──────────────────────────────────────────────────────────────
  ('Barbell Curl',             'strength', ARRAY['biceps'],                      'barbell',    true),
  ('Dumbbell Curl',            'strength', ARRAY['biceps'],                      'dumbbell',   true),
  ('Hammer Curl',              'strength', ARRAY['biceps','forearms'],           'dumbbell',   true),
  ('Preacher Curl',            'strength', ARRAY['biceps'],                      'barbell',    true),
  ('Cable Curl',               'strength', ARRAY['biceps'],                      'cable',      true),
  ('Concentration Curl',       'strength', ARRAY['biceps'],                      'dumbbell',   true),
  ('Incline Dumbbell Curl',    'strength', ARRAY['biceps'],                      'dumbbell',   true),

  -- ─── Triceps ─────────────────────────────────────────────────────────────
  ('Tricep Dip',               'strength', ARRAY['triceps','chest'],             'bodyweight', true),
  ('Skull Crusher',            'strength', ARRAY['triceps'],                     'barbell',    true),
  ('Tricep Pushdown',          'strength', ARRAY['triceps'],                     'cable',      true),
  ('Overhead Tricep Extension','strength', ARRAY['triceps'],                     'dumbbell',   true),
  ('Close-Grip Bench Press',   'strength', ARRAY['triceps','chest'],             'barbell',    true),
  ('Tricep Kickback',          'strength', ARRAY['triceps'],                     'dumbbell',   true),
  ('Diamond Push-up',          'strength', ARRAY['triceps','chest'],             'bodyweight', true),

  -- ─── Legs ────────────────────────────────────────────────────────────────
  ('Squat',                    'strength', ARRAY['quads','glutes','hamstrings'], 'barbell',    true),
  ('Front Squat',              'strength', ARRAY['quads','glutes'],              'barbell',    true),
  ('Goblet Squat',             'strength', ARRAY['quads','glutes'],              'dumbbell',   true),
  ('Leg Press',                'strength', ARRAY['quads','glutes','hamstrings'], 'machine',    true),
  ('Hack Squat',               'strength', ARRAY['quads','glutes'],              'machine',    true),
  ('Lunge',                    'strength', ARRAY['quads','glutes','hamstrings'], 'dumbbell',   true),
  ('Bulgarian Split Squat',    'strength', ARRAY['quads','glutes'],              'dumbbell',   true),
  ('Leg Extension',            'strength', ARRAY['quads'],                       'machine',    true),
  ('Leg Curl',                 'strength', ARRAY['hamstrings'],                  'machine',    true),
  ('Hip Thrust',               'strength', ARRAY['glutes','hamstrings'],         'barbell',    true),
  ('Glute Bridge',             'strength', ARRAY['glutes','hamstrings'],         'bodyweight', true),
  ('Calf Raise',               'strength', ARRAY['calves'],                      'machine',    true),
  ('Seated Calf Raise',        'strength', ARRAY['calves'],                      'machine',    true),
  ('Good Morning',             'strength', ARRAY['hamstrings','lower back'],     'barbell',    true),
  ('Step-up',                  'strength', ARRAY['quads','glutes'],              'dumbbell',   true),

  -- ─── Core ────────────────────────────────────────────────────────────────
  ('Plank',                    'strength', ARRAY['core'],                        'bodyweight', true),
  ('Crunch',                   'strength', ARRAY['core'],                        'bodyweight', true),
  ('Cable Crunch',             'strength', ARRAY['core'],                        'cable',      true),
  ('Leg Raise',                'strength', ARRAY['core'],                        'bodyweight', true),
  ('Russian Twist',            'strength', ARRAY['core'],                        'bodyweight', true),
  ('Ab Wheel Rollout',         'strength', ARRAY['core'],                        'other',      true),
  ('Side Plank',               'strength', ARRAY['core'],                        'bodyweight', true),

  -- ─── Cardio / Other ──────────────────────────────────────────────────────
  ('Farmer''s Walk',           'strength', ARRAY['forearms','traps','core'],     'dumbbell',   true),
  ('Sled Push',                'other',    ARRAY['legs','core'],                 'other',      true),
  ('Battle Rope',              'other',    ARRAY['shoulders','arms','core'],     'other',      true),
  ('Box Jump',                 'plyometric',ARRAY['legs'],                       'other',      true),
  ('Burpee',                   'plyometric',ARRAY['full body'],                  'bodyweight', true),
  ('Kettlebell Swing',         'other',    ARRAY['glutes','hamstrings','core'],  'kettlebell', true),
  ('Turkish Get-up',           'other',    ARRAY['full body'],                   'kettlebell', true)
ON CONFLICT DO NOTHING;
