--[[--
What the app tells the Kobo to change (docs/kobo/PLAN.md, round 2):
statuses and ratings set in the app, KOReader settings, the menu order and
the sleep screen images. Plus the report the app shows back (current values
and the menus). Every write here is checked by lbcore first.

SPDX-License-Identifier: AGPL-3.0-or-later
--]]--

local DataStorage = require("datastorage")
local DocSettings = require("docsettings")
local filemanagerutil = require("apps/filemanager/filemanagerutil")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")

local core = require("lbcore")

local M = {}

M.SLEEP_DIR = DataStorage:getFullDataDir() .. "/lascisboard-sleep"

-- ── Statuses and ratings from the app ───────────────────────────────────────

--- Writes each push into the book's sidecar (KOReader's own helper), skipping
--- the book that is open right now (its in-memory settings would overwrite the
--- file on close; it is pushed again next sync). Returns what was written.
function M.applyPushes(pushes, open_file)
    local done = {}
    local ok_booklist, BookList = pcall(require, "ui/widget/booklist")
    for _, p in ipairs(pushes or {}) do
        local path = type(p.path) == "string" and p.path or nil
        if path and path ~= open_file and lfs.attributes(path, "mode") == "file"
                and (p.status or p.rating) then
            local ok, err = pcall(function()
                local ds = DocSettings:open(path)
                local summary = ds:readSetting("summary") or {}
                local wrote = {}
                if p.status == "reading" or p.status == "complete" or p.status == "abandoned" then
                    summary.status = p.status
                    wrote.status = p.status
                end
                local r = tonumber(p.rating)
                if r and r >= 1 and r <= 5 then
                    summary.rating = math.floor(r + 0.5)
                    wrote.rating = summary.rating
                end
                if wrote.status or wrote.rating then
                    filemanagerutil.saveSummary(ds, summary)
                    if ok_booklist and BookList.setBookInfoCacheProperty then
                        if wrote.status then BookList.setBookInfoCacheProperty(path, "status", wrote.status) end
                        if wrote.rating then BookList.setBookInfoCacheProperty(path, "rating", wrote.rating) end
                    end
                    done[#done + 1] = { md5 = p.md5, status = wrote.status, rating = wrote.rating }
                end
            end)
            if not ok then logger.warn("LascisBoard: status push failed", path, err) end
        end
    end
    return done
end

-- ── Settings ────────────────────────────────────────────────────────────────

local PT_DB = DataStorage:getSettingsDir() .. "/PT_bookinfo_cache.sqlite3"

--- Project: Title keeps its settings in its own SQLite table config(key, value):
--- true is "Y", false is a NULL value, numbers are text. Read on its next start.
local function writeProjectTitle(pairs_list)
    if #pairs_list == 0 or lfs.attributes(PT_DB, "mode") ~= "file" then return false end
    local SQ3 = require("lua-ljsqlite3/init")
    local ok, err = pcall(function()
        local conn = SQ3.open(PT_DB)
        conn:exec("PRAGMA busy_timeout = 3000;")
        local stmt = conn:prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?);")
        for _, kv in ipairs(pairs_list) do
            local v = kv[2]
            if v == core.NULL or v == false then v = nil elseif v == true then v = "Y" else v = tostring(v) end
            stmt:reset():bind(kv[1], v):step()
        end
        stmt:close()
        conn:close()
    end)
    if not ok then logger.warn("LascisBoard: Project: Title settings failed", err) end
    return ok
end

local function readProjectTitle(keys)
    local out = {}
    if #keys == 0 or lfs.attributes(PT_DB, "mode") ~= "file" then return out end
    local SQ3 = require("lua-ljsqlite3/init")
    pcall(function()
        local conn = SQ3.open(PT_DB, "ro")
        local stmt = conn:prepare("SELECT key, value FROM config")
        local want = {}
        for _, k in ipairs(keys) do want[k] = true end
        for row in stmt:rows() do
            local k, v = row[1], row[2]
            if want[k] then
                if v == "Y" then out[k] = true elseif v == nil then out[k] = false else out[k] = tonumber(v) or v end
            end
        end
        stmt:close()
        conn:close()
    end)
    return out
end

--- Writes the app's settings into G_reader_settings (a.b = one field of the
--- table setting a) or Project: Title's config. null = back to KOReader's default.
function M.applySettings(settings, null)
    local applied, refused, pt = {}, {}, {}
    for key, value in pairs(settings or {}) do
        local v = (value == null) and core.NULL or value
        local kind = core.keyKind(key)
        if not core.settingAllowed(key, v) then
            refused[key] = "not allowed on the device"
        elseif kind == "pt" then
            pt[#pt + 1] = { key:sub(4), v }
        elseif kind == "field" then
            local name, field = key:match("^([%w_]+)%.([%w_]+)$")
            local t = G_reader_settings:readSetting(name)
            -- A table that does not exist yet would be created without the
            -- plugin's own defaults (e.g. statistics without is_enabled):
            -- leave it until KOReader has made it.
            if type(t) ~= "table" then
                refused[key] = "not on the Kobo yet — open that part of KOReader once"
            else
                if v == core.NULL then t[field] = nil else t[field] = v end
                G_reader_settings:saveSetting(name, t)
                applied[#applied + 1] = key
            end
        elseif type(G_reader_settings:readSetting(key)) == "table" then
            refused[key] = "this setting is a list on the Kobo"
        else
            if v == core.NULL then G_reader_settings:delSetting(key) else G_reader_settings:saveSetting(key, v) end
            applied[#applied + 1] = key
        end
    end
    if #pt > 0 then
        if writeProjectTitle(pt) then
            for _, kv in ipairs(pt) do applied[#applied + 1] = "pt:" .. kv[1] end
        else
            for _, kv in ipairs(pt) do refused["pt:" .. kv[1]] = "Project: Title is not installed" end
        end
    end
    return applied, refused
end

-- ── Sleep images ────────────────────────────────────────────────────────────

--- Makes the plugin's sleep folder hold exactly the app's images, then points
--- KOReader at it (random image folder, or the one picked image).
function M.syncSleepImages(sleep, download)
    if type(sleep) ~= "table" then return { downloaded = 0, deleted = 0 } end
    util.makePath(M.SLEEP_DIR)
    local existing = {}
    for name in lfs.dir(M.SLEEP_DIR) do
        if name ~= "." and name ~= ".." then
            existing[name] = lfs.attributes(M.SLEEP_DIR .. "/" .. name, "size")
        end
    end
    local to_get, to_delete = core.sleepPlan(existing, sleep.images)
    local result = { downloaded = 0, deleted = 0, failed = 0 }
    for _, item in ipairs(to_get) do
        local target = M.SLEEP_DIR .. "/" .. item.name
        local part = target .. ".part"
        local code = download(item.url, part)
        local size = lfs.attributes(part, "size")
        if code == 200 and size and (not item.size or size == item.size) then
            os.rename(part, target)
            result.downloaded = result.downloaded + 1
        else
            os.remove(part)
            result.failed = result.failed + 1
        end
    end
    for _, name in ipairs(to_delete) do
        os.remove(M.SLEEP_DIR .. "/" .. name)
        result.deleted = result.deleted + 1
    end
    if #(sleep.images or {}) > 0 then
        G_reader_settings:saveSetting("screensaver_dir", M.SLEEP_DIR)
    end
    local picked
    for _, img in ipairs(sleep.images or {}) do
        if img.id == sleep.selected then picked = core.sleepFileName(img) end
    end
    if picked and lfs.attributes(M.SLEEP_DIR .. "/" .. picked, "mode") == "file" then
        G_reader_settings:saveSetting("screensaver_document_cover", M.SLEEP_DIR .. "/" .. picked)
    end
    return result
end

-- ── Menu order ──────────────────────────────────────────────────────────────

local function orderFile(side)
    return DataStorage:getSettingsDir() .. "/" .. side .. "_menu_order.lua"
end

--- Writes (or removes) settings/<side>_menu_order.lua. Returns true when the file changed.
function M.writeMenuOrder(side, lists)
    local path = orderFile(side)
    local has = type(lists) == "table" and next(lists) ~= nil
    local before
    local fh = io.open(path, "r")
    if fh then before = fh:read("*a"); fh:close() end
    if not has then
        if before then os.remove(path); return true end
        return false
    end
    local src = core.menuOrderSource(lists)
    if src == before then return false end
    local out = io.open(path, "w")
    if not out then return false end
    out:write(src)
    out:close()
    return true
end

--- Puts Lasci's Board first in the tools tab, unless the owner placed it
--- somewhere through the app (the user order file then names it).
function M.placeMenuEntry(side)
    local ok, order = pcall(require, side == "reader" and "ui/elements/reader_menu_order" or "ui/elements/filemanager_menu_order")
    if not ok or type(order) ~= "table" or type(order.tools) ~= "table" then return end
    local fh = io.open(orderFile(side), "r")
    if fh then
        local text = fh:read("*a")
        fh:close()
        if text:find('"lascisboard"', 1, true) then return end
    end
    for _, id in ipairs(order.tools) do
        if id == "lascisboard" then return end
    end
    table.insert(order.tools, 1, "lascisboard")
end

-- ── The report the app shows back ───────────────────────────────────────────

local function scalar(v)
    local t = type(v)
    return t == "boolean" or t == "number" or (t == "string" and #v <= 500)
end

--- Current values of the keys the app asks about (absent keys are left out).
function M.settingsReport(keys)
    local out, pt = {}, {}
    for _, k in ipairs(keys or {}) do
        local kind = core.keyKind(k)
        if kind == "plain" then
            local v = G_reader_settings:readSetting(k)
            if scalar(v) then out[k] = v end
        elseif kind == "field" then
            local name, field = k:match("^([%w_]+)%.([%w_]+)$")
            local t = G_reader_settings:readSetting(name)
            if type(t) == "table" and scalar(t[field]) then out[k] = t[field] end
        elseif kind == "pt" then
            pt[#pt + 1] = k:sub(4)
        end
    end
    for k, v in pairs(readProjectTitle(pt)) do out["pt:" .. k] = v end
    return out
end

--- The menu as KOReader builds it now: every list and every item's label.
--- `complete` is true only when the whole menu was built (a reader menu needs
--- its book still open: building it after the book closed fails half way).
function M.menuReport(ui, side)
    local menu = ui and ui.menu
    if not menu then return nil end
    -- Build the menu the way opening it does (onShowMenu builds it once, lazily):
    -- before that, menu_items holds only the few items the menu adds itself, so a
    -- report taken then named almost nothing (plugin 1.1's reader report).
    if not menu.tab_item_table then
        pcall(menu.setUpdateItemTable, menu)
    end
    local ok, order = pcall(require, side == "reader" and "ui/elements/reader_menu_order" or "ui/elements/filemanager_menu_order")
    if not ok or type(order) ~= "table" then return nil end
    local lists, labels = {}, {}
    for id, list in pairs(order) do
        if type(id) == "string" and type(list) == "table" then
            local items = {}
            for _, it in ipairs(list) do
                if type(it) == "string" then items[#items + 1] = it end
            end
            lists[id] = items
        end
    end
    for id, item in pairs(menu.menu_items or {}) do
        if type(id) == "string" and type(item) == "table" then
            local text = item.text
            if not text and type(item.text_func) == "function" then
                local okt, t = pcall(item.text_func)
                if okt then text = t end
            end
            if type(text) == "string" then labels[id] = text:sub(1, 120) end
        end
    end
    return { order = lists, labels = labels, complete = menu.tab_item_table ~= nil }
end

return M
