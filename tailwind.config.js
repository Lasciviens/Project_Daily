/** @type {import('tailwindcss').Config} */

// Design tokens live in src/index.css as RGB triplets on :root / :root.dark
// (and --accent-* as inline styles from src/shared/theme/accent.ts). This file
// only maps Tailwind names onto them, so a colour change never touches a
// component. The system is documented in docs/design/THEME.md.
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`
const scale = (name, shades) => Object.fromEntries(shades.map(s => [s, rgb(`${name}-${s}`)]))
const tone = (name) => ({ DEFAULT: rgb(name), soft: rgb(`${name}-soft`) })

export default {
  darkMode: 'selector',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Semantic names (use these in new code) ─────────────────────────
        surface: {
          DEFAULT: rgb('cream-50'),   // cards, panels, menus, sheets
          2:       rgb('cream-100'),  // recessed fills: inputs, selects, secondary buttons, badges
          hover:   rgb('cream-200'),  // hover / press tint of rows and buttons
        },
        line: {
          DEFAULT: rgb('ink-200'),    // the 1px hairline: panels, inputs, dividers
          strong:  rgb('ink-300'),    // floating surfaces, hovered selects
        },
        fg: {
          DEFAULT: rgb('ink-900'),    // headings, primary values
          2:       rgb('ink-700'),    // body text, nav labels, menu items
          muted:   rgb('ink-500'),    // meta, subtitles, section labels
          faint:   rgb('ink-400'),    // placeholders, chevrons, decoration only
        },
        'on-accent': rgb('on-accent'),
        success: tone('success'),
        warn:    tone('warn'),
        danger:  tone('danger'),
        info:    tone('info'),
        neutral: tone('neutral'),
        highlight: tone('highlight'),
        star:    tone('star'),
        scrim:   rgb('scrim'),

        // ── Legacy names (kept: ~5,000 existing uses restyle for free) ─────
        canvas: rgb('canvas'),
        cream:  scale('cream', [50, 100, 200, 300]),
        // ink-950 is the always-dark surface (scrims, photo overlays) in both
        // themes; 50–900 invert per theme (900 = the strongest ink).
        ink:    { ...scale('ink', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]), 950: rgb('scrim') },
        accent: scale('accent', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      fontSize: {
        // The type scale (THEME.md §3). Each step carries its line-height.
        micro: ['11px', { lineHeight: '16px' }],   // eyebrow labels, badges, chart ticks
        meta:  ['12px', { lineHeight: '16px' }],   // subtitles, timestamps, secondary values
        body:  ['13px', { lineHeight: '20px' }],   // body text, controls, list rows
        ui:    ['14px', { lineHeight: '20px' }],   // primary buttons, emphasised rows
        lead:  ['15px', { lineHeight: '22px' }],   // phone sheet rows, card titles on phones
        title: ['17px', { lineHeight: '24px' }],   // sheet / dialog / card-hero titles
        head:  ['19px', { lineHeight: '26px' }],   // phone header title
        page:  ['24px', { lineHeight: '30px' }],   // page title (wide)
        kpi:   ['26px', { lineHeight: '30px' }],   // big numbers
      },
      borderRadius: {
        control: '10px',  // buttons, selects, icon buttons, nav items, status pills
        input:   '11px',
        row:     '12px',  // list rows, sheet rows
        menu:    '14px',
        card:    '18px',  // panels and cards
        sheet:   '22px',  // phone bottom sheets (top corners)
      },
      boxShadow: {
        card:         'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        menu:         'var(--shadow-menu)',
        float:        'var(--shadow-float)',
      },
      zIndex: {
        chrome:  'var(--z-chrome)',
        drawer:  'var(--z-drawer)',
        sheet:   'var(--z-sheet)',
        popover: 'var(--z-popover)',
        modal:   'var(--z-modal)',
        confirm: 'var(--z-confirm)',
        toast:   'var(--z-toast)',
      },
      spacing: {
        header: 'var(--app-header-h)',
        tabbar: 'var(--app-tabbar-h)',
        sidebar: 'var(--app-sidebar-w)',
      },
      keyframes: {
        fadeSlideIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        wiggle: {
          '0%,100%': { transform: 'rotate(-3deg)' },
          '50%':     { transform: 'rotate(3deg)' },
        },
        // Bottom-tab-bar active icon "pop" — the springy overshoot native
        // tab bars give the icon you just tapped.
        tabPop: {
          '0%':   { transform: 'scale(1)' },
          '45%':  { transform: 'scale(1.22)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        fadeSlideIn: 'fadeSlideIn 0.2s ease-out',
        wiggle:      'wiggle 0.3s ease-in-out',
        tabPop:      'tabPop 0.3s ease-out',
      },
    },
  },
  plugins: [require('@tailwindcss/container-queries')],
}
