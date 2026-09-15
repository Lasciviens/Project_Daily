// Stub for verify-psn-playtime.cjs — psnApi.ts imports the live Supabase
// client, which can't be constructed in a throwaway script. The function
// under test never touches it.
module.exports = { supabase: { functions: { invoke: () => { throw new Error('not used') } } } }
