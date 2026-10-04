--[[--
Lasci's Board for KOReader (docs/kobo/PLAN.md, Phase 4).

What it does, all by itself whenever Wi-Fi comes on (NetworkConnected):
  * sends new reading-statistics rows (KOReader's page_stat_data) and the
    books they belong to, from a cursor, in batches; the cursor only moves
    after the server answers 2xx, so statistics.sqlite3 itself is the outbox;
  * once a day sends the whole library (Nickel's database + KOReader's
    statistics + the history's sidecars) so unopened books appear too;
  * downloads the books waiting in the app's Send to Kobo inbox;
  * once a day (from 05:00) runs the News downloader's sync.

It never turns Wi-Fi on by itself and never runs network code on suspend
(PLAN §3.0). Turn on "Restore Wi-Fi connection on resume" and "Disable Wi-Fi
connection when inactive" in KOReader's network menu for zero-tap syncs.

SPDX-License-Identifier: AGPL-3.0-or-later
--]]--

local DataStorage = require("datastorage")
local Device = require("device")
local Dispatcher = require("dispatcher")
local DocSettings = require("docsettings")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local Notification = require("ui/widget/notification")
local ReadHistory = require("readhistory")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local filemanagerutil = require("apps/filemanager/filemanagerutil")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local _ = require("gettext")
local T = require("ffi/util").template

local core = require("lbcore")

local VERSION = "1.0.0"
local DEFAULT_SERVER = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/kobo-sync"
local NICKEL_DB = "/mnt/onboard/.kobo/KoboReader.sqlite"
local DEFAULT_INBOX = "/mnt/onboard/Send to Kobo"
local AUTO_MIN_GAP = 600 -- seconds between two automatic runs

-- Shared by every plugin instance (FileManager and Reader each make one).
local state = {
    running = false,
    last_auto = 0,
}

local settings_file = DataStorage:getSettingsDir() .. "/lascisboard.lua"
local function openSettings()
    return LuaSettings:open(settings_file)
end

local LascisBoard = WidgetContainer:extend{
    name = "lascisboard",
    is_doc_only = false,
}

function LascisBoard:init()
    Dispatcher:registerAction("lascisboard_sync", {
        category = "none", event = "LascisBoardSync", title = _("Lasci's Board: sync now"), general = true,
    })
    self.ui.menu:registerToMainMenu(self)
    -- Already online when KOReader starts (or the reader opens): catch up.
    if NetworkMgr:isOnline() then
        UIManager:scheduleIn(8, function() self:runAuto("start") end)
    end
end

-- ── Settings helpers ─────────────────────────────────────────────────────────

-- Settings are re-read on every use: the file browser and the reader each hold
-- an instance of this plugin, and a cached copy in one would overwrite what the
-- other saved (the cursor, the secret).
function LascisBoard:conf()
    return openSettings()
end

function LascisBoard:server()
    local s = self:conf():readSetting("server_url")
    if type(s) == "string" and s:match("^https://") then return (s:gsub("/+$", "")) end
    return DEFAULT_SERVER
end

function LascisBoard:secret()
    local s = self:conf():readSetting("secret")
    if type(s) == "string" and #s >= 16 then return s end
    return nil
end

function LascisBoard:isOn(key)
    return self:conf():nilOrTrue(key)
end

function LascisBoard:inboxDir()
    local dir = self:conf():readSetting("inbox_dir")
    if type(dir) == "string" and dir ~= "" then return dir end
    return DEFAULT_INBOX
end

function LascisBoard:save(key, value)
    local s = openSettings()
    if value == nil then s:delSetting(key) else s:saveSetting(key, value) end
    s:flush()
end

-- ── HTTP ─────────────────────────────────────────────────────────────────────

local function request(method, url, headers, body, sink_file)
    local http = require("socket.http")
    local ltn12 = require("ltn12")
    local socket = require("socket")
    local socketutil = require("socketutil")
    local chunks = {}
    local req = { method = method, url = url, headers = headers or {} }
    if body then
        req.source = ltn12.source.string(body)
        req.headers["Content-Length"] = tostring(#body)
    end
    local fh
    if sink_file then
        fh = io.open(sink_file, "wb")
        if not fh then return nil, "cannot write " .. sink_file end
        req.sink = ltn12.sink.file(fh)
        socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, 300)
    else
        req.sink = ltn12.sink.table(chunks)
        socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    end
    local code, resp_headers, status = socket.skip(1, http.request(req))
    socketutil:reset_timeout()
    if resp_headers == nil then
        return nil, "network error: " .. tostring(status or code)
    end
    return tonumber(code), table.concat(chunks)
end

function LascisBoard:callJson(method, path, payload)
    local rapidjson = require("rapidjson")
    local headers = {
        ["x-kobo-secret"] = self:secret(),
        ["x-kobo-device"] = G_reader_settings:readSetting("device_id") or "",
        ["Accept"] = "application/json",
    }
    local body
    if payload then
        body = rapidjson.encode(payload)
        headers["Content-Type"] = "application/json"
    end
    local code, text = request(method, self:server() .. path, headers, body)
    if not code then return nil, text end
    local ok, decoded = pcall(rapidjson.decode, text or "")
    if not ok then decoded = nil end
    if code < 200 or code >= 300 then
        local msg = type(decoded) == "table" and (decoded.message or decoded.error) or ("HTTP " .. code)
        return nil, tostring(msg), code
    end
    return decoded or {}, nil, code
end

-- ── Reading the device ───────────────────────────────────────────────────────

local function num(v)
    if v == nil then return nil end
    return tonumber(v)
end

local function openDb(path)
    local SQ3 = require("lua-ljsqlite3/init")
    if lfs.attributes(path, "mode") ~= "file" then return nil end
    local ok, conn = pcall(SQ3.open, path, "ro")
    if not ok then
        logger.warn("LascisBoard: cannot open", path, conn)
        return nil
    end
    return conn
end

--- KOReader's statistics book table: id -> book facts.
local function statsBooks(conn)
    local books = {}
    local stmt = conn:prepare("SELECT id, title, authors, series, language, md5, pages, last_open, total_read_time, total_read_pages FROM book")
    for row in stmt:rows() do
        local md5 = row[6]
        if type(md5) == "string" and md5:match("^%x+$") and #md5 == 32 then
            books[num(row[1])] = {
                md5 = md5:lower(), title = row[2], authors = row[3], series = row[4], language = row[5],
                pages = num(row[7]), last_open = num(row[8]), read_time = num(row[9]), read_pages = num(row[10]),
            }
        end
    end
    stmt:close()
    return books
end

--- Page events newer than `from`, oldest first, at most `limit`.
local function statsRows(conn, from, limit)
    local rows = {}
    local stmt = conn:prepare("SELECT id_book, page, start_time, duration, total_pages FROM page_stat_data WHERE start_time > ? ORDER BY start_time ASC LIMIT ?")
    stmt:bind(from, limit)
    for row in stmt:rows() do
        rows[#rows + 1] = { num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]) }
    end
    stmt:close()
    return rows
end

--- A book's sidecar: status, rating, percent, its md5 and doc props.
local function sidecarFacts(path)
    if not DocSettings:hasSidecarFile(path) then return nil end
    local ok, ds = pcall(DocSettings.open, DocSettings, path)
    if not ok or not ds then return nil end
    local summary = ds:readSetting("summary") or {}
    local props = ds:readSetting("doc_props") or {}
    local md5 = ds:readSetting("partial_md5_checksum")
    return {
        md5 = type(md5) == "string" and md5:lower() or nil,
        title = props.title, authors = props.authors, series = props.series,
        series_index = props.series_index, language = props.language,
        status = summary.status, rating = num(summary.rating),
        percent = num(ds:readSetting("percent_finished")),
        pages = num(ds:readSetting("doc_pages")),
        _sidecar = true,
    }
end

local function md5For(path, known)
    if known then return known end
    local md5 = util.partialMD5(path)
    return md5 and md5:lower() or nil
end

--- Every book file under `dir` (depth-limited, hidden folders skipped).
local function walk(dir, out, depth)
    if depth > 5 then return end
    local ok, iter, dir_obj = pcall(lfs.dir, dir)
    if not ok then return end
    for name in iter, dir_obj do
        if name ~= "." and name ~= ".." and name:sub(1, 1) ~= "." then
            local path = dir .. "/" .. name
            local mode = lfs.attributes(path, "mode")
            if mode == "directory" then
                walk(path, out, depth + 1)
            elseif mode == "file" and core.isBookFile(name) then
                out[#out + 1] = path
            end
        end
    end
end

--- The whole library, keyed by md5: Nickel's database (every sideloaded book,
--- with its metadata), KOReader's statistics, history sidecars, and a walk of
--- the home folder for files Nickel has not imported yet.
function LascisBoard:collectLibrary(stats_books)
    local by_md5, by_path = {}, {}
    local function add(path, facts)
        local md5 = facts.md5
        if not md5 and path then
            if by_path[path] then md5 = by_path[path] else md5 = md5For(path) end
        end
        if not md5 then return end
        facts.md5 = md5
        if path then
            facts.path = facts.path or path
            by_path[path] = md5
        end
        by_md5[md5] = core.mergeBook(by_md5[md5] or {}, facts)
    end

    -- 1. History sidecars (the books actually read in KOReader).
    for i, item in ipairs(ReadHistory.hist or {}) do
        if i > 300 then break end
        if item.file and lfs.attributes(item.file, "mode") == "file" then
            local facts = sidecarFacts(item.file)
            if facts then add(item.file, facts) end
        end
    end

    -- 2. Nickel's own database: read-only, never written.
    local conn = openDb(NICKEL_DB)
    if conn then
        local ok, err = pcall(function()
            local cols = {}
            local info = conn:prepare("PRAGMA table_info(content)")
            for row in info:rows() do cols[row[2]] = true end
            info:close()
            local wanted = { "ContentID", "Title", "Attribution", "ISBN", "Publisher", "Series", "SeriesNumber",
                "Language", "Description", "___PercentRead", "ReadStatus" }
            local have = {}
            for _, c in ipairs(wanted) do if cols[c] then have[#have + 1] = c end end
            local where = "ContentType = '6' AND ContentID LIKE 'file:///%'"
            if cols.VolumeIndex then where = where .. " AND (VolumeIndex = -1 OR VolumeIndex IS NULL)" end
            local stmt = conn:prepare("SELECT " .. table.concat(have, ", ") .. " FROM content WHERE " .. where)
            for row in stmt:rows() do
                local r = {}
                for i, c in ipairs(have) do r[c] = row[i] end
                local path = core.contentIdToPath(r.ContentID)
                if path and lfs.attributes(path, "mode") == "file" then
                    add(path, {
                        content_id = r.ContentID, title = r.Title, authors = r.Attribution, isbn = r.ISBN,
                        publisher = r.Publisher, series = r.Series, series_index = r.SeriesNumber,
                        language = r.Language, description = r.Description,
                        percent = num(r.___PercentRead), status = core.nickelStatus(r.ReadStatus),
                    })
                end
            end
            stmt:close()
        end)
        conn:close()
        if not ok then logger.warn("LascisBoard: Nickel database read failed", err) end
    end

    -- 3. Files Nickel has not seen yet (e.g. books just downloaded in KOReader).
    local files = {}
    walk(filemanagerutil.getHomeFolder(), files, 0)
    if not filemanagerutil.getHomeFolder():match("^/mnt/onboard/?$") then walk("/mnt/onboard", files, 0) end
    for _, path in ipairs(files) do
        if not by_path[path] then add(path, {}) end
    end

    -- 4. KOReader's statistics: totals and last-open time for opened books.
    for _, b in pairs(stats_books) do
        by_md5[b.md5] = core.mergeBook(by_md5[b.md5] or { md5 = b.md5 }, b)
    end
    return by_md5
end

-- ── Sync ─────────────────────────────────────────────────────────────────────

function LascisBoard:flushCurrentBook()
    local stats = self.ui and self.ui.statistics
    if stats and self.ui.document and stats.insertDB then
        pcall(stats.insertDB, stats)
    end
end

--- Sends everything new. `opts.full` restarts from the beginning; `opts.inventory`
--- forces the whole library. Returns a summary table, or nil and an error.
function LascisBoard:sync(opts)
    opts = opts or {}
    if not self:secret() then return nil, _("The device secret is not set (Lasci's Board → Settings).") end
    if not opts.no_flush then self:flushCurrentBook() end
    local conf = openSettings()
    local conn = openDb(DataStorage:getSettingsDir() .. "/statistics.sqlite3")
    local now = os.time()
    local cursor = opts.full and 0 or (conf:readSetting("cursor") or 0)
    local stats_books = conn and statsBooks(conn) or {}
    local inventory_due = opts.inventory or opts.full
        or (now - (conf:readSetting("last_inventory") or 0)) > 20 * 3600
    local library = inventory_due and self:collectLibrary(stats_books) or nil

    local sent, new_events, requests = 0, 0, 0
    local device_id = G_reader_settings:readSetting("device_id") or "kobo"
    local first = true
    -- The first batch re-reads a day before the cursor (late flushes); later
    -- batches continue strictly after the previous one, so they always progress.
    local from = core.readFrom(cursor)
    while true do
        local rows = conn and statsRows(conn, from, core.BATCH) or {}
        local stats, books_in_batch, batch_max = {}, {}, nil
        for _, r in ipairs(rows) do
            local b = stats_books[r[1]]
            if b then
                stats[b.md5] = stats[b.md5] or {}
                table.insert(stats[b.md5], { r[2], r[3], r[4], r[5] })
                books_in_batch[b.md5] = b
            end
            if not batch_max or r[3] > batch_max then batch_max = r[3] end
        end
        local books = {}
        if first and library then
            for _, b in pairs(library) do books[#books + 1] = core.cleanBook(b) end
        end
        for md5, b in pairs(books_in_batch) do
            if not (first and library and library[md5]) then books[#books + 1] = core.cleanBook(b) end
        end
        local last = #rows < core.BATCH
        local rapidjson = require("rapidjson")
        local stats_obj = rapidjson.object({})
        for md5, list in pairs(stats) do stats_obj[md5] = rapidjson.array(list) end
        -- Books are sent in chunks of MAX_BOOKS; only the final chunk carries the
        -- inventory flag, and the server needs it complete, so send extra book-only
        -- requests first when the library is large.
        while #books > core.MAX_BOOKS do
            local chunk = {}
            for i = 1, core.MAX_BOOKS do chunk[i] = table.remove(books) end
            local _, err = self:callJson("POST", "/sync", {
                v = 1, device_id = device_id, device_time = os.time(), plugin_version = VERSION,
                books = rapidjson.array(chunk), stats = rapidjson.object({}),
            })
            if err then if conn then conn:close() end return nil, err end
            requests = requests + 1
        end
        local res, err = self:callJson("POST", "/sync", {
            v = 1, device_id = device_id, device_time = os.time(), plugin_version = VERSION,
            final = last, inventory = (first and library ~= nil) or nil,
            books = rapidjson.array(books), stats = stats_obj,
        })
        if not res then
            if conn then conn:close() end
            return nil, err
        end
        requests = requests + 1
        new_events = new_events + (tonumber(res.new_events) or 0)
        sent = sent + #rows
        cursor = core.nextCursor(cursor, batch_max, now)
        if batch_max then from = batch_max end
        conf = openSettings()
        conf:saveSetting("cursor", cursor)
        if first and library then conf:saveSetting("last_inventory", now) end
        conf:flush()
        first = false
        if last then break end
    end
    if conn then conn:close() end
    local summary = { at = now, sent = sent, new_events = new_events, requests = requests, library = library ~= nil }
    self:save("last_sync", summary)
    return summary
end

--- Downloads every book waiting in the app's inbox, then confirms each one.
function LascisBoard:downloadInbox()
    if not self:secret() then return 0 end
    local res, err = self:callJson("GET", "/inbox")
    if not res then return nil, err end
    local dir = self:inboxDir()
    if lfs.attributes(dir, "mode") ~= "directory" then util.makePath(dir) end
    local done = 0
    for _, item in ipairs(res.items or {}) do
        local name = item.filename or "book.epub"
        local ext = name:match("%.([%w]+)$") or "epub"
        local target = dir .. "/" .. name
        local opds_name = core.opdsStyleName(item.author, item.title, ext)
        local already = lfs.attributes(target, "mode") == "file"
            or (opds_name and lfs.attributes(dir .. "/" .. opds_name, "mode") == "file")
        if not already then
            local part = target .. ".part"
            local code = request("GET", item.url, {}, nil, part)
            local size = lfs.attributes(part, "size")
            if code == 200 and size and (not item.size or size == tonumber(item.size)) then
                os.rename(part, target)
                already = true
            else
                os.remove(part)
                logger.warn("LascisBoard: download failed", name, code, size)
            end
        end
        if already then
            local ok = self:callJson("POST", "/deliveries/" .. item.id .. "/ack", {})
            if ok then done = done + 1 end
        end
    end
    if done > 0 and self.ui and self.ui.file_chooser then
        pcall(function() self.ui.file_chooser:refreshPath() end)
    end
    return done
end

--- The News downloader's own sync, once a day from 05:00, only in the file browser.
function LascisBoard:maybeNews()
    if not self:isOn("auto_news") then return end
    if self.ui.document then return end -- never interrupt reading
    local nd = self.ui.news_downloader
    if not (nd and nd.loadConfigAndProcessFeedsWithUI) then return end
    local now = os.time()
    if not core.newsDue(self:conf():readSetting("last_news_day"), now) then return end
    self:save("last_news_day", core.dayKey(now))
    pcall(function()
        if nd.lazyInitialization then nd:lazyInitialization() end
        nd:loadConfigAndProcessFeedsWithUI()
    end)
end

--- One automatic pass: sync, inbox, news. Silent unless something arrived.
function LascisBoard:runAuto(reason)
    if state.running or not self:secret() then return end
    local now = os.time()
    if now - state.last_auto < AUTO_MIN_GAP then return end
    state.last_auto = now
    state.running = true
    local ok, err = pcall(function()
        if self:isOn("auto_sync") then
            local summary, e = self:sync()
            if not summary then
                logger.warn("LascisBoard: sync failed", reason, e)
                self:save("last_error", { at = now, message = tostring(e) })
            end
        end
        if self:isOn("auto_inbox") then
            local n = self:downloadInbox()
            if n and n > 0 then
                Notification:notify(T(_("Lasci's Board: %1 new book(s) downloaded"), n))
            end
        end
    end)
    state.running = false
    if not ok then logger.warn("LascisBoard: auto run failed", err) end
    self:maybeNews()
end

function LascisBoard:runManual(opts)
    if state.running then
        UIManager:show(InfoMessage:new{ text = _("A sync is already running."), timeout = 3 })
        return
    end
    if not self:secret() then
        UIManager:show(InfoMessage:new{ text = _("Set the device secret first: Lasci's Board → Settings → Device secret.") })
        return
    end
    NetworkMgr:runWhenOnline(function()
        local msg = InfoMessage:new{ text = _("Syncing with Lasci's Board…") }
        UIManager:show(msg)
        UIManager:forceRePaint()
        state.running = true
        local ok, summary, err = pcall(self.sync, self, opts)
        local books
        if ok and summary then books = self:downloadInbox() end
        state.running = false
        state.last_auto = os.time()
        UIManager:close(msg)
        if not ok then err = tostring(summary) summary = nil end
        if summary then
            local text = T(_("Synced.\n%1 new reading rows (%2 sent)."), summary.new_events, summary.sent)
            if summary.library then text = text .. "\n" .. _("Library sent.") end
            if books and books > 0 then text = text .. "\n" .. T(_("%1 new book(s) downloaded."), books) end
            self:save("last_error", nil)
            UIManager:show(InfoMessage:new{ text = text, timeout = 5 })
        else
            self:save("last_error", { at = os.time(), message = tostring(err) })
            UIManager:show(InfoMessage:new{ text = T(_("Sync failed:\n%1"), tostring(err)) })
        end
    end)
end

-- ── Events ───────────────────────────────────────────────────────────────────

function LascisBoard:onNetworkConnected()
    UIManager:scheduleIn(3, function() self:runAuto("network") end)
end

function LascisBoard:onCloseDocument()
    -- Send only when already online (never bring the radio up); the statistics
    -- plugin flushes the closing book first, hence the delay.
    if NetworkMgr:isOnline() and self:isOn("auto_sync") and self:secret() then
        local plugin = self
        UIManager:scheduleIn(2, function()
            if state.running then return end
            state.running = true
            local ok, err = pcall(plugin.sync, plugin, { no_flush = true })
            state.running = false
            if not ok then logger.warn("LascisBoard: close sync failed", err) end
        end)
    end
end

function LascisBoard:onLascisBoardSync()
    self:runManual({ inventory = true })
end

-- ── Menu ─────────────────────────────────────────────────────────────────────

local function ago(t)
    if not t then return _("never") end
    local d = os.time() - t
    if d < 90 then return _("just now") end
    if d < 5400 then return T(_("%1 min ago"), math.floor(d / 60)) end
    if d < 129600 then return T(_("%1 h ago"), math.floor(d / 3600)) end
    return os.date("%d.%m.%Y %H:%M", t)
end

function LascisBoard:statusText()
    local conf = self:conf()
    local s = conf:readSetting("last_sync")
    local e = conf:readSetting("last_error")
    local lines = { T(_("Last sync: %1"), ago(s and s.at)) }
    if s then lines[#lines + 1] = T(_("Rows sent: %1 · new on the server: %2"), s.sent or 0, s.new_events or 0) end
    if e and (not s or (e.at or 0) > (s.at or 0)) then lines[#lines + 1] = T(_("Last error: %1"), e.message or "?") end
    lines[#lines + 1] = T(_("Device secret: %1"), self:secret() and _("set") or _("missing"))
    lines[#lines + 1] = T(_("Restore Wi-Fi on resume: %1"), G_reader_settings:isTrue("auto_restore_wifi") and _("on") or _("off (turn it on for automatic syncs)"))
    lines[#lines + 1] = T(_("Plugin %1"), VERSION)
    return table.concat(lines, "\n")
end

function LascisBoard:editSecret()
    local dialog
    dialog = InputDialog:new{
        title = _("Device secret"),
        input = "",
        input_hint = _("Paste KOBO_SYNC_SECRET"),
        text_type = "password",
        buttons = {{
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = _("Save"), is_enter_default = true, callback = function()
                local v = (dialog:getInputText() or ""):gsub("%s", "")
                UIManager:close(dialog)
                if #v >= 16 then
                    self:save("secret", v)
                    UIManager:show(InfoMessage:new{ text = _("Saved."), timeout = 2 })
                else
                    UIManager:show(InfoMessage:new{ text = _("That is too short to be the secret.") })
                end
            end },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

local function toggle(self, key, text)
    return {
        text = text,
        checked_func = function() return self:isOn(key) end,
        callback = function() self:save(key, not self:isOn(key)) end,
    }
end

function LascisBoard:addToMainMenu(menu_items)
    menu_items.lascisboard = {
        text = _("Lasci's Board"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Sync now"),
                callback = function() self:runManual({ inventory = true }) end,
            },
            {
                text = _("Status"),
                keep_menu_open = true,
                callback = function() UIManager:show(InfoMessage:new{ text = self:statusText() }) end,
            },
            {
                text = _("Settings"),
                separator = true,
                sub_item_table = {
                    toggle(self, "auto_sync", _("Send reading time automatically")),
                    toggle(self, "auto_inbox", _("Download sent books automatically")),
                    toggle(self, "auto_news", _("Sync the news every morning")),
                    {
                        text_func = function() return T(_("Download folder: %1"), self:inboxDir()) end,
                        keep_menu_open = true,
                        callback = function()
                            UIManager:show(InfoMessage:new{ text = _("Books from the app are saved here. Change it in settings/lascisboard.lua (inbox_dir).") })
                        end,
                    },
                    {
                        text = _("Device secret"),
                        keep_menu_open = true,
                        callback = function() self:editSecret() end,
                    },
                    {
                        text = _("Send everything again"),
                        keep_menu_open = true,
                        callback = function()
                            local ConfirmBox = require("ui/widget/confirmbox")
                            UIManager:show(ConfirmBox:new{
                                text = _("Send all reading statistics again from the start? Nothing is duplicated on the server."),
                                ok_text = _("Send"),
                                ok_callback = function() self:runManual({ full = true }) end,
                            })
                        end,
                    },
                },
            },
        },
    }
end

return LascisBoard
