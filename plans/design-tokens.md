# Design tokens — mock ↔ theme (#213)

The mock HTML files (`mocks/*.html`) and the real app share ONE token set. The mocks express it as
CSS custom properties on `:root`; the app expresses it as Chakra `semanticTokens` in the single
design-system home, [`frontend/src/theme.ts`](../frontend/src/theme.ts). This table is the contract
between them — change a value in one place and update the other so they never drift.

> The accent is **violet** and is a **working placeholder**, not a chosen visual identity
> (`plans/plan.md`). The mocks were recolored from their original indigo to this violet so mock ↔
> theme agree before extraction.

## Colors

| Mock CSS var | Chakra token | Light | Dark |
| --- | --- | --- | --- |
| `--bg` | `bg` | `#f6f7f9` | `#0c0e12` |
| `--surface` | `bg.subtle` | `#ffffff` | `#161a20` |
| `--surface-2` | `bg.muted` | `#f9fafb` | `#1b2027` |
| `--border` | `border` | `#e4e7ec` | `#262b33` |
| `--border-strong` | `border.emphasized` | `#d0d5dd` | `#333a44` |
| `--fg` | `fg` | `#101828` | `#f0f2f5` |
| `--fg-muted` | `fg.muted` | `#667085` | `#98a2b3` |
| `--fg-subtle` | `fg.subtle` | `#98a2b3` | `#667085` |
| `--accent` | `brand.solid` | `#7c3aed` | `#8b5cf6` |
| `--accent-soft` | `brand.subtle` | `#f5f3ff` | `#2e1065` |
| `--accent-fg` | `brand.fg` | `#6d28d9` | `#c4b5fd` |

Status colors (`--warn` / `--pos` / `--neg` and their `-soft` / `-border` variants) map onto Chakra's
built-in `orange` / `green` / `red` palettes — screens use `orange.fg`, `red.fg`, `green.fg` rather
than raw hexes. The full violet ramp lives in `theme.ts` as `brand.50…950`.

## Radii, shadows, type

| Mock CSS var | Chakra token | Value |
| --- | --- | --- |
| `--radius-sm` (controls) | `radii.control` → `radii.l2` | `0.5rem` (8px) |
| `--radius` (cards) | `radii.card` → `radii.l3` | `0.75rem` (12px) |
| `--shadow` | `shadows.sm` | `0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)` |
| system font stack | `fonts.body` / `fonts.heading` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` |
| 14px body | `globalCss` body `fontSize: "sm"` | 14px, without rescaling the rem spacing scale |
| tabular numerics | `textStyles.numeric` | `fontVariantNumeric: tabular-nums` |

## Type scale

The mock's typographic roles, formalized so the app inherits them without every screen restating
sizes. Headings resolve through the `heading` recipe (a `Heading size="md"` is the app's page title);
the roles Chakra has no component for are named `textStyles`.

| Role in the mocks | Where | Size / weight |
| --- | --- | --- |
| Page title (`.page-head h1`) | `heading` recipe `md` — `Heading size="md"` | 22px / 700 |
| Section · card title (`.card-title`) | `heading` recipe `sm` — `Heading size="sm"` | 15px / 600 |
| Large page title | `heading` recipe `lg` | 26px / 700 |
| Uppercase micro-label (`.stat-label`, `.nav-label`, `thead th`) | `textStyles.label` | 11px / 700, uppercase, `letter-spacing .05em` |
| Muted caption / subtitle (`.page-head p`, `.stat-sub`) | `textStyles.caption` | 12px |
| Stat value (`.stat-value`) | `textStyles.statValue` | 21px / 650, tabular |

Chakra's `Heading size="md"` defaults to 16px/600 — too small for the mock's 22px page title, which is
why the sizes are overridden on the recipe (scoped to Headings) rather than by touching the shared
`md`/`sm` textStyles other components reference.

Chakra maps `radii.l2`/`l3` onto the control and container recipes, so remapping those two aliases is
what makes every button/input round to 8px and every card to 12px app-wide.

## Color mode

Chakra v3's `_dark` condition is the **`.dark` class on `<html>`**. Color mode is therefore
dependency-free (no next-themes): [`frontend/src/lib/colorMode.ts`](../frontend/src/lib/colorMode.ts)
toggles that class and persists the choice to `localStorage["wh-color-mode"]`; an inline script in
[`frontend/index.html`](../frontend/index.html) applies it before first paint (no flash). Default is
the system preference; the header's [`ColorModeToggle`](../frontend/src/components/ColorModeToggle.tsx)
is the manual override. This mirrors the mocks' own light/dark preview toggle exactly.

## What is NOT here

Density and spacing (`field` / `card` / `section` / `page`, and the default `sm` control size) were
already centralized in `theme.ts` before this issue and are unchanged — they are the density knob,
separate from the palette.
