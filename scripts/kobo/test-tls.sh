#!/bin/sh
# Checks the Kobo plugin's server-certificate check (security audit 10.10.2026)
# with the same LuaSec the Kobo runs (1.3.2): a local CA, three local TLS
# servers (valid / self-signed / wrong name), and the plugin's real
# verifiedCreate() from main.lua. Needs lua5.1, lua-sec, lua-socket, openssl.
#   sh scripts/kobo/test-tls.sh
set -e
W=$(mktemp -d)
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null || true; done; rm -rf "$W"; }
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$W/ca.key" -out "$W/ca.crt" -days 2 -subj "/CN=Test CA" 2>/dev/null
mk() {
  openssl req -newkey rsa:2048 -nodes -keyout "$W/$1.key" -out "$W/$1.csr" -subj "/CN=$2" 2>/dev/null
  printf "subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\n" "$2" > "$W/$1.ext"
  openssl x509 -req -in "$W/$1.csr" -CA "$W/ca.crt" -CAkey "$W/ca.key" -CAcreateserial -out "$W/$1.crt" -days 2 -extfile "$W/$1.ext" 2>/dev/null
}
mk good localhost
mk wrong other.test
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$W/self.key" -out "$W/self.crt" -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" 2>/dev/null
serve() { openssl s_server -accept "$1" -cert "$W/$2.crt" -key "$W/$2.key" -www -quiet >/dev/null 2>&1 & PIDS="$PIDS $!"; }
serve 18443 good
serve 18444 wrong
serve 18445 self
sleep 1

lua5.1 - "$W" <<'LUA'
local W = arg[1]
package.path = "scripts/kobo/lascisboard.koplugin/?.lua;" .. package.path
local core = require("lbcore")
local src = assert(io.open("scripts/kobo/lascisboard.koplugin/main.lua")):read("*a")
local fn = src:match("(local function verifiedCreate%(url_host%).-\nend)\n\nlocal function request")
assert(fn, "verifiedCreate not found in main.lua")
local chunk = assert(loadstring(fn .. "\nreturn verifiedCreate"))
setfenv(chunk, setmetatable({ core = core, CA_BUNDLE = W .. "/ca.crt" }, { __index = _G }))
local verifiedCreate = chunk()
local http = require("socket.http")
local function get(port)
  local ok, r, code = pcall(function()
    return http.request({ url = "https://localhost:" .. port .. "/", sink = function() return 1 end, create = verifiedCreate("localhost") })
  end)
  return ok and r == 1 and code == 200, tostring(code)
end
local n, bad = 0, 0
local function check(name, cond) n = n + 1; if cond then print("  ✓ " .. name) else bad = bad + 1; print("  ✗ " .. name) end end
check("valid certificate for the host: connects", (get(18443)))
local ok2, e2 = get(18445); check("self-signed certificate: refused", not ok2 and e2:find("verify failed") ~= nil)
local ok3, e3 = get(18444); check("certificate for another name: refused", not ok3 and e3:find("not issued for") ~= nil)
print(("test-tls: %d passed, %d failed"):format(n - bad, bad))
os.exit(bad == 0 and 0 or 1)
LUA
