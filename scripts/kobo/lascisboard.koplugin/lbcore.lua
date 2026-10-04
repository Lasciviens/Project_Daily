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

--- A file name like the OPDS catalogue would use ("Author - Title.epub").
function M.opdsStyleName(author, title, ext)
    if not title or title == "" then return nil end
    local base = (author and author ~= "") and (author .. " - " .. title) or title
    base = base:gsub('[/\\:%*%?"<>|]', "_")
    return base .. "." .. (ext or "epub")
end

--- Strips the "_lasci" bookkeeping keys before a book is sent.
function M.cleanBook(b)
    local out = {}
    for k, v in pairs(b) do
        if k:sub(1, 1) ~= "_" then out[k] = v end
    end
    return out
end

return M
