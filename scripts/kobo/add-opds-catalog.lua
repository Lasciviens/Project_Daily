-- Adds (or updates) the "Lasci's Board" Send to Kobo catalogue in KOReader's
-- OPDS settings, so nobody has to type a 90-character address on the Kobo.
-- Runs ON THE KOBO with KOReader's own luajit (docs/kobo/PLAN.md, Phase 2):
--
--   printf '%s' "$TOKEN" | ssh kobo 'cd /mnt/onboard/.adds/koreader && ./luajit /tmp/add-opds-catalog.lua'
--
-- The token arrives on stdin, never on a command line or in output.
-- KOReader reads settings/opds.lua the first time the OPDS catalog is opened
-- and only writes it back after an OPDS change, so run this in a fresh
-- KOReader session BEFORE opening OPDS catalog (or restart KOReader after).
-- Other catalogues, downloads and settings are kept as they are.

local BASE = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/kobo-sync/opds/"
local TITLE = "Lasci's Board"
local SYNC_DIR = "/mnt/onboard/Send to Kobo"
local FILE = "settings/opds.lua"

local token = (io.read("*a") or ""):gsub("%s", "")
if #token < 32 or not token:match("^[%w%-_]+$") then
  io.stderr:write("No valid token on stdin - nothing changed.\n")
  os.exit(1)
end

local DEFAULT_SERVERS = {
  { title = "Project Gutenberg", url = "https://m.gutenberg.org/ebooks.opds/?format=opds" },
  { title = "Standard Ebooks", url = "https://standardebooks.org/feeds/opds" },
  { title = "ManyBooks", url = "http://manybooks.net/opds/index.php" },
  { title = "Internet Archive", url = "https://bookserver.archive.org/" },
  { title = "textos.info (Spanish)", url = "https://www.textos.info/catalogo.atom" },
  { title = "Gallica (French)", url = "https://gallica.bnf.fr/opds" },
}

local ok, data = pcall(dofile, FILE)
if not ok or type(data) ~= "table" then data = {} end
data.servers = data.servers or DEFAULT_SERVERS
data.settings = data.settings or {}

local entry = { title = TITLE, url = BASE .. token .. "/", sync = true }
local replaced = false
for i, s in ipairs(data.servers) do
  if type(s) == "table" and (s.title == TITLE or (s.url or ""):find("/kobo-sync/opds/", 1, true)) then
    data.servers[i] = entry
    replaced = true
  end
end
if not replaced then table.insert(data.servers, entry) end
local sync_dir_set = false
if not data.settings.sync_dir then
  data.settings.sync_dir = SYNC_DIR
  sync_dir_set = true
end

local function serialize(v, indent)
  local t = type(v)
  if t == "string" then return string.format("%q", v) end
  if t == "number" or t == "boolean" then return tostring(v) end
  if t ~= "table" then return "nil" end
  local pad, inner = indent, indent .. "    "
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b)
    if type(a) == type(b) then return a < b end
    return type(a) == "number"
  end)
  local out = { "{\n" }
  for _, k in ipairs(keys) do
    local key = type(k) == "number" and ("[" .. k .. "]") or ("[" .. string.format("%q", k) .. "]")
    out[#out + 1] = inner .. key .. " = " .. serialize(v[k], inner) .. ",\n"
  end
  out[#out + 1] = pad .. "}"
  return table.concat(out)
end

local tmp = FILE .. ".new"
local f = assert(io.open(tmp, "w"))
f:write("-- we can read Lua syntax here!\nreturn ", serialize(data, ""), "\n")
f:close()
-- Check the new file reads back before replacing the old one.
local ok2, back = pcall(dofile, tmp)
if not ok2 or type(back) ~= "table" or not back.servers then
  os.remove(tmp)
  io.stderr:write("New settings did not read back - nothing changed.\n")
  os.exit(1)
end
assert(os.rename(tmp, FILE))
print((replaced and "Updated" or "Added") .. " catalog: " .. TITLE)
print("Catalogs: " .. #back.servers)
print(sync_dir_set and ("Sync folder set: " .. SYNC_DIR) or ("Sync folder kept: " .. tostring(back.settings.sync_dir)))
