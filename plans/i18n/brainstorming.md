# Brainstorming — Internationalization / i18n (#65)

> Planning doc for making the UI translatable. **Nothing implemented, nothing decided.** i18n is a
> **cross-cutting frontend concern**, not a service — so it lives here under `plans/i18n/` rather than
> `plans/<service>/`. The forks below are options for the owner (HARD RULE 8); §3 is the one detail
> already settled in the issue.

> **Decisions so far**
> - **The language switcher is TOP-RIGHT, immediately before the avatar / user menu.** (owner, #65
>   body: *"language can be change in top right before avatar user section"*.)
> - Everything else is open.

---

## 1. What i18n means for THIS app (first principles)

The app and its data are **Indonesian-context**: money is rupiah (`formatRupiah` already hard-codes
`id-ID` grouping), the couriers are Indonesian, the marketplaces are Shopee / Tokopedia / Lazada /
TikTok / Blibli / Bukalapak. Yet **every UI string today is English**. The people who will actually
use the operator/CS screens are Indonesian staff.

So the realistic goal is **two first-class UI locales — Indonesian (`id`) and English (`en`)** — with
`id` a strong candidate for the *default*. That immediately forces a scope decision, because "i18n"
can mean three different things:

| Layer | Example | In scope? |
| --- | --- | --- |
| **UI chrome** — labels, buttons, headings, menu | "Save", "New order", "Orders" | **Yes** — the core of #65 |
| **Coded server values rendered by the client** | marketplace / order-status / role labels | **Yes** — already mapped client-side (`marketplaceLabel`, `roleLabel`, `OrderStatusBadge`), so they translate the same way |
| **Backend error messages** | `rpcError(err)` text shown to the user | **Fork (§2.6)** — needs either client-side translation by code or error codes from the server |
| **User-generated data** | a product's name, a customer's address | **No** — that's multilingual *content*, not i18n; out of scope |

---

## 2. The forks (open — pick with the owner)

### 2.1 Which library?

| Option | What it buys | Cost |
| --- | --- | --- |
| **react-i18next** | ubiquitous, hooks (`useTranslation`), namespaces, lazy-load per route, ICU plural via plugin | heaviest runtime; config-heavy |
| **react-intl (FormatJS)** | ICU MessageFormat native; **best number/date/currency story** (directly relevant — it subsumes `formatRupiah`) | more verbose call sites (`<FormattedMessage/>` / `intl.formatMessage`) |
| **LinguiJS** | compile-time extraction, tiny runtime, great DX (macros), ICU | smaller ecosystem; relies on a Babel/SWC macro in the Vite build |
| **Lightweight custom `t()`** | a thin lookup over JSON maps; zero deps | you re-implement plural, interpolation, lazy-load, formatting — a false economy past ~50 strings |

*Leaning:* **react-i18next** (ubiquity + first-class Vite support + the biggest hiring/knowledge pool)
**or** **react-intl** (if we want the strongest formatting story, since we already have currency/number
needs). This is the decision everything else hangs off — **answer first.**

### 2.2 Default locale + fallback

- **`id` default, `en` fallback** — matches the primary audience. Or **detect the browser** and let the
  switcher override. A logged-out `/login` has no user yet, so the default must work pre-auth.

### 2.3 Where does the chosen language persist?

| Option | Follows the user across devices? | Works before login? | Cost |
| --- | --- | --- | --- |
| **`localStorage`** | no (per-device) | yes | none — MVP |
| **On the user profile (server)** | yes | no (needs identity) | a `user_service` field + RPC |

*Leaning:* **`localStorage` now**; optionally **sync to the profile later**. The switcher sits by the
avatar (a logged-in surface), but the login screen can still honour `localStorage` / browser.

### 2.4 Catalog shape + extraction

- **Key style:** natural-language keys (`t("Save")`) — low friction, English doubles as the source —
  **vs** coded keys (`t("common.save")`) — stable under copy edits, but a parallel list to maintain.
- **Organisation:** one catalog vs per-feature namespaces (lazy-loaded).
- **Tooling:** `i18next-parser` / `lingui extract` / `formatjs extract` to pull strings from source so
  the catalog can't silently drift from the code (mirrors our "gallery generated from components" and
  "schema doc mirrors migrations" habits).

### 2.5 Number / date / currency

- `formatRupiah` currently hard-codes `id-ID`. Under i18n the **money is still always IDR** — that is a
  business truth, not a UI preference — so a common mistake to avoid is "translating" the currency when
  the UI flips to English. Decide explicitly: **money formatting stays `id-ID`/IDR regardless of UI
  language**, and only the chrome translates. Dates/relative-times *should* follow the locale.

### 2.6 Scope of server strings

- The coded labels (marketplace, order status, role) are already rendered from enums **on the client**,
  so they translate for free once a catalog exists — good.
- Backend **error messages** surfaced by `rpcError` are the open part: either the client maps known
  error **codes** to translated strings (server returns codes, not prose), or errors stay English. This
  is the one place i18n reaches across the contract — decide in/out.

---

## 3. The one settled UX detail (#65)

The **language switcher lives in the top-right app chrome, immediately before the avatar / user menu**
(part of `Layout`'s header). A compact control — a Chakra `Menu` or `Select` showing `ID` / `EN`
(optionally with a globe `Icon`). Selecting writes the persistence chosen in §2.3 and re-renders.

---

## 4. Proposed decomposition (confirm before creating issues)

1. **Choose the library + wire the provider** — locale context, fallback chain, `localStorage`
   persistence, Vite integration. (Blocks the rest.)
2. **The language switcher** — top-right, pre-avatar, + persistence (the §3 detail).
3. **Extract + translate the existing UI strings** — `id` + `en` catalogs; establish the key
   convention and the extraction script.
4. **Formatting pass** — route money/date/number through locale-aware formatters and reconcile
   `formatRupiah` (money stays IDR per §2.5).
5. *(Optional)* **persist language on the user profile** (§2.3); *(optional)* **server error-message
   i18n** (§2.6).

---

## 5. Blocker / next

i18n is **additive and low-blocker** — it can start as soon as §2.1 (library) and §2.2 (default locale)
are chosen; the rest is mechanical. The real risk is **retrofitting strings across a growing app**: the
longer we wait, the more English literals accrue in new screens. So the highest-leverage move is to
**decide the library + the key convention soon**, so every screen built from here is authored
i18n-ready rather than migrated later.

**Ask the owner:** §2.1 (library), §2.2 (default locale), §2.6 (are server error messages in scope).
