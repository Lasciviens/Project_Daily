# Shop renovation — the plan and where it stands

The owner's request (09.11.2026): a total renovation of the Shop page in phases — look, database, code, integrations, autofill without AI, suggestions, usability. Plan approved 10.11.2026 ("Go!"), with these owner decisions:

- **No hardcoding** ("no power only processes!"): every store and marketplace is a data row with its rules; price match and price protection are generic store rules.
- **Norway only** for law (angrerett 14 days from receipt, reklamasjon 2 / 5 years); no energy labels.
- **Finn, Tise and similar:** within their terms — link out, never fetched (`shop_site_policies`, 188).
- **Prisjakt:** each product page at most once a day, only for things watched or still returnable; robots.txt honoured.
- **Alerts on the page only** (no pushes). Receipts are a text note only. Stats follows the picked year.
- **Look:** picture tiles for the Wishlist, compact rows + a side pane for Owned, never a switch. Prototype approved 10.11.2026 ("I approve this shopping look"), with its changes: the totals card becomes one summary line, wide pages get one filter bar, a small subcategory shares a row.
- **More subcategories and default pictures** (10.11.2026): a picture per subcategory when a thing has none of its own and the price watch found none.
- **Fewer phases** (10.11.2026): the remaining work runs in three steps, agent by agent, without a stop between them unless a decision is needed.

## Done

1. **Phase 1, the page** — the owner's six points + quick wins: PR #601.
2. **Phase 1 fixes** — migrations 187–189 (Delete's Undo, sales, purchase days; the assistant's read query), 188 site policies + Prisjakt's `condition` (new offers only), robots.txt for every site, the one-hour reuse, a blocked site retried after 7 days, Kassalapp prices older than 14 days left out, Find a price from 3 letters, the integration docs (`docs/integrations/prisjakt.md`, `kassalapp.md`, `norges-bank.md`). Security and owner reviews done; their findings fixed.
3. **Phase 2** — Wishlist picture tiles, default pictures (`shopTaxonomy.ts`), suggested subcategories (`CategoryPicker`), Needs a look with Snooze / Got it (migration 190: `shop_signal_states`, `shop_deal_days`, `shop_price_points.in_stock`, one price-stats call). On Owned, Needs a look replaces Coming up: PR #603.
4. **Step A — Owned's new look** (was phase 3): compact rows with a tone tag, the record in a side pane from 60rem, the record's Story timeline, its sections; Owned's loading shift at 402 fixed: PR #604 (merged 11.11.2026).
5. **Step B — Stores, price match, Just bought and Autofill** (was phases 4 + 5): stores and marketplaces as data with their rules, Norwegian law and holidays as data, deal days editable, price match from Prisjakt's offer list, claims become money, Just bought, "Look on FINN / Tise", Autofill with each fact's source, "Find it", the duplicate warning (migration 191): PR #609 (merged 11.11.2026).
6. **Step C — Selling, owning, Stats, Quick list** (was phases 6 + 7): resale evidence and a suggested range, the ad, listings with price cuts, hand-over checklists, Update values, Something's wrong + the complaint letter, the insurance list, new vs used vs refurbished, the new Stats (migration 192): PR #608; the Quick list's Buy again, product pictures, the cheapest chain for the whole list and the scan by EAN: PR #605 (both merged 11.11.2026).
7. **Cleanup** — the "To do later" lists of #604, #605, #608 and #609 fixed together (owner, 11.11.2026), in one cleanup PR.

All three steps are done. Each one went: build → database tests → guardian + owner-critic reviews → PR → report.

## Left for the owner

- The Christmas-return rules carry no year: re-read them before next season.
- XXL's "Prismatch" was left out, because its page doesn't say against whom.
- Elkjøp's November price guarantee fits no rule shape.
- Tise's search address is a best guess: check it once (`docs/deploy-checklist.md`).
- Remind the owner when planning: Supabase key steps 2/3 and 3/3 (`docs/deploy-checklist.md`); the major upgrades (Tailwind 4, TypeScript 7, vite-plugin-pwa 2) wait as their own projects.

## Next, outside the Shop

- **One item screen** — `docs/features/item-screen-plan.md`.
