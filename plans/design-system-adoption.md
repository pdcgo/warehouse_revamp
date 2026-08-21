# Design-system adoption — the legacy Solid `ui/` set, in React + Chakra

**Ask (owner):** bring across **all 59** components of the legacy Solid client's `ui/` folder,
rewritten for React. Landing on `legacy_adoption`.

> The source is a **private** repo; this one is public. Nothing here names it, links it, or quotes
> its paths — only the component inventory and the design intent travel.

## What "rewrite" means here

| | source | here |
| --- | --- | --- |
| framework | SolidJS (`splitProps`, `createMemo`, `<Show>`) | React 18 hooks |
| styling | Tailwind + custom semantic classes | **Chakra v3 tokens** — no Tailwind, no `cn()` |
| icons | `solid-icons`, a 270-line `iconLib` of ~200 icons over 15 packs | **lucide only** (CLAUDE.md) |
| tooltips | tippy.js | Chakra `Tooltip` |
| dates | dayjs + locale | `lib/datetime.ts` + `Intl` |
| charts | chart.js | inline SVG — **no new dependency** |

So this is a reimplementation against different primitives. What transfers is the **inventory**, the
**prop API**, and the **behavioural rules** — not a line of the code.

### Three decisions taken while porting

| | |
| --- | --- |
| **`icon` props take a component, not a string** | The source keys icons as `"tb.copy"` / `"bs.inbox"` through a hand-kept map. Ours take `icon?: ElementType` — a lucide component. Type-safe, tree-shakes, and drops the 270-line map that had to be edited for every new icon. |
| **`theme` → `tone`, resolving to `colorPalette`** | The source's 7 themes (`active`/`plain`/`primary`/`info`/`success`/`warning`/`error`) are hard-coded Tailwind classes. Here they are one `toneToPalette` map onto Chakra palettes, so a tone change is a token change. |
| **Charts are inline SVG** | Adding chart.js is a dependency decision, not an extraction. Two components' worth of SVG is cheaper and themeable. Revisit if a third chart shows up. |

## Where it lives

**All of it is under `frontend/src/legacy/`** (owner), in its own namespace rather than merged into
the live design system:

```
frontend/src/legacy/
├── components/   the 59 ported components, grouped by kind
├── layout/       the shell — not yet ported
└── pages/        the screens — not yet ported
```

The live design system in `src/components/` is what a NEW screen reaches for; this is a **staging
area** whose pieces are still being reconciled against it. Keeping them apart is what keeps "is this
ours or theirs?" a cheap question while that is unfinished. The rules — chiefly that the dependency
runs ONE WAY, `legacy/` → `src/components/` and never back — are in
[frontend/src/legacy/readme.md](../frontend/src/legacy/readme.md).

## Group mapping

Source groups by *kind*; so do ours. Four groups have no counterpart in the live system.

| source `ui/` | → `legacy/components/` | new kind? |
| --- | --- | --- |
| `data-display/badge/` | `badges/` | |
| `data-display/cell/` | `cells/` | ✅ |
| `data-display/text/` | `text/` | ✅ |
| `data-display/{alert,card,breadcrumb,tabs,image,link,statistic,summary,limit-progress,table}` + `list/` | `display/` | ✅ |
| `data-display/chart/` | `charts/` | ✅ |
| `data-display/{icon,tooltip}`, `feedback/` | `feedback/` | |
| `form/{button,input,field,radio,radio-group,upload}` | `inputs/` | |
| `form/select/` | `pickers/` | |
| `form/datetime/` | `datetime/` | |
| `form/pagination/`, `navigation/tabs` | `chrome/` | |

## Delivered

**59 new component files** under `frontend/src/legacy/components/`, each with a story beside it
titled `Legacy/Components/<Group>/<Name>`. Typecheck, `npm run build` and the full story suite are
green.

| group | components |
| --- | --- |
| `badges/` (4) | `ToneBadge` · `RoleBadge` · `TeamTypeBadge` · `RefIdBadge` |
| `text/` (6) | `ClippedText` · `CopyText` · `CopyNumber` (+`CopyNumberPlain`) · `DateText` (+`StackedDateText`) · `PriceText` · `ShopText` |
| `cells/` (9) | `EntityCell` · `ProductCell` · `UserCell` · `TeamCell` · `SupplierCell` · `ShopCell` · `DateCell` · `StatisticCell` · `ActionCell` |
| `display/` (12) | `Card` · `Alert` · `Breadcrumb` · `ChoiceTabs` · `NavTabs` · `Image` · `OptionalLink` · `Statistic` · `Summary` (+`SummaryCompact`) · `LimitProgress` · `ListSummary` · `DataTable` |
| `charts/` (2) | `BarChart` · `LineChart` — plus `palette.ts`, `chartScale.ts`, `ChartFrame.tsx` |
| `feedback/` (10) | `Tooltip` · `Animate` · `Spinner` · `SpinnerOverlay` · `ProgressBar` · `SkeletonBlock` · `EmptyHint` · `Modal` · `ModalProvider` · `PopBox` |
| `inputs/` (9) | `Button` · `ApplyFilterButton` (+`ResetFilterButton`) · `Field` · `SearchInput` · `RadioGroup` · `SegmentedRadio` · `Upload` (+`ImageUpload`) · `TextInput` (+`Textarea`) · `SearchSelectInput` |
| `pickers/` (3) | `TreeSelect` · `TeamPairSelect` · `TeamTypePairSelect` |
| `datetime/` (4) | `MonthRangePicker` · `YearRangePicker` · `TimeRangePicker` · `PeriodRangePicker` |

Supporting, not components: `legacy/components/tone.ts`, `legacy/components/inputs/filterDirty.ts`,
and three formatters in `src/lib/` — `formatRupiahCompact`, `formatUnixRelative`, `formatUnixTime`.
The formatters stayed in `lib/` on purpose: they are formatting, not UI, and the live app should be
able to use them without reaching into `legacy/`.

### What legacy/ reaches out to

Five imports cross into the live design system, and no import goes the other way (the one-way rule):

| from | to | why |
| --- | --- | --- |
| `text/ShopText`, `cells/ShopCell` | `components/badges/MarketplaceBadge` | one place owns marketplace → colour |
| `badges/TeamTypeBadge`, `pickers/TeamTypePairSelect` | `components/pickers/TeamTypeSelect` | shares `teamTypeLabel` |
| `pickers/TeamPairSelect` | `components/teams/TeamSelect` | the extended picker, not a fork of it |
| `datetime/PeriodRangePicker` | `components/datetime/{DateRangePicker,PeriodGrainPicker}` | the day grain and the grain switch already existed |

### Existing components EXTENDED rather than forked

A second implementation is how two screens start disagreeing (CLAUDE.md), so where we already had
the component, the missing capability went into it:

| component | gained |
| --- | --- |
| [`teams/TeamSelect`](../frontend/src/components/teams/TeamSelect.tsx) | `excludeTeamIds` — and an exclusion covering the current value CLEARS it, matching `ShopSelect`'s existing contract. This is what makes `TeamPairSelect` correct. |
| [`chrome/Pagination`](../frontend/src/components/chrome/Pagination.tsx) | `showRange` — "Showing 21–40 of 312", clamped on the last page. "Page 2 of 16" never said how many records there are. |
| [`feedback/CopyText`](../frontend/src/components/text/CopyText.tsx) | the accessible name flips on copy, not just the icon — found by its own story |

### Deliberately NOT built, and why

Being explicit, because "all 59" was the ask and these are the shortfall:

| source | why not |
| --- | --- |
| `data-display/icon` | An `iconMap` of ~200 icons over 15 packs. CLAUDE.md makes **lucide the only icon source**, so `icon` props take a lucide component directly — type-safe, tree-shaking, and no map to keep current. |
| `form/select/select` + `-trigger` `-value` `-option` | Four files implementing a select from scratch. Chakra v3's composable `Select` is that component, and all 12 existing pickers already build on it directly. A wrapper would add an indirection with no rule in it. |
| `form/select/select-variant` | A modal product/variant picker. The five-component `components/products/` family here already covers it — building a sixth would be the fork the rule warns about. |
| `form/input/input-select-search-product` | Same: `ProductPicker` / `ProductSelect` already exist. The generic `SearchSelectInput` **was** built. |
| `form/datetime/time-slide` | A bespoke scrolling time wheel. The app's date/time decision is **native inputs in a styled shell**, and the native control gives the OS time wheel on a phone for free. `TimeRangePicker` uses it. |
| `data-display/cell/team-common-cell` | Identical to `TeamCell` here. The legacy split existed because one variant took a lookup source and the other an inline item; ours takes the entity by prop, so one component covers both. |
| `form/radio/radio` | A single radio outside a group is almost always the wrong control (it cannot be unchecked). `RadioGroup` and `SegmentedRadio` cover the real cases. |
| `form/button/button-icon` | `Button` takes an `icon`, and Chakra's `IconButton` covers icon-only. |

### Not audited

`inputs/PasswordInput` and `inputs/CurrencyInput` were mapped to the legacy `input-password` /
`input-price` but **not compared against them feature-by-feature** — they are pre-existing, tested,
and nothing in the legacy versions looked like a missing rule. Worth a pass if either turns out to
be thinner than expected.

### Two bugs the stories caught

Both were real, and neither would have shown up in a typecheck:

1. **`DataTable`'s error boundary could not catch anything.** The body was invoked as `{body()}`
   during `DataTable`'s own render, so a throwing cell renderer escaped *above* the boundary and
   would have unmounted the whole page. Rendering it as `<Body/>` puts it beneath the boundary.
2. **`Animate` rendered invisible content**, and never unmounted. It needed `skipAnimationOnMount`
   (something already open should not replay its entrance) and `lazyMount` (do not mount a hidden
   panel's subtree and fire its queries at all).

The charts also had two layout defects no test could see — a clipped top axis label, and bars
rounded at the baseline so short ones read as floating pills. Both found by rendering and looking,
per the dataviz procedure.

### Chart colour

The series palette is the **validated** eight-hue set, in a fixed order that is a CVD-safety
mechanism rather than a style choice — re-ordering it silently breaks adjacent-pair separation.
Both modes pass every gate (`scripts/validate_palette.js`): light CVD ΔE 9.1 / normal 19.6, dark
8.4 / 19.3. Three light-mode hues sit under 3:1 on the light surface, which is legal only with
**relief** — discharged by the legend and hover tooltip both charts always ship. Remove either and
the palette stops being compliant.

## Storybook

Four new sidebar groups — **Text, Cells, Display, Charts** — registered in `storySort`. A group
missing from that list does not disappear, it lands silently below Chrome where nobody scrolls.

The runner also gained a **clipboard stub** (`.storybook/preview.tsx`). A headless browser rejects
`navigator.clipboard.writeText`, and zag fires it from inside a state-machine action, so nothing
awaits the rejection — it surfaced as an unhandled rejection Vitest warns "might cause false
positive tests". The stub resolves (so the copied-state UI is testable at all) and records the value
on `window.__copiedText`, which is what makes the rule worth testing testable: `CopyNumber` renders
"Rp 1,5jt" and must copy `1500000`.

---

# The second port — the warehouse-floor app (`frontend/src/legacy_warehouse/`)

The reference repo holds **three deployable apps**, not one: the selling-team dashboard ported
above, a **warehouse-floor app**, and a one-file static maintenance page. The floor app was the
uncovered half, and it is the half closer to what this system is being built for.

**22 screens, every one with a story.** Full suite after the port: **1,381 tests / 245 files**.

## Why it is a separate namespace and not more of `legacy/`

It is a different application for a different person. Merging them would lose exactly the
distinction that makes it worth having.

| | `legacy/` | `legacy_warehouse/` |
| --- | --- | --- |
| who | the selling team | the people on the floor |
| device | a laptop | a shared trolley tablet, and an Android handheld |
| input | keyboard and mouse | **a barcode scanner**, one-handed, often gloved |
| output | the screen | the screen **and a sound per outcome** |

Dependency direction is one-way and recorded in the folder's readme:
`legacy_warehouse/pages → legacy_warehouse/components → legacy/components → src/components`.
Reusing the other port's DataTable and charts is right; reaching into its *screens* would tangle two
unrelated applications.

## The four things worth more than the screens

1. **The scanner is the interface.** A handheld scanner is a keyboard that types fast and presses
   Enter. The app listens on the **document**, not an input — the operator is holding a parcel and a
   scanner and cannot click to place a cursor. A scan is told from typing by the **gap between
   keystrokes**: a 100ms idle timer clears the buffer, which no human typing speed survives.
2. **Sound is a channel.** Eight audio files in the original. The operator is not looking at the
   screen, so every outcome has its own sound — and a **repeat scan is deliberately not the error
   sound**, because re-scanning when you lose your place in a stack is normal. Audio is never the
   only channel: browsers block it until the page is interacted with, so arming it is a visible
   control and every outcome is also a visible row.
3. **One status enum, three meanings.** `completed` is "received by warehouse" on inbound and
   "handed to the courier" on outbound — the goods **arrived** on one screen and **left** on
   another, with nothing in the record saying which. Reproduced rather than repaired: a reference
   that quietly fixed it would hide the thing most worth seeing.
4. **The same job answered twice, three times over.** Three screens run *beside* the screen they
   replace, and in each case both are still right — filter-then-act vs scan-first, one row per
   problem vs one row per subject, one label per row vs one label times N. A fourth, unrouted
   generation is kept for the progression it shows: each revision moved from **reporting** a problem
   to being able to **act** on one.

## The shell is deliberately different from the app's two

The live app picks between a desktop and a mobile shell at a breakpoint. The floor shell is **one
shell that collapses to a drawer**, and that is correct here for a reason that does not generalise:
its small screen is a **trolley tablet, not a phone in a hand**. There is no thumb to reach a bottom
bar — the operator is holding a scanner.

Both rules are right. The shell follows the posture of the device.

## Two deliberate departures, recorded not hidden

- **The bank-account form is not ported.** This repository is public, and payment details on a shared
  floor tablet is the owner's decision, not something to inherit by copying.
- **Labels are English.** The original floor app is entirely in Indonesian while the selling app is
  mixed — itself a finding, since it means the floor app speaks its operators' language and the
  selling app does not. The vocabulary is recorded in `status.ts`; the UI follows this repo's
  convention.

## Still uncovered

`legacy/`'s own **older generation** — 144 files under the selling app's retired flat router
(inbound, product stock, bundles, shops, withdrawal, statement revision). It is mid-retirement in
the original, and it is warehouse operations rather than finance.
