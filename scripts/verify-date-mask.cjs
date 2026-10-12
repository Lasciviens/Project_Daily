// Checks the DD.MM.YYYY field's typing rules (src/shared/components/dateMask.ts).
//   node scripts/verify-date-mask.cjs
require('sucrase/register')
const assert = require('assert')
const M = require('../src/shared/components/dateMask.ts')

let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }

const text = s => M.slotsToText(s)
// Keys typed one after another from a caret (or a selection) in a field showing `from`.
function keys(seq, from = '__.__.____', start = 0, end = start) {
  let slots = M.slotsFromText(from)
  let a = start
  let b = end
  for (const k of seq) {
    let st
    if (k === '⌫') st = M.backspace(slots, a, b)
    else if (k === '⌦') st = M.deleteForward(slots, a, b)
    else if (/\d/.test(k)) st = M.typeDigit(slots, a, b, k)
    else st = M.typeSeparator(slots, a, b)
    slots = st.slots
    a = b = st.caret
  }
  return { text: text(slots), caret: a }
}
const typed = (seq, from, start, end) => keys([...seq], from, start, end).text
const onBlur = shown => text(M.completeSlots(M.slotsFromText(shown)))

// The owner's report: deleting one digit must not squeeze the rest together.
eq(keys(['⌫'], '10.09.2026', 5), { text: '10.0_.2026', caret: 4 }, 'Backspace after the 9 leaves 10.0_.2026')
eq(keys(['⌦'], '10.09.2026', 4), { text: '10.0_.2026', caret: 5 }, 'Delete before the 9 leaves 10.0_.2026')
eq(typed('8', '10.0_.2026', 4), '10.08.2026', 'typing into the gap fills only that gap')
eq(keys(['⌫'], '10.09.2026', 3), { text: '1_.09.2026', caret: 1 }, 'Backspace right after a dot skips the dot')
eq(typed('5', '10.09.2026', 0), '05.09.2026', 'a day starting 5 overwrites as 05')
eq(typed('2', '10.09.2026', 0), '20.09.2026', 'overwrite at the caret, nothing shifts')
eq(typed('7', '10.09.2026', 6), '10.09.7026', 'overwrite in the year')
eq(keys(['⌫', '⌫', '⌫'], '10.09.2026', 10).text, '10.09.2___', 'three Backspaces from the end')
eq(keys(['⌫'], '10.09.2026', 0), { text: '10.09.2026', caret: 0 }, 'Backspace at the start does nothing')
eq(keys(['⌦'], '10.09.2026', 10), { text: '10.09.2026', caret: 10 }, 'Delete at the end does nothing')

// Selections clear only what they cover.
eq(keys(['⌫'], '10.09.2026', 0, 10).text, '__.__.____', 'select all + Backspace empties the field')
eq(keys(['⌫'], '10.09.2026', 3, 5).text, '10.__.2026', 'selected month cleared, day and year stay')
eq(typed('1', '10.09.2026', 3, 5), '10.1_.2026', 'typing over a selected month')
eq(typed('3', '10.09.2026', 0, 10), '3_.__.____', 'typing over everything starts again')
eq(keys(['⌫'], '10.09.2026', 2, 3).text, '10.09.2026', 'a selected dot alone clears nothing')

// The ways the owner types dates.
eq(typed('07122026'), '07.12.2026', '07122026')
eq(onBlur(typed('071226')), '07.12.2026', '071226 + leaving = 2026')
eq(typed('7.12.2026'), '07.12.2026', '7.12.2026')
eq(onBlur(typed('07.12.26')), '07.12.2026', '07.12.26')
eq(typed('7-12-2026'), '07.12.2026', '7-12-2026')
eq(onBlur(typed('7/12/26')), '07.12.2026', '7/12/26')
eq(typed('1.2.2026'), '01.02.2026', '1.2.2026: a separator closes a one-digit day')
eq(typed('1 5 2026'), '01.05.2026', 'spaces as separators')
eq(typed('12.05.2026'), '12.05.2026', 'a separator right after a finished part does nothing')
eq(typed('31.1.2026'), '31.01.2026', 'one-digit month closed by the dot')
eq(typed('9'), '09.__.____', 'a day starting 9 can only be 09')
eq(keys(['9']).caret, 3, '…and the caret moves to the month')
eq(typed('052'), '05.02.____', 'a month starting 2 can only be 02')
eq(typed('0'), '0_.__.____', 'a day starting 0 waits for its second digit')
eq(typed('2026', '07.12.____', 6), '07.12.2026', 'typing the year')
eq(typed('.', '__.__.____', 0), '__.__.____', 'a separator in an empty field does nothing')
eq(typed('5', '07.12.2026', 10), '07.12.2026', 'a digit after a full date does nothing')
eq(typed('5', '07.12.20__', 10), '07.12.205_', 'a digit at the end fills the first gap')
eq(typed('4', '__.__.____', 7), '04.__.____', 'an empty field starts at the day wherever the caret is')
eq(typed('.', '07.1_.____', 4), '07.01.____', 'separator after a one-digit month')
eq(typed('.', '07.12.20__', 8), '07.12.20__', 'separator in the year does nothing')

// Pasting.
const paste = (s, from = '__.__.____', a = 0, b = a) => text(M.pasteText(M.slotsFromText(from), a, b, s).slots)
eq(paste('07122026'), '07.12.2026', 'paste 07122026')
eq(paste('071226'), '07.12.2026', 'paste 071226')
eq(paste(' 7.12.2026 '), '07.12.2026', 'paste with spaces around')
eq(paste('2026-12-07'), '07.12.2026', 'paste yyyy-MM-dd')
eq(paste('20261207'), '07.12.2026', 'paste yyyyMMdd when it is no ddMMyyyy')
eq(paste('7.12.2026', '01.01.2025', 3), '07.12.2026', 'a whole date replaces the field')
eq(paste('2027', '07.12.2026', 6), '07.12.2027', 'paste a year into the year')
eq(paste('7.12', '__.__.____'), '07.12.____', 'paste a day and month')
eq(paste('abc', '07.12.2026', 3), '07.12.2026', 'paste text with no digits changes nothing')

// Leaving the field.
eq(onBlur('07.12.26__'), '07.12.2026', 'two-digit year completed')
eq(onBlur('7_.12.2026'), '07.12.2026', 'one-digit day completed')
eq(onBlur('07.1_.2026'), '07.01.2026', 'one-digit month completed')
eq(onBlur('_7.12.2026'), '_7.12.2026', 'a missing first digit is not guessed')
eq(onBlur('07.12.2___'), '07.12.2___', 'a three-digit gap year is not guessed')

// What the field holds.
const check = (shown, min, max) => M.checkSlots(M.slotsFromText(shown), min, max)
eq(check('__.__.____'), { state: 'empty' }, 'empty')
eq(check('07.12.20__'), { state: 'partial' }, 'partial')
eq(check('07.12.2026'), { state: 'ok', iso: '2026-12-07' }, 'ok')
eq(check('31.02.2026'), { state: 'bad' }, '31.02 is no real day')
eq(check('29.02.2027'), { state: 'bad' }, '29.02.2027 is no leap year')
eq(check('29.02.2028'), { state: 'ok', iso: '2028-02-29' }, '29.02.2028 is')
eq(check('29.02.____'), { state: 'partial' }, '29.02 waits for the year')
eq(check('31.04.____'), { state: 'bad' }, '31.04 is bad before the year')
eq(check('35.__.____'), { state: 'bad' }, 'day 35 is bad at once')
eq(check('00.__.____'), { state: 'bad' }, 'day 00')
eq(check('10.13.____'), { state: 'bad' }, 'month 13')
eq(check('10.00.2026'), { state: 'bad' }, 'month 00')
eq(check('10.09.0026'), { state: 'bad' }, 'year 0026')
eq(check('10.09.2026', undefined, '2026-09-09'), { state: 'out', iso: '2026-09-10' }, 'after max')
eq(check('10.09.2026', '2026-09-11'), { state: 'out', iso: '2026-09-10' }, 'before min')
eq(check('10.09.2026', '2026-09-10', '2026-09-10'), { state: 'ok', iso: '2026-09-10' }, 'min and max are inclusive')

// Loose parsing.
eq(M.parseLooseDate('7.12.2026'), '2026-12-07', 'd.m.yyyy')
eq(M.parseLooseDate('07.12.26.'), '2026-12-07', 'trailing dot')
eq(M.parseLooseDate('7, 12, 2026'), '2026-12-07', 'commas')
eq(M.parseLooseDate('31.02.2026'), null, 'no real day')
eq(M.parseLooseDate('12/31/2026'), null, 'month/day order is not guessed')
eq(M.parseLooseDate('7.12'), null, 'no year')
eq(M.parseLooseDate(''), null, 'empty')
eq(M.parseLooseDate('1207'), null, 'four digits')

// Round trips and the other way of changing the text.
eq(M.isoToSlots('2026-09-10'), '10092026', 'iso to slots')
eq(M.isoToSlots(''), M.EMPTY_SLOTS, 'empty iso')
eq(M.isoToSlots('2026-9-10'), M.EMPTY_SLOTS, 'malformed iso')
eq(text(M.slotsFromText('10.0_.2026')), '10.0_.2026', 'undo back to a gap keeps the gap')
eq(text(M.slotsFromText('1002026')), '10.02.026_', 'unknown text is typed in, never guessed further')
eq(M.daysInMonth(1900, 2), 28, '1900 is no leap year')
eq(M.daysInMonth(2000, 2), 29, '2000 is')

console.log(`verify-date-mask: ${n} passed`)
