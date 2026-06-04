# Lasci's Board

A personal productivity and entertainment dashboard. Built with React, Supabase, and a collection of integrations for media tracking, calendar, and AI assistance.

## Pages
- **Daily** — Today, Tomorrow, This Week, This Month
- **Media** — Films, Shows, Games tracking with TMDB integration
- **Work** — Task management for Power work

## Agents
This project uses specialized Claude Code sub-agents:
- **Guardian** — Security, RLS, auth, and API key safety
- **Flex** — Mobile responsiveness and layout optimization

See `.claude/agents/` for agent definitions and `CLAUDE.md` for full project documentation.

## Setup
1. Clone the repository
2. Copy `.env.example` to `.env.local` and fill in the values
3. Configure Supabase Edge Function secrets (see `CLAUDE.md`)
4. `npm install && npm run dev`

## Tech Stack
React · TypeScript · Vite · Tailwind CSS · Supabase · GitHub Pages
