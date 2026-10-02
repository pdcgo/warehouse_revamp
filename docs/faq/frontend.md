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

## Should a picker be a search select or a plain dropdown?

**Search select if the set GROWS; a plain list only if it is static AND small.**

| | |
| --- | --- |
| **search select** (Chakra `Combobox`) | `TeamSelect`, `UserSelect`, `ShopSelect`, `ProductSelect`, `SupplierSelect` |
| **plain list** (Chakra `Select`) | `MarketplaceSelect`, `RoleSelect`, `TeamTypeSelect`, `ExpenseKindSelect` |

"Few today" is not the test — **bounded forever** is. A team runs four shops now with no ceiling on
that, so `ShopSelect` searches; the marketplace enum only changes when the company enters a new
country, so it stays a list. Getting it wrong is silent until the data arrives.

Where the search *runs* follows the size, not the control: a bounded-ish list loads whole and filters
in the field (`ShopSelect`, `TeamSelect`), an unbounded one searches the server, debounced
(`UserSelect`, `ProductSelect`).

⚠ Two traps both search selects already solve — copy them with the component:

- a combobox whose collection fills in **late** renders **blank** when it was prefilled (Zag derives
  the input text at init and on `value` change only) → `key={filled ? "ready" : "loading"}` on the
  Root, remounting once when the list lands;
- **clearing emits the "none" sentinel** (`0n` / `undefined`), never nothing — otherwise the field
  empties while the parent still filters on the old id.

Authority: [CLAUDE.md](../../CLAUDE.md) → *The design system*.

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

---

## Why doesn't the total on an order row equal `Order.total`?

**Because the row shows TWO totals and `Order.total` is neither of them.**

| | |
| --- | --- |
| `Order.total` (the contract) | `subtotal + shipping_cost` — our quote plus postage, frozen at creation |
| **total beli** (the Beli column) | `cogs` + the warehouse's fee — what the order COST us |
| **total MP** (its own column) | `marketplace_total` — what the buyer paid the platform |

The owner's definition is *"total dari beli … subtotal produk + biaya, dan total dari mp"*, and the
ongkir is **the warehouse's to set, not the seller's** — which is also why the create screen has no
shipping field. See
[the-row-shows-total-beli-and-total-mp](../business/frontend/order_list_decision.md#the-row-shows-total-beli-and-total-mp)
and
[the-ongkir-is-the-warehouses-to-set](../business/frontend/order_create_decision.md#the-ongkir-is-the-warehouses-to-set).

## How is the margin on an order computed?

```
margin     = harga MP − total beli
persentase = margin ÷ harga MP
```

**Against the MARKETPLACE's price, never our own.** See
[the-margin-is-mp-minus-total-beli](../business/frontend/order_list_decision.md#the-margin-is-mp-minus-total-beli).

- **One implementation** — `features/orders/margin.ts`, read by both the summary strip and the table
  row, so the card and the rows beneath it cannot disagree.
- ⚠ **It is NOT the proto's margin.** `order.proto` says `margin = total − cogs − shipping_cost`,
  which measures our quote against our cost and never looks at what the platform paid.
- ⚠ **It needs TWO facts, so it has two ways to be unknown**: a `cogs` of 0 is unknown (not free) and
  a `marketplace_total` of 0 is not recorded (not a sale of nothing). Either one missing and the whole
  cell shows an em-dash. The strip counts those orders in its `margin_unknown` note — counting only
  the missing COST once left it claiming 30% more margin than the rows summed to.

## Why does one order show a marketplace date but no marketplace total?

**Two different absences, and the row keeps them apart.**

| field | empty means |
| --- | --- |
| `order_external_ref_id` | the order **never came from a storefront** — somebody took it over the phone |
| `marketplace_total` = 0 | it did come from a storefront and **nobody wrote down what the storefront took** (`order.proto`: *0 = not recorded, not "sold for nothing"*) |

So the MP date is shown whenever there is a reference, and the MP amount only when there is an
amount. Fixture 108 is deliberately the second case, so the distinction is exercised. See
[every-date-gets-its-own-column](../business/frontend/order_list_decision.md#every-date-gets-its-own-column).

---

## How do I see a screen without the ⚠ "not implemented yet" marks?

**Storybook's toolbar — *Pending marks* → Hidden.** It hides both the ⚠ badges and the folded strip
at the top, so a layout can be reviewed without the scaffolding on it.

| | |
| --- | --- |
| where | the toolbar, beside Color mode and Language |
| default | **Shown**, and `npm run test:stories` runs at the default |
| in the app | **nowhere, on purpose** — see below |

⚠ **There is no switch in the app, and there should not be.** A mark says a number on the screen is
invented or a value typed into a control is thrown away. Somebody using the warehouse must not be able
to turn that off; the audience for the switch is whoever is reviewing the design.

⚠ **Default ON is load-bearing.** `PendingMarksContext` defaults to `true`, so a screen with no
provider above it — which is every screen in the real app — shows its marks. Backwards, they would
vanish everywhere and nobody would notice, because a missing warning looks exactly like nothing being
wrong.

Browsing with them hidden shows any story that asserts on a mark FAILING in the Interactions panel.
That is expected, the same way browsing in Indonesian is. The mechanism is
[features/pending/PendingMarks.tsx](../../frontend/src/features/pending/PendingMarks.tsx).
