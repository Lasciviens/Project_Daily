--[[--
The smaller extras (docs/kobo/PLAN.md, round 2):
  * a book's own cover, read from inside the EPUB, for the app;
  * today's minutes against the app's goal + the streak, in the status bar;
  * capture: a note typed on the Kobo becomes a task, a wish or a book in the app;
  * ask: a question about the selected passage, answered by the app's AI.

SPDX-License-Identifier: AGPL-3.0-or-later
--]]--

local DataStorage = require("datastorage")
local LuaSettings = require("luasettings")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")

local core = require("lbcore")

local M = {}

M.COVER_MAX = 400 * 1024

-- ── Covers ──────────────────────────────────────────────────────────────────

--- The EPUB's own cover image: (bytes, mime) or nil. Reads only the container,
--- the OPF and the image — never renders the book.
function M.epubCover(path)
    if type(path) ~= "string" or not path:lower():match("%.epub$") then return nil end
    local ok_arc, Archiver = pcall(require, "ffi/archiver")
    if not ok_arc then return nil end
    local arc = Archiver.Reader:new()
    if not arc:open(path) then return nil end
    local ok, bytes, mime = pcall(function()
        for _ in arc:iterate() do end -- index every entry once
        local opf_path = core.opfPathFromContainer(arc:extractToMemory("META-INF/container.xml"))
        if not opf_path then return nil end
        local href = core.coverHrefFromOpf(arc:extractToMemory(opf_path))
        local inner = href and core.resolveZipPath(opf_path, href)
        local entry = inner and arc.entries and arc.entries[inner]
        local m = inner and core.imageMime(inner)
        if not entry or not m or (entry.size or 0) <= 0 or entry.size > M.COVER_MAX then return nil end
        return arc:extractToMemory(inner), m
    end)
    arc:close()
    if not ok then logger.warn("LascisBoard: cover read failed", path, bytes) return nil end
    return bytes, mime
end

-- ── Status bar: goal and streak ─────────────────────────────────────────────

local cache = { at = 0, text = nil, streak_day = nil, past = nil }

--- Minutes per local day since `from`, summed by SQLite (in the device's own time zone).
local function minutesByDay(from)
    local path = DataStorage:getSettingsDir() .. "/statistics.sqlite3"
    if lfs.attributes(path, "mode") ~= "file" then return {} end
    local SQ3 = require("lua-ljsqlite3/init")
    local ok, conn = pcall(SQ3.open, path, "ro")
    if not ok then return {} end
    local minutes = {}
    pcall(function()
        local stmt = conn:prepare("SELECT date(start_time, 'unixepoch', 'localtime'), sum(duration) FROM page_stat_data WHERE start_time >= ? GROUP BY 1")
        stmt:bind(from)
        for row in stmt:rows() do
            minutes[row[1]] = math.floor((tonumber(row[2]) or 0) / 60)
        end
        stmt:close()
    end)
    conn:close()
    return minutes
end

--- The status bar text, recomputed at most once a minute (it is asked on every
--- page turn). The days before today are read once a day; today adds the open
--- book's time KOReader has not written to its database yet.
function M.footerText(goal, statistics)
    local now = os.time()
    if cache.text and now - cache.at < 60 and cache.goal == goal.goal_minutes then return cache.text end
    local today_key = os.date("%Y-%m-%d", now)
    local t = os.date("*t", now)
    local midnight = os.time({ year = t.year, month = t.month, day = t.day, hour = 0 })
    if cache.streak_day ~= today_key then
        cache.past = minutesByDay(midnight - 400 * 86400)
        cache.streak_day = today_key
    end
    local minutes = {}
    for k, v in pairs(cache.past or {}) do minutes[k] = v end
    minutes[today_key] = minutesByDay(midnight)[today_key] or 0
    local pending = statistics and tonumber(statistics.mem_read_time) or 0
    minutes[today_key] = minutes[today_key] + math.floor(pending / 60)
    cache.text = core.footerText(minutes[today_key], goal.goal_minutes or 20, core.streak(minutes, now, goal.min_minutes or 1))
    cache.at, cache.goal = now, goal.goal_minutes
    return cache.text
end

function M.resetFooterCache() cache.at = 0 end

-- ── Capture outbox ──────────────────────────────────────────────────────────
-- Notes wait in settings/lascisboard_outbox.lua until a sync sends them, so
-- writing one never needs Wi-Fi.

local outbox_file = DataStorage:getSettingsDir() .. "/lascisboard_outbox.lua"

function M.outbox()
    return LuaSettings:open(outbox_file):readSetting("items") or {}
end

function M.addCapture(kind, text, note, book)
    local s = LuaSettings:open(outbox_file)
    local items = s:readSetting("items") or {}
    items[#items + 1] = { id = core.newId(os.time(), math.random(0, 0xFFFFFF)), kind = kind, text = text, note = note, book = book }
    s:saveSetting("items", items)
    s:flush()
    return #items
end

--- Drops the captures the server confirmed.
function M.removeCaptures(done_ids)
    local done = {}
    for _, id in ipairs(done_ids or {}) do done[id] = true end
    local s = LuaSettings:open(outbox_file)
    local keep = {}
    for _, it in ipairs(s:readSetting("items") or {}) do
        if not done[it.id] then keep[#keep + 1] = it end
    end
    s:saveSetting("items", keep)
    s:flush()
    return #keep
end

return M
