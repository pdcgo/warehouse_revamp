# FAQ — Frontend (React + Chakra UI v3)

The UI is designed **first** — the proto and the schema are derived from the screens, never the
reverse. If a screen cannot be tied to a person doing a task, it does not get built.

---

## Where do I put a new file?

```
frontend/src/
  layouts/            the shell — desktop and mobile, exactly one mounts
  pages/<page>/
    index.tsx         THE page component — one directory per SCREEN
    components/       used by THIS page and nothing else
  features/<domain>/  queries + anything shared by SEVERAL pages of one domain
  components/<group>/ the design system — shared app-wide, grouped by KIND
```

The test is **how many pages use it**:

| Used by | Goes in |
| --- | --- |
| one page | `pages/<page>/components/` |
| several pages of one domain | `features/<domain>/` |
| the whole app, and it is a UI primitive | `components/<group>/` (the design system) |

A `queries.ts` is almost always `features/`, because a domain's reads are shared by its list, its
detail and its form.

⚠ **`pages/<page>/components/` means ONLY THIS PAGE.** The moment a second page imports one, it has
become a domain component and belongs in `features/`. Leaving it where it was is how a page
directory quietly turns into a domain module.

Page directories are named for the **screen** and are flat: `pages/order-create/`, not
`pages/orders/new/`. A nested tree mirroring URLs makes `components/` ambiguous as soon as a parent
and a child both have one.

---

## Do I write the component myself?

**Look for a shared one first.** `frontend/src/components/` holds ~39 of them, grouped by kind:

| `components/<group>/` | | |
| --- | --- | --- |
| `pickers/` | 16 | choose a thing — every `*Select`, `ProductPicker`, `AddressPicker` |
| `datetime/` | 6 | the date/time family, plus `PeriodGrainPicker` |
| `entity/` | 5 | show a product / a team / a person the same way everywhere |
| `badges/` | 4 | a status or a kind, in its ONE standard colour |
| `feedback/` | 3 | `ConfirmDialog`, `RefreshOverlay`, `Toaster` |
| `chrome/` | 3 | `Logo`, `Pagination`, `ColorModeToggle` |
| `inputs/` | 2 | a typed value, formatted or masked |

Fastest way to see what exists: `cd frontend && npm run storybook` (:6006). The Storybook sidebar
mirrors these folders one-for-one.

This is not only about saving effort — **a re-implementation is how two screens start disagreeing.**
The pickers carry rules that are invisible from the outside and were learned the hard way:
`RackSelect` keeps "unplaced" *selectable* while its placeholder stays disabled, because a place is
not an absence; `ProductListItem` shows its stock badge even at **zero**, because out-of-stock is
the case worth seeing.

If nothing fits, **extend the shared component rather than forking it**. If you do add one, it
needs an `export const description` and a story file in the same change.

---

## Can I use a raw `<button>` / `<input>` / `<select>` / `<div>`?

**No — build from Chakra UI v3 components**, and reach for a native element only on an explicit
ask. Chakra components carry the theme's sizing, spacing, colours and a11y wiring; skipping them is
how an app drifts off its design system. For a rich picker (searchable, multi-level) prefer
Chakra's composable `Select` over `NativeSelect`.

Four more UI rules that come up in review constantly:

- **Many row actions → an overflow `Menu`.** Roughly three or more actions collapse behind a kebab
  `IconButton` (`MoreHorizontal`). **Every menu item carries a leading icon.** One or two actions
  may stay inline.
- **Destructive actions always confirm** — delete, suspend, remove, reset — through
  [`ConfirmDialog`](../../frontend/src/components/feedback/ConfirmDialog.tsx). Never a bare
  one-click destructive button.
- **Dialog titles are Title Case** — "Delete Product", not "Delete product".
- **A detail view is a PAGE, not a dialog.** "See the full record" is a route (`/users/:id`). A
  dialog is for a focused *action* (create, edit, confirm), not for *reading* an entity.

---

## Where do sizes, spacing and colours come from?

[`frontend/src/theme.ts`](../../frontend/src/theme.ts), and only there.

- **Control sizing defaults to `sm`.** Do not sprinkle `size="sm"` through the app — an explicit
  size is an override and should be rare (e.g. `size="xs"` on a table row action).
- **Semantic spacing tokens** — `field` / `card` / `section` / `page`. Reference those, never raw
  spacing values, so the whole app's density is retuned in one place.

The accent ramp there is a **placeholder** — no visual identity has been chosen yet.

---

## How do I add an icon?

[lucide-react](https://lucide.dev), through Chakra's `<Icon>` wrapper:

```tsx
import { Pencil } from "lucide-react"
<Icon as={Pencil} boxSize="4" />
```

`<Icon>` is what makes the icon obey Chakra's sizing and colour tokens, so **size is a `boxSize`
token, not a raw pixel prop** (`"4"` = 16px, the size for an `xs` row action).

Do **not** import lucide icons bare (`<Pencil size={16} />`), and do **not** use emoji or ad-hoc
unicode glyphs (`✎`, `🔑`) as icons — they render differently on every platform. Keep the button's
`aria-label`: the icon is decorative, the label is the name.

---

## Why does my list flicker, or show stale numbers?

Because the two halves of the freshness rule are a **pair**, and you probably have one without the
other.

| | |
| --- | --- |
| `staleTime: 0` | *whether* we refetch → always |
| `placeholderData: keepPreviousData` | *what is on screen while it runs* → the previous rows |

The people using this app work in pairs on a shared stock level, from a scanner and a phone at the
same shelf. "The number I am reading was true half a minute ago" is not a property a stock count
can have — **freshness here is correctness, not polish.** But always-fresh *without* keeping the
previous rows trades a stale screen for a flickering one.

So, three requirements on any paginated or filtered list:

1. **Spread the `listQuery` preset** — not the raw option, so the reason travels with the setting.
2. **Wrap the table in [`RefreshOverlay`](../../frontend/src/components/feedback/RefreshOverlay.tsx)**
   with `busy={query.isFetching && !query.isPending}`. Kept rows with no indicator are a screen that
   silently lies about how current it is. The overlay waits 150ms before showing, so a fast refetch
   never flickers — that delay is the component's job, not the caller's.
3. **Exclude `isPending` from `busy`, always.** A genuine first load has no rows to keep and shows
   the page's own spinner.

⚠ **`listQuery` is not a global default.** It is right when a key change *refines the same question*
(page 2, the Fulfilled tab, supplier = Ani) and wrong when the key change picks a *different
subject* — a by-id detail hook keyed on product 5 would spend a beat rendering product 5 under a URL
that already says product 9. By-id hooks stay on the plain default.

**The one buy-out is `referenceQuery`** — a picker feed or a name lookup, data read to *label*
something rather than to work from. Buy out by name, never by hand-writing a `staleTime`.

`refetchOnWindowFocus: false` is deliberate and not an inconsistency: the app is used with a scanner
and a spreadsheet beside it, so focus is lost and regained constantly.

Not everything went through TanStack — `CategorySelect`, `SupplierSelect`, `RackSelect`,
`ProductPicker` and the courier catalogue run their own `useEffect`/session caches and are not
covered by this rule until they move to a query hook.

---

## How does mobile work? Do I add responsive props?

**A phone gets a DIFFERENT SHELL, not the desktop one squeezed.** `Layout` reads one media query
(`useIsMobile`, Chakra's `md`) and mounts either `DesktopLayout` (a persistent 258px sidebar beside
a breadcrumb top bar) or `MobileLayout` (a compact top bar plus a **bottom tab bar** the thumb
reaches — no hamburger).

⚠ **Exactly ONE shell mounts — a JS breakpoint, never `hideFrom`/`hideBelow`.** Hiding one with CSS
renders both: two `<Outlet/>`s (every page mounted twice), two `navigation` landmarks, and two of
every `data-testid` the e2e reach for.

**Everything that thinks is shared**: `nav.ts` builds the menu from the team's type and your role,
answers "where am I" (longest-prefix) and decides the bottom bar; `shell.ts` owns the breakpoint and
the page canvas. A rule living in one shell is a rule the other one breaks.

---

## Where does user-visible text go?

The UI is internationalised with [react-i18next](https://react.i18next.com) — English and Bahasa
Indonesia. Catalogs are `frontend/src/i18n/locales/en.json` and `id.json`; add the key to **both**.

---

## How do I run Storybook?

```sh
cd frontend
npm run storybook        # the workbench, :6006
npm run test:stories     # every story's play() headlessly — after any component change
npm run build-storybook  # the static site (storybook-static/, gitignored)
```

**It needs neither the Go API nor Postgres.** The Connect transport is stubbed at build time
(`.storybook/stubTransport.ts`), so a component runs its real query hook against fixtures — which
is the point: a picker regression fails here in a second, naming the component, instead of as a
mysterious timeout in an e2e spec.

Port 6006 is Storybook's own default and collides with nothing on this machine — unlike
[5433 / 6380 / 5174](getting-started.md#why-are-the-ports-5433--6380--5174-instead-of-the-usual-ones).

---

## Does my component need a Storybook story?

**Yes, if it is a shared component — in the same commit**, as
`frontend/src/components/<group>/<Component>.stories.tsx`, titled `Components/<Group>/<Name>`.

**The story is the documentation and the test.** It carries the states worth reviewing *and* a
`play()` per behavioural rule; Vitest renders it in a real Chromium and runs `play()` as the test
body. A component exporting `description` feeds it into the story's docs page, so the sentence
lives once, in the component.

Run `npm run test:stories` after any component change — see [How do I run Storybook?](#how-do-i-run-storybook).

> This replaced a hand-written gallery page — 1238 lines of JSX that documented but never
> *checked*. Every rule in those descriptions could be broken with nothing failing.

---

## What bites when writing a story?

| | |
| --- | --- |
| `Select.HiddenSelect` renders a native `<option>` per item | query by **role**, not text, or every `getByText` matches twice |
| popovers/listboxes animate in | `await waitFor(() => expect(el).toBeVisible())` before clicking — until then `pointer-events: none` rejects it |
| some pickers portal, some deliberately do not | `screen` for portalled (TeamSelect, RoleSelect); `within(canvasElement)` for inline ones (RackSelect, ShopSelect, CategorySelect — they must work inside modal Dialogs) |
| a controlled input needs real state | a story pinning `value` to a constant re-renders the field back after every keystroke. Use `userEvent.type(el, "…", { delay: 40 })` — at machine speed a controlled input drops characters |
| module-level caches survive between stories | the shipping catalogue and colour-mode storage are reset in `preview.tsx`'s `beforeEach` |

The API is stubbed **at the transport** (`.storybook/stubTransport.ts`), not per hook — so the
component runs its real query hook, adapter, loading and error states. An unstubbed method throws
`unimplemented`, which is a visible error rather than an empty dropdown that reads as a styling bug.

---

## How do I run the e2e?

```sh
cd frontend && npm run e2e            # starts its own API :8081 + UI :5175
cd frontend && npx playwright test <spec>
```

**Run only the spec for the work in hand** — CI covers the rest. The e2e uses the `warehouse_test`
database and its own ports, so it can run beside your dev servers.

⚠ `reuseExistingServer: true` means a **stray** server left on :8081/:5175 gets conscripted by the
run rather than ignored — if results look impossible, check nothing old is still listening there.
