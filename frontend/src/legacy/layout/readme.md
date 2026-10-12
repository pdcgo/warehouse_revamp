# `legacy/layout/` — the shell

The legacy client's chrome, rewritten for React + Chakra. **13 components, 9 story files.**

```
LegacyLayout        the assembled shell — sidebar + mobile top bar + scrolling content
├── SidebarContext  collapsed (desktop preference) / expanded (mobile drawer) / role
├── Sidebar         the rail; owns "one submenu open at a time"
│   ├── SidebarLinkGroup   a titled section, with expandable parents
│   └── SidebarLink        icon + name + count + new/beta, longest-prefix current match
├── SidebarChrome   logo · user · limit meter · collapse toggle · logout
├── MobileTopbar    hamburger↔close, brand, two portal slots
│   └── TopbarSlot  a PAGE renders its own controls into the bar
├── CheckCredential holds the shell back while the session resolves
├── ScrollTop       back-to-top, bound to the content pane
└── FormDetail      a long form with its running totals kept in view
```

## ⚠ It is a SECOND shell, and it is not the app's

The live app deliberately uses **two** shells picked by a JS breakpoint —
[`src/layouts/`](../../layouts/) mounts either `DesktopLayout` or `MobileLayout`, never both, because
rendering both gives two `<Outlet/>`s (every page mounted twice), two `navigation` landmarks, and two
of every `data-testid` the e2e reach for.

This is the legacy arrangement: **one** responsive shell whose sidebar collapses to icons on desktop
and becomes a drawer on mobile. It is internally consistent — one `aside`, one content pane, asserted
by its stories — so the conflict is *between the shells*, not inside this one.

**Nothing in `src/` mounts it.** Wiring it into the router means choosing it over the two-shell split,
which is a decision to take deliberately rather than by importing it. Either it is adopted and
`src/layouts/` goes, or the split stands and this is eventually deleted.

## Ported with changes

| | |
| --- | --- |
| **`collapsed` and `expanded` are separate state** | Desktop collapse is a sticky preference (it persists); the mobile drawer is transient and closes on every navigation. One flag cannot be both. |
| **Longest-prefix current match** | Equality un-highlights the nav the moment you open a detail page — exactly when the reader most needs it. `/` is special-cased, since as a prefix it matches everything. |
| **One submenu open at a time, lifted to `Sidebar`** | The rule is about the sidebar as a whole. Held per-group, every parent anyone expanded would stay expanded and the rail becomes a forty-item scroll. |
| **The chevron is a separate control from the link** | The parent is itself a destination, so its name must navigate and only the chevron toggles. |
| **`TopbarSlot` resolves its target in an effect** | The slot mounts in the same commit as the page, so `getElementById` is null during the page's first render. Portalling during render silently drops the content on first paint. |
| **`ScrollTop` listens to the content pane** | This shell scrolls its content area, so the document's scroll position never changes and a window listener would never fire. |

## NOT ported

**`by-permission.tsx`** — a client-side permission map fetched from a `GetV1PermissionsAll` endpoint
and consulted as `HavePermission(entity, action)`.

That is a **second, competing authorization model**. This system's ACL lives in the `.proto` files
(`request_policy` on the request message, read by the access interceptor per request), roles are read
from the database per request and never carried in the token, and UI gating is explicitly UX-only —
`lib/roles.ts` plus `SidebarLink`'s `roles` prop already cover hiding a link. Adding a parallel
permission store would give the frontend a second answer to "may I", and the two would drift.
