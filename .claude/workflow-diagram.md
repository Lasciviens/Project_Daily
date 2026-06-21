# Project Daily — Workflow Diagram

> Paste any diagram block into https://mermaid.live to render it.

---

## 1. App Architecture Overview

```mermaid
graph TD
  subgraph GHP["🌐 GitHub Pages"]
    App["React 18 + Vite\nHashRouter /#/route"]
  end

  subgraph SB["🗄️ Supabase"]
    Auth["Auth\n(email/password)"]
    DB["PostgreSQL\n(RLS enabled)"]
    EF["Edge Functions\n(Deno)"]
    Vault["Vault\n(secrets)"]
  end

  subgraph EXT["🔌 External APIs"]
    TMDB["TMDB\n(movies/tv)"]
    Strava["Strava\n(workouts)"]
    GCal["Google Calendar\n(events)"]
    GTasks["Google Tasks"]
    Gemini["Gemini 2.5 Flash\n(AI)"]
    MetNo["Met.no\n(weather)"]
    RSS["RSS Feeds\n(news)"]
    FootballAPI["API-Football\n(fixtures)"]
    RP5["RP5 Supabase\n(games — separate instance)"]
  end

  User["👤 User"] --> App
  App -->|"supabase-js"| Auth
  App -->|"supabase-js"| DB
  App -->|"fetch /functions/v1/..."| EF
  App -->|"direct fetch"| TMDB
  App -->|"direct fetch"| GCal
  App -->|"direct fetch"| GTasks
  App -->|"direct fetch"| MetNo
  App -->|"supabase-js (RP5)"| RP5
  EF -->|"GOOGLE_CLIENT_ID"| GCal
  EF -->|"STRAVA_CLIENT_ID"| Strava
  EF -->|"GEMINI_API_KEY (Vault)"| Gemini
  EF -->|"FOOTBALL_API_KEY (Vault)"| FootballAPI
  EF -->|"fetch"| RSS
  EF --> Vault
```

---

## 2. Routes & Features

```mermaid
graph LR
  subgraph Routes["Routes (all protected by SessionGuard)"]
    R0["/#/login\n(public)"]
    R1["/#/home"]
    R2["/#/daily"]
    R3["/#/work"]
    R4["/#/media"]
    R5["/#/training"]
    R6["/#/projects"]
    R7["/#/games"]
    R8["/#/football"]
  end

  subgraph Features["Features"]
    F1["Home\n(widgets dashboard)"]
    F2["Daily\n(schedule + to-do)"]
    F3["Work\n(kanban + widgets)"]
    F4["Media\n(movies + TV)"]
    F5["Training\n(sessions + programs)"]
    F6["Projects\n(phases + items)"]
    F7["Games\n(RP5 library)"]
    F8["Football\n(fixtures — WIP)"]
    FAI["AI Panel\n(Gemini, shared)"]
  end

  R1 --> F1
  R2 --> F2
  R3 --> F3
  R4 --> F4
  R5 --> F5
  R6 --> F6
  R7 --> F7
  R8 --> F8
  F2 & F3 --> FAI
```

---

## 3. Database Schema

```mermaid
erDiagram
  auth_users {
    uuid id PK
  }

  tasks {
    uuid id PK
    uuid user_id FK
    text title
    text domain "personal|work|media"
    text section "inbox|today|this_week|backlog"
    text status "open|in_progress|waiting|done|cancelled"
    text priority "low|medium|high"
    text waiting_for
    date due_date
    int sort_order
    text google_task_id
    text google_calendar_event_id
  }

  time_blocks {
    uuid id PK
    uuid user_id FK
    date date
    time start_time
    text title
    text source_type "task|training_session|movie|tv_episode|calendar|manual"
    uuid source_id FK
    text notes
  }

  schedule_blocks {
    uuid id PK
    uuid user_id FK
    text title
    time start_time
    text days "MON,TUE,..."
    text color
  }

  movies {
    uuid id PK
    int tmdb_id
    text title
    text poster_path
    date release_date
  }

  user_movie_entries {
    uuid id PK
    uuid user_id FK
    uuid movie_id FK
    text status "wishlist|watched|skipped"
    text priority
    date watched_at
  }

  tv_series {
    uuid id PK
    int tmdb_id
    text title
  }

  user_tv_entries {
    uuid id PK
    uuid user_id FK
    uuid tv_series_id FK
    text status
    text priority
  }

  projects {
    uuid id PK
    uuid user_id FK
    text name
    text status
  }

  project_phases {
    uuid id PK
    uuid project_id FK
    text name
    int sort_order
  }

  project_items {
    uuid id PK
    uuid phase_id FK
    text title
    text status
    text type
  }

  train_sessions {
    uuid id PK
    uuid user_id FK
    text workout_type
    date date
    int duration_min
    text strava_id
  }

  train_programs {
    uuid id PK
    uuid user_id FK
    text name
    text description
  }

  train_program_workouts {
    uuid id PK
    uuid program_id FK
    text name
    int day_number
  }

  train_program_exercises {
    uuid id PK
    uuid workout_id FK
    text exercise_name
    int sets
    int min_reps
    int max_reps
  }

  train_exercises {
    uuid id PK
    text name
    text category
    text muscle_group
  }

  train_session_exercises {
    uuid id PK
    uuid session_id FK
    text exercise_name
    jsonb sets_data
  }

  user_transit_stops {
    uuid id PK
    uuid user_id FK
    text stop_id
    text stop_name
    text role "from|to"
  }

  user_transit_routes {
    uuid id PK
    uuid user_id FK
    uuid from_stop_id FK
    uuid to_stop_id FK
    text label
  }

  work_notes {
    uuid id PK
    uuid user_id FK
    text content
  }

  work_pinned_links {
    uuid id PK
    uuid user_id FK
    text title
    text url
    int sort_order
  }

  work_weekly_goals {
    uuid id PK
    uuid user_id FK
    date week_start
    text title
    bool done
  }

  auth_users ||--o{ tasks : owns
  auth_users ||--o{ time_blocks : owns
  auth_users ||--o{ schedule_blocks : owns
  auth_users ||--o{ user_movie_entries : owns
  auth_users ||--o{ user_tv_entries : owns
  auth_users ||--o{ projects : owns
  auth_users ||--o{ train_sessions : owns
  auth_users ||--o{ train_programs : owns
  auth_users ||--o{ work_notes : owns
  auth_users ||--o{ work_pinned_links : owns
  auth_users ||--o{ work_weekly_goals : owns
  movies ||--o{ user_movie_entries : referenced_by
  tv_series ||--o{ user_tv_entries : referenced_by
  projects ||--o{ project_phases : has
  project_phases ||--o{ project_items : has
  train_programs ||--o{ train_program_workouts : has
  train_program_workouts ||--o{ train_program_exercises : has
  train_sessions ||--o{ train_session_exercises : has
```

---

## 4. Edge Functions & External API Calls

```mermaid
flowchart LR
  subgraph Client["Client (Browser)"]
    AI["AI Panel"]
    Cal["Calendar Feature"]
    Tr["Training Feature"]
    Ft["Football Feature"]
    Hn["Home / News Widget"]
  end

  subgraph EF["Edge Functions"]
    ai-proxy
    calendar-oauth
    calendar-token
    calendar-disconnect
    strava-auth
    strava-activities
    strava-disconnect
    football-api
    news-proxy
  end

  subgraph Ext["External APIs"]
    Gemini["Gemini 2.5 Flash"]
    GCalAPI["Google Calendar API"]
    StravaAPI["Strava API"]
    FootballAPI["API-Football"]
    RSS1["VG RSS"]
    RSS2["BBC RSS"]
    RSS3["CNN Türk RSS"]
  end

  AI -->|"POST /ai-proxy"| ai-proxy --> Gemini
  Cal -->|"POST /calendar-oauth\n/calendar-token\n/calendar-disconnect"| calendar-oauth & calendar-token & calendar-disconnect --> GCalAPI
  Tr -->|"POST /strava-auth\n/strava-activities\n/strava-disconnect"| strava-auth & strava-activities & strava-disconnect --> StravaAPI
  Ft -->|"GET /football-api"| football-api --> FootballAPI
  Hn -->|"GET /news-proxy"| news-proxy --> RSS1 & RSS2 & RSS3
```

---

## 5. Daily / Work Data Flow

```mermaid
flowchart TD
  subgraph Work["Work Page"]
    WK["WorkKanban\n(5 cols: Overdue/ToDo/InProgress/Waiting/Done)"]
    WT["WorkTaskCard\n(drag & drop)"]
    HT["HeroTaskWidget\n(focused task)"]
    WG["WeeklyGoalsWidget"]
    WN["QuickNotesWidget"]
    WL["PinnedLinksWidget"]
    ES["EODSummaryWidget"]
  end

  subgraph Daily["Daily Page"]
    DT["DayTimeline\n(time blocks)"]
    TW["ToDoDrawer\n(tasks)"]
    WW["WeekWidget"]
    MW["MonthWidget"]
  end

  subgraph DB["Supabase Tables"]
    T["tasks\n(domain=work)"]
    TB["time_blocks"]
    WNote["work_notes"]
    WGoals["work_weekly_goals"]
    WLinks["work_pinned_links"]
  end

  WK --> WT
  WT -->|"status change\ndelete\nfocus"| T
  HT --> T
  WG --> WGoals
  WN --> WNote
  WL --> WLinks
  ES --> T

  DT --> TB
  TW --> T
  WW & MW --> T & TB

  T -->|"source_id ref"| TB
```

---

## 6. Session Workflow

```mermaid
sequenceDiagram
  participant U as User
  participant CC as Claude Code (web)
  participant GH as GitHub
  participant GHP as GitHub Pages

  U->>CC: Describes task
  CC->>GH: git checkout -b claude/<name>
  CC->>CC: Code changes + npm run build
  CC->>GH: git commit + push
  CC->>GH: Create draft PR
  U->>GH: Review → Mark ready → Merge
  GH->>GHP: GitHub Actions deploy (~1 min)
  GHP-->>U: Live at lasciviens.github.io/Project_Daily
```
