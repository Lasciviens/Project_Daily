// Shared helper for reading the JSON body off a Supabase Edge Function error
// (FunctionsHttpError carries the raw Response in `.context`) — was
// independently duplicated in aiApi.ts and calendarApi.ts.
export async function parseFunctionErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (error as any).context?.json?.() ?? null
  } catch {
    return null
  }
}
