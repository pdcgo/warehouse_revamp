---
name: audit-frontend-structure
description: Assess whether a frontend page or component should be SPLIT into separate component files, and where each piece belongs (pages/<page>/components/ vs features/<domain>/ vs components/). Use when asked to review frontend structure, find pages that are too big, decide if something needs extracting into its own file, check component placement, or audit the design system for reuse and gallery coverage.
---

# Audit frontend structure

Decides, per file, **whether it should be split and where the pieces go** — against the rules
already set in [CLAUDE.md](../../../CLAUDE.md) ("Frontend structure" and "The design system").
This skill does not invent criteria; it applies those.

Two independent reasons to split, and the second is not size:

1. **It holds several units** — a dialog, a table, a filter bar sharing one file.
2. **It is too complex** — dense with conditional shapes, state, or nesting, however short it is.
   The *kind* of complexity picks the *kind* of split ([step 2b](#step-2b--complexity-the-kind-decides-the-split)).

Both apply to pages **and** to shared `components/` / `features/` files.

Run everything from the repo root.

> **This skill REPORTS. It does not edit.** Splitting a 700-line page is a real refactor with a
> real chance of breaking a screen, so the audit produces a ranked plan and stops. Apply it only
> on an explicit ask — see [Applying a split](#applying-a-split).

## Step 1 — the mechanical inventory

```sh
node .claude/skills/audit-frontend-structure/inventory.mjs
```

Facts only, no verdicts: file sizes, every locally-declared component with its **line span**,
self-contained-unit markers, and three bookkeeping cross-checks. `--json` for the machine-readable
form (feed this to the agents in step 3), `--page <name>` to scope to one page.

Reading the columns:

| column | means | why it matters |
| --- | --- | --- |
| `lines` | whole file | weakest signal — listed last on purpose |
| `body` | the page component **itself**, imports and locals excluded | **the real signal.** A 600-line body is one function doing six jobs |
| `sib` | files already in `pages/<page>/components/` | `-` on a big page means nothing has ever been extracted |
| `local(≥40)` | local JSX components, and how many are ≥40 lines | each ≥40 one is a named, self-contained extraction candidate |
| `cx` | complexity score | **ranking only, never the verdict** |
| `br` | conditional-render branches (`?:`/`&&` on a markup line) | each is a different shape the component can render |
| `map` | `.map` calls, `+Nn` = N of them **nested** | a list of lists is the strongest single split signal |
| `dep` | max JSX nesting depth | how far you indent before reaching content |
| `hk` | all hooks, incl. `useMemo`/`useCallback`/`useRef` | how many concerns the body owns |
| `kind` | which complexity dominates | **this is what picks the split** — see below |
| `units` | inline `dialog` / `table` / `menu` / `form` / `tabs` roots | several units in one file = several files |

A file is a candidate if it is **long OR dense** — the second is the point of `cx`. A 200-line
component with 10 branches and a nested `.map` is harder to hold in your head than a flat 500-line
form, and a size-only audit would rank it 40th.

**Thresholds are derived from the corpus (75th percentile, with floors), not hardcoded** — see
`calibrate()`. A fixed bar both rots as the codebase grows and mislabels: a first pass with
`depth >= 12` tagged 20 of 28 pages `depth-heavy`, which is not a finding, it is the house style.
So the labels always mean "heavy *for this codebase*". Pages, `features/` and `components/` are
calibrated as **one population** — a shared component doesn't get a laxer bar than a page, it has
more callers to hurt.

## Step 2b — complexity: the kind decides the split

Do not answer "it's complex, split it". Each `kind` has one right move:

| kind | what it means | the split |
| --- | --- | --- |
| `branch-heavy` | the component renders several **different shapes** depending on props/state | **split by shape.** Three branches that produce three layouts are three components with one thin picker on top — not one component with three modes. |
| `state-heavy` | it owns too many **concerns** at once | **lift data out first, not markup.** Move the fetching into a `features/<domain>/queries.ts` hook, or one `useReducer` for what is really one state machine. Often removes the need to split markup at all. |
| `depth-heavy` | deeply nested markup | **extract the inner subtree** at the deepest stable point — usually the row/card renderer, which needs 2–3 props. |
| `nested-lists` | a `.map` inside a `.map` | **extract the inner item renderer.** Almost always correct: the inner body already takes exactly one item plus a callback. |
| `data-layer` | a JSX-free `queries.ts` | a hook per RPC **is its job** — never judged by hook count. Split by **entity** only if length becomes unmanageable. |

Two or more kinds on one file means do them **in order**: `state-heavy` first (lifting data often
shrinks everything else), then `nested-lists`, then `depth-heavy`. Re-run the inventory after each —
one extraction commonly drops the others below the bar, and splitting further would be inventing
structure.

⚠ **Complexity is a reason to split a `components/` or `features/` file too, not just a page.** The
script ranks those in their own section. Fixing `ProductPicker` (cx 62, all three kinds) is worth
more than any page, because every screen that picks a product inherits it. But those carry hard-won
rules (#136/#139, #131) — **extract, never rewrite**, and keep the props identical.

### What complexity is NOT

- **A high `cx` on a file whose branches are all one-liners.** Ten `{x && <Badge/>}` in a status
  column is a lookup table written in JSX, not ten shapes. Consider a map/record instead of a split.
- **`dep` alone.** Chakra composition is naturally deep (`Table.Root` → `Table.Body` → `Table.Row`
  → `Table.Cell`); four levels of that is structure, not nesting debt.
- **`hk` on a form.** One `useState` per field is a legitimate 10-hook form. Look at whether the
  hooks serve **one** job before calling it state-heavy.
- **A complex component that is genuinely one cohesive job.** `DatePicker`-style controls are
  irreducibly fiddly. Splitting them scatters one behaviour across files and makes it harder, not
  easier.

`body` and `local(≥40)` are near-independent, and the pair tells you *which* problem the page has:

- **big `body`, no locals** (`restock-request-form` 621, `order-draft-detail` 477) — one giant
  function. Splitting means *finding* the seams, not moving existing ones. The harder case.
- **moderate `body`, big locals** (`rack-detail` 410 + two 122-line locals) — the seams are already
  there and named. Nearly mechanical: move the local to `components/`, export it, import it back.

## Step 2 — the criteria

### Where a piece goes — the only test is HOW MANY PAGES USE IT

Straight from CLAUDE.md. Do not add a fourth bucket.

| used by | goes in |
| --- | --- |
| one page | `pages/<page>/components/` |
| several pages of one domain | `features/<domain>/` |
| the whole app, and it's a UI primitive | `components/` + an `export const description` + a gallery entry, same change |

A `queries.ts` is almost always `features/` — a domain's reads are shared by its list, its detail
and its form.

### What IS a reason to split

- A **named self-contained unit**: a dialog, a table, a filter bar, a summary-card row, a print
  layout. It has a name already, and its props are a narrow slice of page state.
- A unit whose **props are already narrow** — it takes 2–4 values, not the whole page's state.
  That is the seam telling you where the file boundary is.
- A local component **already ≥40 lines** and growing.
- It is **dense**, whatever its length — see [step 2b](#step-2b--complexity-the-kind-decides-the-split).
  Complexity is an independent reason to split, and it applies to shared components too.
- The page mixes **more than one job** — read + edit + a modal flow — and the reader has to scroll
  past one to reach the other.
- ⚠ **A duplicate of something in `components/`.** Check this FIRST, before proposing any
  extraction: `graphify query "what shared components exist for <the thing>"` or the gallery at
  `/components` (36 components today). A local re-implementation should be **deleted in favour of
  the shared one**, not carefully extracted into its own file — and if the shared one *almost*
  fits, extend it rather than fork it. The pickers carry rules learned the hard way that a fresh
  one loses (`RackSelect` keeps "unplaced" selectable, #136/#139).

### What is NOT a reason to split

Say so explicitly when a file trips a metric but is fine — a report that flags everything gets
ignored.

- **Line count on its own.** A 500-line page that is one honest form with 20 fields is one thing;
  chopping it into `FieldGroupA`/`FieldGroupB` invents structure the domain doesn't have.
- **A small local helper** — a 6-line `Field`/`Stat`/`Pending` used four times *in this file*.
  Local and near is more readable than imported and far.
- **A fragment welded to page state.** If extracting it means passing 9 props or lifting a hook
  into a new context, the seam isn't real. Leave it and say why.
- **A single `<Table.Root>` on a list page.** The table *is* the page. `units table:1` alone is
  the normal shape of a list screen, not a finding.
- **`pages/components-gallery/`** — 990 lines because it is one entry per component, which is the
  point of it. The script exempts it; keep it exempt.

### The inverse findings — misfiling that exists today

The script reports these; they are usually **higher value than any split**, because they're
mechanical and CLAUDE.md already calls them wrong:

1. **A `pages/A/components/X` imported by page B.** It has become a domain component — move it to
   `features/<domain>/`. Leaving it is how a page directory quietly turns into a domain module.
2. **A shared component with no `export const description`.** Required for anything *previewed in
   the gallery*. Known and fine as-is: `Toaster` (app infrastructure, not previewable), `Logo`,
   `ConfirmDialog` (rendered by an action, has no standalone preview state). Don't re-flag those
   three each run unless the owner asks for them in the gallery.
3. **A `features/` file that only one page imports** — the mirror of #1. Not urgent, worth noting.

## Step 3 — judge the files (fan out)

The inventory ranks; it cannot judge — `cx` says a file is dense, not that it is *wrong*. Read the
top candidates and decide. For a full-frontend audit, fan out with the **Explore** agent — one per
file, in a single message so they run concurrently — and give each this prompt, with the file's
inventory row pasted in:

> Read `<file>` in full. Its structure inventory says: `<paste the row — body, local(≥40), cx, br,
> map, dep, hk, kind>`. Treat those numbers as a lead to check, not a conclusion; the questions
> below decide.
>
> This repo's rules are in CLAUDE.md ("Frontend structure", "The design system"): a component goes
> in `pages/<page>/components/` if one page uses it, `features/<domain>/` if several pages of one
> domain use it, `components/` if it's an app-wide UI primitive. Prefer graphify
> (`graphify query "..."`) over grep.
>
> Report: (1) each self-contained unit you'd extract — name, line range, **the exact props it would
> take**, and its destination bucket; (2) for each `kind` flagged, whether it is real and the split
> it implies — branch-heavy → split by shape, state-heavy → lift data into a `features/` query hook
> first, nested-lists → extract the inner item renderer, depth-heavy → extract the deepest stable
> subtree; (3) anything duplicating an existing `frontend/src/components/` component, which should
> be REPLACED by it rather than extracted; (4) whether the file is genuinely fine as one file, and
> why.
>
> Be willing to conclude "no split needed" — a wrong split is worse than none. A unit needing more
> than ~5 props, or a hook lifted into a new context, is a FAKE seam: say so instead of proposing
> it. Do not edit any file.

Then apply step 2's criteria to what comes back — the agents propose, the criteria decide. Drop
anything whose props-list is wide (that's a fake seam) or that only trips line count.

## Step 4 — the report

Write to `.claude/skills/audit-frontend-structure/last-report.md` (gitignored). Group by
**effort**, not by page, so the owner can pick a batch:

```markdown
## Mechanical — a named local moves out, no logic changes
| page | extract | → | lines | props |
| rack-detail | RackStockTable (L492) | pages/rack-detail/components/ | 122 | rackId, stock, isLoading |

## Too complex — the kind names the split
| file | cx | kind | the split | order |
| components/ProductPicker.tsx | 62 | state+depth+nested | lift search query to features/products, extract ProductPickerRow | state first, re-measure |

## Needs a seam decision — one big body, no existing boundaries
| page | body | proposed split | the call to make |
| restock-request-form | 621 | header / item rows / totals footer | do the item rows own their own state? |

## Misfiled today (CLAUDE.md violation)
## Replace with an existing shared component
## Fine as-is — tripped a metric, not a problem
```

Every row names the destination bucket and the reason. A row with no reason is noise — and the
last section is not optional: a file that scored high and is genuinely fine belongs in the report
**as such**, or the next run re-litigates it.

Then report to the owner in chat: the counts per group, the 3–5 highest-value items, and any
finding that needs a **design** call (that's an `AskUserQuestion`, not a guess — HARD RULE 8).

## Applying a split

Only on an explicit ask, and only in the **Mechanical** group unless told otherwise — a
**Too complex** row is a refactor, not a move, and needs the owner to pick the seam first. Per split:

1. Move the local component into `pages/<page>/components/<Name>.tsx`, `export` it, import it back.
   Keep the props identical — a split is not a redesign.
2. If it's going to `components/`, add `export const description` **and** its gallery entry in the
   same change (CLAUDE.md).
3. `cd frontend && npm run typecheck` — must pass.
4. Screenshot the page via the **run-warehouse-revamp** skill and confirm it renders unchanged. A
   typecheck does not catch a dropped prop that was only ever `undefined`.
5. Run **only** the Playwright spec covering that page, not the full suite.
6. Commit per page, not per component — one reviewable diff per screen.
7. **Re-run the inventory.** One extraction routinely drops a file's other `kind`s below the bar;
   continuing down the original list would then be inventing structure the code no longer needs.

Never batch a dozen pages into one commit: if one breaks, the owner has to bisect a refactor.
