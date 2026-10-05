-- Pure helpers for the Lasci's Board plugin: no KOReader modules, so they can be
-- tested with plain Lua (scripts/kobo/test-lbcore.lua).
-- SPDX-License-Identifier: AGPL-3.0-or-later

local M = {}

M.LOOKBACK = 86400            -- re-send a day of rows on every sync; the server ignores duplicates
M.BATCH = 2000                -- page events per request
M.MAX_BOOKS = 250             -- books per request
M.FUTURE_SKEW = 300           -- never move the cursor past now + 5 min

--- "file:///mnt/onboard/Books/A%20B.epub" -> "/mnt/onboard/Books/A B.epub"
function M.contentIdToPath(content_id)
    if type(content_id) ~= "string" then return nil end
    local p = content_id:gsub("^file://", "")
    if p:sub(1, 1) ~= "/" then return nil end
    p = p:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)
    return p
end

local BOOK_EXT = { epub = true, pdf = true, cbz = true, fb2 = true, mobi = true, azw3 = true, txt = true, djvu = true }

function M.isBookFile(name)
    if type(name) ~= "string" or name:sub(1, 1) == "." then return false end
    local ext = name:match("%.([%w]+)$")
    return ext ~= nil and BOOK_EXT[ext:lower()] == true
end

--- Nickel ReadStatus (0 unread, 1 reading, 2 finished) -> KOReader-style status.
function M.nickelStatus(v)
    v = tonumber(v)
    if v == 2 then return "complete" end
    if v == 1 then return "reading" end
    return nil
end

--- Next cursor after an acknowledged batch: the batch's newest row, never beyond now + skew.
function M.nextCursor(current, batch_max, now)
    if not batch_max then return current end
    local capped = math.min(batch_max, now + M.FUTURE_SKEW)
    if capped > (current or 0) then return capped end
    return current
end

--- Where reading resumes: a day before the cursor (late flushes, small clock changes).
function M.readFrom(cursor)
    cursor = cursor or 0
    if cursor <= M.LOOKBACK then return 0 end
    return cursor - M.LOOKBACK
end

--- Merge book facts from several sources into one record per md5. Earlier
--- sources win for metadata; later ones only fill gaps. Status/rating/percent
--- from the KOReader sidecar always win over Nickel's.
function M.mergeBook(into, from)
    for k, v in pairs(from) do
        if v ~= nil and v ~= "" then
            if into[k] == nil or into[k] == "" then
                into[k] = v
            elseif from._sidecar and (k == "status" or k == "rating" or k == "percent") then
                into[k] = v
            end
        end
    end
    into._sidecar = into._sidecar or from._sidecar
    return into
end

--- The day key ("2026-10-04") for a local time, used for the once-a-day news.
function M.dayKey(t)
    return os.date("%Y-%m-%d", t)
end

--- True when the morning news is due: not yet today, and it is 05:00 or later.
function M.newsDue(last_day, now)
    local hour = tonumber(os.date("%H", now))
    return hour >= 5 and last_day ~= M.dayKey(now)
end

--- Strips the "_lasci" bookkeeping keys before a book is sent.
function M.cleanBook(b)
    local out = {}
    for k, v in pairs(b) do
        if k:sub(1, 1) ~= "_" then out[k] = v end
    end
    return out
end

-- ── News ─────────────────────────────────────────────────────────────────────

--- A file inside the News Downloader folder (default <data>/news/, or a custom one).
function M.isNewsPath(path, news_dir)
    if type(path) ~= "string" then return false end
    if path:find("/.adds/koreader/news/", 1, true) then return true end
    if type(news_dir) == "string" and news_dir ~= "" then
        local dir = news_dir:gsub("/+$", "") .. "/"
        return path:sub(1, #dir) == dir
    end
    return false
end

-- ── EPUB covers ──────────────────────────────────────────────────────────────

local function attr(tag, name)
    return tag:match("[%s:]" .. name .. '%s*=%s*"([^"]*)"') or tag:match("[%s:]" .. name .. "%s*=%s*'([^']*)'")
end

--- META-INF/container.xml -> the OPF path inside the zip.
function M.opfPathFromContainer(xml)
    if type(xml) ~= "string" then return nil end
    for tag in xml:gmatch("<[%w:]*rootfile%s[^>]*>") do
        local p = attr(tag, "full%-path")
        if p and p ~= "" then return p end
    end
    return nil
end

local IMAGE = { jpg = "image/jpeg", jpeg = "image/jpeg", png = "image/png", gif = "image/gif", webp = "image/webp" }

function M.imageMime(name)
    local ext = type(name) == "string" and name:match("%.([%w]+)$")
    return ext and IMAGE[ext:lower()] or nil
end

--- The cover image href in an OPF: EPUB 3 properties="cover-image", then the
--- EPUB 2 <meta name="cover" content="id">, then an image item called "cover".
function M.coverHrefFromOpf(xml)
    if type(xml) ~= "string" then return nil end
    local items, by_id = {}, {}
    for tag in xml:gmatch("<[%w:]*item%s[^>]*>") do
        local it = { id = attr(tag, "id"), href = attr(tag, "href"), media = attr(tag, "media%-type"), props = attr(tag, "properties") }
        if it.href then
            items[#items + 1] = it
            if it.id then by_id[it.id] = it end
        end
    end
    local function isImage(it) return (it.media and it.media:match("^image/")) or M.imageMime(it.href) end
    for _, it in ipairs(items) do
        if it.props and (" " .. it.props .. " "):find(" cover%-image ") and isImage(it) then return it.href end
    end
    for tag in xml:gmatch("<[%w:]*meta%s[^>]*>") do
        if attr(tag, "name") == "cover" then
            local it = by_id[attr(tag, "content") or ""]
            if it and isImage(it) then return it.href end
        end
    end
    for _, it in ipairs(items) do
        local key = ((it.id or "") .. " " .. it.href):lower()
        if isImage(it) and key:find("cover", 1, true) then return it.href end
    end
    return nil
end

--- An href relative to the OPF -> its path inside the zip ("OEBPS/a/../i.jpg" -> "OEBPS/i.jpg").
function M.resolveZipPath(opf_path, href)
    if type(href) ~= "string" then return nil end
    href = href:gsub("#.*$", ""):gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)
    local base = (opf_path or ""):match("^(.*)/[^/]*$") or ""
    local parts = {}
    for seg in ((base ~= "" and (base .. "/") or "") .. href):gmatch("[^/]+") do
        if seg == ".." then table.remove(parts) elseif seg ~= "." then parts[#parts + 1] = seg end
    end
    return table.concat(parts, "/")
end

-- ── Settings from the app ────────────────────────────────────────────────────

-- Never written from the app, whatever the server sends (bookkeeping and
-- anything that could lock the owner out).
M.SETTING_DENY = {
    device_id = true, lastfile = true, lastdir = true, home_dir = true, quickstart_shown_version = true,
    language = true, dev_mode = true, debug = true, debug_verbose = true, start_with = true,
    plugins_disabled = true, plugins_disable_external = true, ["statistics.is_enabled"] = true,
    screen_dpi = true, http_proxy = true, http_proxy_enabled = true, SSH_port = true, SSH_autostart = true,
    SSH_allow_no_password = true, SSH_key_only_auth = true, end_document_action = true,
    highlight_write_into_pdf = true, document_metadata_folder = true, footer = true, statistics = true,
}

--- How a key is stored: "plain" (a setting), "field" (a.b = field b of
--- setting a), "pt" (pt:key = Project: Title's own config). nil = not a key.
function M.keyKind(key)
    if type(key) ~= "string" or #key > 80 then return nil end
    if key:match("^[%w_]+$") then return "plain" end
    if key:match("^[%w_]+%.[%w_]+$") then return "field" end
    if key:match("^pt:[%w_]+$") then return "pt" end
    return nil
end

-- Generated from the same catalogue as the app (key -> Lua type). Only these keys are ever written.
local ok_allow, ALLOW = pcall(require, "lbsettings")
M.ALLOW = ok_allow and type(ALLOW) == "table" and ALLOW or {}

--- True when the plugin may write this key with this value: the key is in the
--- generated allow-list, not on the deny list, and the value has its type
--- (or is NULL = back to KOReader's default).
function M.settingAllowed(key, value)
    if not M.keyKind(key) or M.SETTING_DENY[key] then return false end
    local want = M.ALLOW[key]
    if not want then return false end
    if value == M.NULL then return true end
    if type(value) ~= want then return false end
    if want == "string" then return #value <= 500 end
    return true
end

-- rapidjson decodes JSON null to a sentinel the plugin passes in; tests use this.
M.NULL = setmetatable({}, { __tostring = function() return "null" end })

local MENU_ID = "^[%w_:%.%-]+$"

--- { list_id = { "a", "b" } } -> Lua source for settings/<side>_menu_order.lua
--- (ids are checked, so nothing but plain ids can reach the file).
function M.menuOrderSource(lists)
    local ids = {}
    for id in pairs(lists or {}) do
        if type(id) == "string" and id:match(MENU_ID) and #id <= 80 then ids[#ids + 1] = id end
    end
    table.sort(ids)
    local out = { "-- Written by Lasci's Board from the app. Delete this file to go back to KOReader's own order.", "return {" }
    for _, id in ipairs(ids) do
        local items = {}
        for _, it in ipairs(lists[id]) do
            if type(it) == "string" and it:match(MENU_ID) and #it <= 80 then items[#items + 1] = string.format("%q", it) end
        end
        out[#out + 1] = string.format("    [%q] = { %s },", id, table.concat(items, ", "))
    end
    out[#out + 1] = "}"
    return table.concat(out, "\n") .. "\n"
end

-- ── Sleep images ─────────────────────────────────────────────────────────────

--- The local file name for an app image: "<id>.<ext>" (ids are uuids).
function M.sleepFileName(img)
    if type(img) ~= "table" or type(img.id) ~= "string" or not img.id:match("^[%x%-]+$") then return nil end
    local ext = (img.ext == "png") and "png" or "jpg"
    return img.id .. "." .. ext
end

--- Which images to download and which local files to delete so the folder
--- holds exactly the app's images. `existing` maps file name -> size.
function M.sleepPlan(existing, images)
    local want, download, delete = {}, {}, {}
    for _, img in ipairs(images or {}) do
        local name = M.sleepFileName(img)
        if name then
            want[name] = true
            if existing[name] == nil or (tonumber(img.size) and existing[name] ~= tonumber(img.size)) then
                download[#download + 1] = { name = name, url = img.url, size = tonumber(img.size), id = img.id }
            end
        end
    end
    for name in pairs(existing or {}) do
        if not want[name] and name:match("^[%x%-]+%.%a+$") then delete[#delete + 1] = name end
    end
    table.sort(delete)
    return download, delete
end

-- ── Reading goal and streak (for the status bar) ─────────────────────────────

--- Days in a row with at least `min_minutes`, ending today (or yesterday when
--- today has not reached it yet). `minutes` maps "YYYY-MM-DD" -> minutes.
function M.streak(minutes, today_t, min_minutes)
    min_minutes = math.max(1, min_minutes or 1)
    local function key(t) return os.date("%Y-%m-%d", t) end
    -- Step by calendar day at noon, so a DST change never skips or repeats one.
    local function prev(t)
        local d = os.date("*t", t)
        return os.time({ year = d.year, month = d.month, day = d.day - 1, hour = 12 })
    end
    local t0 = os.date("*t", today_t)
    local day = os.time({ year = t0.year, month = t0.month, day = t0.day, hour = 12 })
    local n = 0
    if (minutes[key(day)] or 0) < min_minutes then day = prev(day) end
    for _ = 1, 3650 do
        if (minutes[key(day)] or 0) < min_minutes then break end
        n = n + 1
        day = prev(day)
    end
    return n
end

--- "18/30 min · 12 days" (or "Goal met · 31/30 min · 12 days").
function M.footerText(today_minutes, goal, streak)
    local text = string.format("%d/%d min", today_minutes, goal)
    if goal > 0 and today_minutes >= goal then text = "Goal met · " .. text end
    if streak and streak > 0 then text = text .. string.format(" · %d %s", streak, streak == 1 and "day" or "days") end
    return text
end

--- A capture id that is unique enough on one device: time + random.
function M.newId(now, rand)
    return string.format("kobo-%x-%06x", now, rand)
end

return M
