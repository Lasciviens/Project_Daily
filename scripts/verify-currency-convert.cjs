#!/usr/bin/env node
/*
 * Verification — the one currency converter (Home's Money tile → Convert, and
 * the Currency popup/widget's Convert tab): src/features/home/api/currencyConvert.ts.
 * Against the REAL module via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-currency-convert.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

const {
  CONVERT_CURRENCIES, CONVERTER_START, parseAmount, convertAmount, formatAmount, converterFields, typeIn, pickCurrency, swapCurrencies,
} = require('../src/features/home/api/currencyConvert')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const near = (a, b) => a != null && Math.abs(a - b) < 1e-9

// Open Exchange Rates' shape: units per 1 USD (latest.json without USD; currencyApi adds USD: 1).
const RATES = { NOK: 10, TRY: 53.25, EUR: 0.86, XAU: 0.00025 }

console.log('\n1 · Typed amounts: "," or "." is the decimal mark, spaces are ignored')
check('"1000" → 1000', parseAmount('1000') === 1000)
check('"12,5" → 12.5 (comma decimal)', parseAmount('12,5') === 12.5)
check('"12.5" → 12.5 (dot decimal)', parseAmount('12.5') === 12.5)
check('" 1 000 " → 1000 (spaces ignored)', parseAmount(' 1 000 ') === 1000)
check('"1 000,50" → 1000.5 (a no-break space too)', parseAmount('1 000,50') === 1000.5)
check('"5," → 5 (half-typed decimal)', parseAmount('5,') === 5)
check('",5" → 0.5', parseAmount(',5') === 0.5)
check('"0" → 0', parseAmount('0') === 0)
for (const bad of ['', ' ', ',', '.', 'abc', '1,2,3', '1.2.3', '1.000,50', '-5', '+5', '1e3', '12a']) {
  check(`${JSON.stringify(bad)} → null`, parseAmount(bad) === null, parseAmount(bad))
}

console.log('\n2 · Conversion through the USD-based rates (X → Y = rates[Y] / rates[X])')
check('1 NOK = 5.325 TRY', near(convertAmount(1, 'NOK', 'TRY', RATES), 5.325))
check('1,000 TRY → NOK = 1000 × 10 / 53.25', near(convertAmount(1000, 'TRY', 'NOK', RATES), 1000 * 10 / 53.25))
check('USD is 1 even when the rates leave it out', near(convertAmount(1, 'USD', 'EUR', RATES), 0.86) && near(convertAmount(0.86, 'EUR', 'USD', RATES), 1))
check('same currency → the same amount', near(convertAmount(123.45, 'TRY', 'TRY', RATES), 123.45))
check('a missing rate → null (never a silent 1)', convertAmount(1, 'NOK', 'GBP', RATES) === null && convertAmount(1, 'GBP', 'NOK', RATES) === null)
check('a zero or broken rate → null', convertAmount(1, 'NOK', 'TRY', { NOK: 0, TRY: 53 }) === null && convertAmount(1, 'NOK', 'TRY', { NOK: NaN, TRY: 53 }) === null)
check('there and back again gives the amount', near(convertAmount(convertAmount(250, 'EUR', 'TRY', RATES), 'TRY', 'EUR', RATES), 250))

console.log('\n3 · A result in a field: at most 2 decimals, plain digits, no grouping')
check('187.7934… → "187.79"', formatAmount(1000 * 10 / 53.25) === '187.79', formatAmount(1000 * 10 / 53.25))
check('5325 → "5325" (no "5,325", no ".00")', formatAmount(5325) === '5325')
check('1000000 → "1000000"', formatAmount(1000000) === '1000000')
check('0.5 → "0.5"', formatAmount(0.5) === '0.5')
check('10.50 → "10.5"', formatAmount(10.5) === '10.5')
check('100 → "100" (the zeros before the dot stay)', formatAmount(100) === '100')
check('0 → "0" and 0.004 → "0"', formatAmount(0) === '0' && formatAmount(0.004) === '0')
check('2.345 → 2 decimals at most', /^\d+(\.\d{1,2})?$/.test(formatAmount(2.345)))
check('NaN / Infinity → ""', formatAmount(NaN) === '' && formatAmount(Infinity) === '')

console.log('\n4 · Both fields are input and output')
check('starts at 1,000 TRY on top and NOK below', CONVERTER_START.top === 'TRY' && CONVERTER_START.bottom === 'NOK' && CONVERTER_START.source === 'top' && CONVERTER_START.text === '1000')
let s = CONVERTER_START
let f = converterFields(s, RATES)
check('the start shows 1000 TRY = 187.79 NOK', f.top === '1000' && f.bottom === '187.79', f)
s = typeIn(s, 'bottom', '500')
f = converterFields(s, RATES)
check('typing in the bottom field computes the top: 500 NOK = 2662.5 TRY', f.bottom === '500' && f.top === '2662.5', f)
s = typeIn(s, 'top', '1 000,5')
f = converterFields(s, RATES)
check('typing in the top again computes the bottom, and the typed text stays as typed', f.top === '1 000,5' && f.bottom === formatAmount(1000.5 * 10 / 53.25), f)
s = typeIn(s, 'top', '')
f = converterFields(s, RATES)
check('an emptied field empties the other one', f.top === '' && f.bottom === '', f)
s = typeIn(s, 'bottom', 'abc')
f = converterFields(s, RATES)
check('text that is not a number leaves the other field empty', f.bottom === 'abc' && f.top === '', f)

console.log('\n5 · A currency change recomputes from the field typed in last')
s = typeIn(CONVERTER_START, 'bottom', '100')          // 100 NOK typed below
s = pickCurrency(s, 'top', 'EUR')                     // the top (computed) side becomes EUR
f = converterFields(s, RATES)
check('changing the other side: 100 NOK → 8.6 EUR', f.bottom === '100' && f.top === '8.6', f)
s = pickCurrency(s, 'bottom', 'USD')                  // the source's own currency changes
f = converterFields(s, RATES)
check('changing the source side: the typed 100 now means 100 USD → 86 EUR', f.bottom === '100' && f.top === '86', f)
s = swapCurrencies(CONVERTER_START)
f = converterFields(s, RATES)
check('swap: the typed 1000 stays on top, now NOK → 5325 TRY', s.top === 'NOK' && s.bottom === 'TRY' && f.top === '1000' && f.bottom === '5325', f)
check('nothing is mutated (every visit starts from the same state)', CONVERTER_START.text === '1000' && CONVERTER_START.top === 'TRY' && CONVERTER_START.source === 'top')
check('the four currencies are NOK, TRY, EUR, USD', JSON.stringify(CONVERT_CURRENCIES) === JSON.stringify(['NOK', 'TRY', 'EUR', 'USD']))

console.log('\n6 · One converter: the Money tile and the Currency popup render the same component')
{
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const tile = read('src/features/home/components/CurrencyWidget.tsx')
  const details = read('src/features/home/components/CurrencyDetails.tsx')
  const comp = read('src/features/home/components/CurrencyConverter.tsx')
  check('the tile renders <CurrencyConverter … size="tile" />', /<CurrencyConverter\b[^>]*size="tile"/.test(tile))
  check('the popup\'s Convert tab renders <CurrencyConverter … size="full" />', /<CurrencyConverter\b[^>]*size="full"/.test(details))
  check('no second converter: neither file parses or converts amounts itself', !/parseFloat|rawRates\[/.test(tile + details))
  check('the component takes its logic from currencyConvert.ts', comp.includes("from '../api/currencyConvert'") && /converterFields\(/.test(comp))
  check('the component keeps no stored state (every visit starts over)', !/localStorage|sessionStorage|useWidgetState|persist/.test(comp))
  check('its fields can be selected and edited inside the select-none tile', /\bselect-text\b/.test(comp))
  check('its currency menus are Headless UI listboxes, not hand-made open/close state', comp.includes("from '@headlessui/react'") && /<Listbox\b/.test(comp) && !/useState\(\s*false\s*\)/.test(comp))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
