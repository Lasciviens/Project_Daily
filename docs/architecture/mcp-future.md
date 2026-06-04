# MCP Integration — Future Architecture

This document outlines how Model Context Protocol (MCP) servers could be integrated into Lasci's Board in a later phase. Do not implement this in MVP.

## Why Not Now

GitHub Pages is a static host — it cannot run an MCP server. Any MCP layer requires a persistent server process. Adding this in Phase 1 introduces infrastructure complexity before the core product is proven.

## Future Architecture

```
Client (GitHub Pages)
  ↓
Supabase Edge Functions  ← current AI proxy
  ↓
MCP Bridge (future)      ← runs on Cloudflare Workers or a small Node server
  ↓
MCP Servers:
  - supabase-mcp      (DB reads/writes)
  - tmdb-mcp          (media search)
  - calendar-mcp      (Google Calendar)
  - rp5-library-mcp   (game data)
  - web-search-mcp    (Brave/Tavily search)
```

## When to Add MCP

- When AI actions become complex enough that tool orchestration beats one-off API calls
- When AI needs to chain 3+ tools in a single response
- When the Edge Function proxy grows too large to maintain

## Candidate MCP Servers

| Server | Purpose |
|---|---|
| `@supabase/mcp-server` | Direct DB access from AI |
| `@anthropic/tmdb-mcp` | TMDB search + details |
| `brave-search-mcp` | Web search for AI |
| Custom `rp5-library` | Thin wrapper over RP5 Supabase DB |

## Notes

- The AI action confirmation pattern must be preserved even with MCP — AI still proposes, user confirms
- MCP tool definitions should mirror the existing `AIAction` type in `features/ai/types.ts`
- Security review by Guardian agent required before any MCP server is connected
