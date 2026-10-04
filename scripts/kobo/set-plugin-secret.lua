-- Stores the Lasci's Board device secret (KOBO_SYNC_SECRET) in the plugin's own
-- settings file, so nobody types 64 characters on the Kobo. Runs ON THE KOBO:
--   printf '%s' "$SECRET" | ssh kobo 'cd /mnt/onboard/.adds/koreader && ./luajit /tmp/set-plugin-secret.lua'
-- The secret arrives on stdin and is never printed. Other keys are kept.
-- SPDX-License-Identifier: AGPL-3.0-or-later

local FILE = "settings/lascisboard.lua"
local secret = (io.read("*a") or ""):gsub("%s", "")
if #secret < 32 or not secret:match("^[%w%-_]+$") then
  io.stderr:write("No valid secret on stdin - nothing changed.\n")
  os.exit(1)
end

local ok, data = pcall(dofile, FILE)
if not ok or type(data) ~= "table" then data = {} end
data.secret = secret

local function serialize(v, indent)
  local t = type(v)
  if t == "string" then return string.format("%q", v) end
  if t == "number" or t == "boolean" then return tostring(v) end
  if t ~= "table" then return "nil" end
  local inner = indent .. "    "
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
  out[#out + 1] = indent .. "}"
  return table.concat(out)
end

local tmp = FILE .. ".new"
local f = assert(io.open(tmp, "w"))
f:write("-- we can read Lua syntax here!\nreturn ", serialize(data, ""), "\n")
f:close()
local ok2, back = pcall(dofile, tmp)
if not ok2 or type(back) ~= "table" or back.secret ~= secret then
  os.remove(tmp)
  io.stderr:write("New settings did not read back - nothing changed.\n")
  os.exit(1)
end
assert(os.rename(tmp, FILE))
print("Device secret stored (" .. #secret .. " characters).")
