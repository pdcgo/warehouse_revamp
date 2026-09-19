# `legacy_warehouse/` — the warehouse-floor app

The **second** legacy client, ported as a design reference. It is a different application from the
one in [`../legacy/`](../legacy/), built for a different person doing a different job, and keeping
them apart is the point of the separate folder.

|  | [`legacy/`](../legacy/) | `legacy_warehouse/` |
| --- | --- | --- |
| who | the selling team | the people on the warehouse floor |
| device | a laptop | a shared tablet on a trolley, and an Android handheld |
| input | keyboard and mouse | **a barcode scanner**, one-handed, often with gloves |
| output | the screen | the screen **and a sound per outcome** |
| shape | 89 screens, mostly finance | 22 screens, all movement |

**All 22 screens are ported, and every one has a story.**

## ⚠ These pages do not fetch

Same rule as the other port: every page takes its data as **props**, and its story supplies them
from [`fixtures.ts`](fixtures.ts). The original's data layer targets a proto contract this repo does
not have.

The contract-specific plumbing — `api/`, `viewmodels/`, `stores/`, `guards/`, `generated/` — is
deliberately **not** ported.

## Dependency direction

```
legacy_warehouse/pages  →  legacy_warehouse/components  →  legacy/components  →  src/components
```

**Never the reverse, and never into `legacy/pages` or `legacy/layout`.** Reusing the other port's
shared components (DataTable, Card, Summary, the charts, the cells) is right — re-implementing a
table would be how two references start disagreeing. Reaching into its *screens* would tangle two
applications that have nothing to do with each other.

## What this port is actually for

Four things in here are worth more than the screens they sit in.

### 1. The scanner is the interface — [`components/scan/`](components/scan/)

A handheld scanner is a keyboard that types fast and presses Enter. The app listens on the
**document**, not on an input, because the operator is holding a parcel in one hand and a scanner in
the other and **cannot click anything to place a cursor**.

A scan is told from typing by the **gap between keystrokes** — a 100ms idle timer clears the buffer,
which no human typing speed survives.

Four screens are one `ScanStation` with a different resolver behind it.

### 2. Sound is a channel, not a flourish — [`scanFeedback.ts`](components/scan/scanFeedback.ts)

The original ships eight audio files. The operator is not looking at the screen — it is on a trolley
two metres away — so every scan outcome has its own sound, and **a repeat scan is deliberately not
the error sound**, because re-scanning a parcel when you lose your place in a stack is normal.

Audio is never the only channel: it fails silently on a muted tablet, and browsers block it until the
page has been interacted with. Arming it is a visible control, and every outcome is also a visible
row.

### 3. One status enum, three meanings — [`status.ts`](status.ts)

The finding most worth reading. Inbound, returns and outbound share one enum, and each reads the same
key as a different word:

|  | inbound | return | outbound |
| --- | --- | --- | --- |
| `ongoing` | sent to warehouse | return in progress | being processed |
| `completed` | **received by warehouse** | return accepted | **handed to the courier** |

`completed` means the goods **arrived** on one screen and **left** on another, and nothing in the
record says which. Two of the three label sets also leave four of seven keys empty, because those
states cannot occur in that direction.

This is reproduced, not fixed. A reference that quietly repaired it would hide the thing most worth
seeing — and CLAUDE.md's HARD RULE 1 exists precisely so this system does not re-derive it.

### 4. The same job, answered twice

Three screens in the app run **beside** the screen they replace rather than replacing it, and in each
case both are still right:

| original | rewrite | what changed |
| --- | --- | --- |
| [`outbound`](pages/outbound/) — filter, then act | [`outbound-experimental`](pages/outbound-experimental/) — scan, and it finds itself | the parcel already knows what it is; but scanning cannot answer "what is *left*" |
| [`problem-items`](pages/problem-items/) — one row per problem | [`broken-inventory`](pages/broken-inventory/) — one row per subject | a flat list hides that four incidents share a supplier |
| [`print-barcode`](pages/print-barcode/) — one label per row | [`print-barcode-v2`](pages/print-barcode-v2/) — one label, N copies | a carton of forty identical units is the normal case |

And [`problem-inventories-retired`](pages/problem-inventories-retired/) is a **third**, unrouted
generation — charts and totals with nothing to click. Kept because the progression is the finding:
each generation moved from *reporting* a problem to being able to *act* on one.

## Layout

```
legacy_warehouse/
  status.ts        the movement vocabulary, and the warning attached to it
  fixtures.ts      invented data; the awkward cases are deliberate
  components/
    scan/          the scanner, the sounds, the station
    badges/        the direction-aware status badge
    display/       screen header, rack chip, the dashboard's overview card
  layout/          the floor shell — ONE collapsing shell, not two by breakpoint
  pages/
    <screen>/index.tsx + index.stories.tsx
    _movement/     the table shared by inbound / returns / outbound
```

## The screens

| group | screens |
| --- | --- |
| Movement (5) | `dashboard` · `inbound` · `outbound` · `outbound-experimental` · `invoices` |
| Stock (4) | `inventory-central` · `problem-items` · `broken-inventory` · `daily-stock-history` |
| Elsewhere (5) | `cash-book` · `warehouse-insight` · `team-members` · `downloads` · `settings` |
| Outside the shell (5) | `track-before-send` · `print-barcode` · `print-barcode-v2` · `print-receipt` · `login` |
| Placeholders (2) | `unfinished` (two routes land on it) · `restricted` |
| Retired (1) | `problem-inventories-retired` — not routed in the original |

## Two deliberate departures from the original

Both recorded rather than silently done:

1. **The bank-account form is not ported** ([`pages/settings/`](pages/settings/)). This repository is
   public, and payment details on a shared floor tablet is a decision for the owner, not something to
   inherit by copying.
2. **Labels are English.** The original floor app is entirely in Indonesian — which is itself a
   finding, since the selling app is mixed: the floor app speaks its operators' language and the
   selling app does not. The vocabulary is recorded in [`status.ts`](status.ts) and the screen
   comments; the UI follows this repo's convention.

## ⚠ A standing note

The floor shell here is a **third** shell, and nothing in `src/` mounts it. The live app has two
([`src/layouts/`](../layouts/)) picked by a JS breakpoint, and this one deliberately does something
different — one shell that collapses to a drawer, because its small screen is a trolley tablet and
not a phone in a hand. Both are correct; the shell follows the posture of the device.

Nothing in this folder is a decision that this system will work the same way.
