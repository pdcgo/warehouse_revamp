# Design tokens — mock ↔ Tailwind app

The mock HTML files (`mocks/*.html`) and the real app share ONE token set. Both express it as CSS
custom properties: the mocks on `:root` in each file, the app in
[`frontend/src/index.css`](../frontend/src/index.css) — a `:root` / `:root[data-theme="dark"]` var
block, mapped into Tailwind utilities by an `@theme` block in the same file. This table is the
contract between them — change a value in one place and update the other so they never drift.

The app's styling layer is **Tailwind CSS v4 + Ark UI** (headless behavior); Chakra UI, and its old
`theme.ts` token home, are being removed incrementally — see
[`plans/frontend-tailwind-migration/brainstorming.md`](frontend-tailwind-migration/brainstorming.md).
Tokens live in `index.css` now, not `theme.ts`.

> The accent is **violet** and is a **working placeholder**, not a chosen visual identity
> (`plans/plan.md`). The mocks were recolored from their original indigo to this violet so mock ↔
> app agree before extraction.

## Colors

The CSS var is the shared name in both `:root` blocks (mock and app); the utility is what screens
reach for. The utilities resolve to the dark-aware vars, so they flip on `[data-theme="dark"]` with
no `dark:` variant.

| CSS var | Tailwind utility | Light | Dark |
| --- | --- | --- | --- |
| `--bg` | `bg-bg` | `#f6f7f9` | `#0c0e12` |
| `--surface` | `bg-surface` | `#ffffff` | `#161a20` |
| `--surface-2` | `bg-surface-2` | `#f9fafb` | `#1b2027` |
| `--sidebar` | `bg-sidebar` | `#ffffff` | `#12151b` |
| `--border` | `border-line` | `#e4e7ec` | `#262b33` |
| `--border-strong` | `border-line-strong` | `#d0d5dd` | `#333a44` |
| `--fg` | `text-fg` | `#101828` | `#f0f2f5` |
| `--fg-muted` | `text-fg-muted` | `#667085` | `#98a2b3` |
| `--fg-subtle` | `text-fg-subtle` | `#98a2b3` | `#667085` |
| `--accent` | `text-accent` / `bg-accent` | `#7c3aed` | `#8b5cf6` |
| `--accent-soft` | `bg-accent-soft` | `#f5f3ff` | `#2e1065` |
| `--accent-fg` | `text-accent-fg` | `#6d28d9` | `#c4b5fd` |

Status colors are first-class tokens too: `--warn` / `--pos` / `--neg` and their `-soft` / `-border`
variants back the utilities `text-warn` / `text-pos` / `text-neg` (and `bg-warn-soft`,
`border-warn-border`, `bg-pos-soft`, `bg-neg-soft`, …) — screens use those rather than raw hexes, and
they flip dark-aware from the same `:root` block. The full violet ramp lives in `index.css` as
`--brand-50…950` → utilities `bg-brand-50..950` (and `text-brand-*` / `border-brand-*`); it is what
Chakra's `colorPalette="brand"` used to resolve.

## Radii, shadows, type

The app names radius, shadow and spacing tokens **semantically** — not with Tailwind's numeric
scale — so the utility says intent (a *control*, a *card*) and can't collide with Tailwind v4's
built-in `rounded-sm`/`rounded-lg` or shadow steps.

| Token | App utility | Value |
| --- | --- | --- |
| control radius (mock `rounded-sm` / `--radius-sm`) | `rounded-control` | `0.5rem` (8px) |
| card radius (mock `rounded` / `--radius`) | `rounded-card` | `0.75rem` (12px) |
| card / panel elevation (mock `shadow`) | `shadow-card` | `0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)` |
| popover / menu / dialog elevation (mock `shadow-lg`) | `shadow-pop` | `0 12px 32px rgba(16,24,40,.18), 0 2px 8px rgba(16,24,40,.12)` |
| system font stack | `font-sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` |
| 14px body | base body size (`text-sm`) | 14px, without rescaling the rem spacing scale |
| tabular numerics | `tabular-nums` | `font-variant-numeric: tabular-nums` |

Both shadows are dark-aware — the light values are above; on `[data-theme="dark"]` they deepen (the
same var flips, so the utility name is unchanged).

### Semantic spacing scale

The one density knob, promoted into the `@theme` block. Each token generates the full spacing family
(`p-`, `m-`, `gap-`, …); the representative utilities are shown.

| CSS var | Utilities | Value |
| --- | --- | --- |
| `--spacing-field` | `p-field` / `gap-field` | `0.5rem` (8px) — label ↔ value gap (tightest) |
| `--spacing-card` | `p-card` / `gap-card` | `0.75rem` (12px) — card padding, form fields |
| `--spacing-section` | `gap-section` | `1rem` (16px) — between sections / stacked cards |
| `--spacing-page` | `p-page` | `1.25rem` (20px) — outer content gutter |

### Mock class → app class

**Colours are identical utilities in both builds** — `bg-surface`, `text-fg-muted`, `border-line`,
`text-accent-fg`, `bg-accent-soft`, `text-warn`/`text-pos`/`text-neg` mean the same thing on either
side. Radius, shadow and spacing are the exception: the app renames them to semantic names on purpose
(to dodge Tailwind v4's numeric scales), so if a utility looks different across the two it is a
deliberate rename, **not** an accidental divergence.

| Mock (Tailwind Play CDN, v3-style config) | App (Tailwind v4 `@theme`) |
| --- | --- |
| `rounded` | `rounded-card` (12px) |
| `rounded-sm` | `rounded-control` (8px) |
| `shadow` | `shadow-card` |
| `shadow-lg` | `shadow-pop` |
| ad-hoc spacing | `p-field` / `gap-card` / `gap-section` / `p-page` |

## Type scale

The mock's typographic roles, so the app reproduces them consistently instead of each screen
restating sizes. In the mocks these are the classes shown; the app reproduces the same size / weight
with Tailwind utilities (or a shared text/heading component). These sizes don't line up with a
framework scale step — Tailwind's `text-xl` is 20px and `text-2xl` 24px, but the mock's page title is
22px — so screens set the exact size rather than snapping to a step.

| Role in the mocks | Size / weight |
| --- | --- |
| Page title (`.page-head h1`) | 22px / 700 |
| Section · card title (`.card-title`, `.sec-title`) | 15px / 600 |
| Large page title | 26px / 700 |
| Uppercase micro-label (`.stat-label`, `.nav-label`, `thead th`) | 11px / 700, uppercase, `letter-spacing .05em` |
| Muted caption / subtitle (`.page-head p`, `.stat-sub`) | 12px |
| Stat value (`.stat-value`) | 21px / 650, tabular |

Unlike the colour, radius, shadow and spacing tokens, these type roles are **not yet** promoted into
the `@theme` block — that is a Phase-1 item (see the migration plan §3.1). Until they are, the sizes
above are the contract; a screen matches them directly.

## Color mode

Dark mode rides the **`[data-theme]` attribute on `<html>`** (`[data-theme="dark"]`) — the mocks'
convention, and now the source of truth — **not** Tailwind's default `.dark` class. Tailwind sees it
through a `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` in
`index.css`, and the token vars flip on that same attribute, so most colours need no `dark:` variant
at all.

Color mode stays dependency-free (no next-themes):
[`frontend/src/lib/colorMode.ts`](../frontend/src/lib/colorMode.ts) toggles the attribute and
persists the choice to `localStorage["wh-color-mode"]`; an inline script in
[`frontend/index.html`](../frontend/index.html) applies it before first paint (no flash). Default is
the system preference; the header's
[`ColorModeToggle`](../frontend/src/components/ColorModeToggle.tsx) is the manual override. This
mirrors the mocks' own light/dark toggle, which persists under its own key,
`localStorage["mock-theme"]`.

> **Coexistence.** While Chakra is still in the bundle, `colorMode.ts` sets **both** the
> `[data-theme]` attribute (for Tailwind, above) and the `.dark` class (for Chakra's `_dark`). The
> `.dark` class is dropped at Phase 5, when Chakra is removed.

## What is NOT here

Density is the one thing this doc's palette contract does **not** cover — it is a separate knob. The
semantic spacing scale (`field` / `card` / `section` / `page` — utilities `p-field` / `gap-card` /
`gap-section` / `p-page`) now lives in the `@theme` block of
[`frontend/src/index.css`](../frontend/src/index.css), and the default `sm` control size becomes the
shared primitives' default variant under Ark UI. Both moved off Chakra's `theme.ts` with the rest of
the tokens. Retune the whole app's density in `index.css`, in one place.
