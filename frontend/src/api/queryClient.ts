import { keepPreviousData, QueryClient } from "@tanstack/react-query";

// The app's ONE QueryClient, and the conventions every query in it follows (#174).
//
// This file exists so the answers live in one place, the way `theme.ts` owns density: a default
// argued once here beats the same argument re-had in thirty `useQuery` calls, differently each time.

// ── Defaults ────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ `staleTime: 0` — ALWAYS FRESH (owner). This reverses the 30s window this file used to argue for,
// and the reasoning is worth keeping because the old argument was not wrong, it was answering a
// different question.
//
// The 30s window optimised for REQUEST COUNT: a warehouse record is changed deliberately, so re-asking
// the server a second after it answered looked like waste. What it actually bought was a window in
// which the screen can be confidently wrong — and the people using this app work in pairs, on a shared
// stock level, from a scanner and a phone at the same shelf. "The number I am reading was true half a
// minute ago" is not a property a stock count can have. Freshness here is correctness, not polish.
//
// This is only affordable because of `listQuery` below. Fresh-on-every-mount WITHOUT keeping the
// previous rows on screen would blank a table on every tab, page and filter change — trading a stale
// screen for a flickering one. The two decisions are a pair; do not adopt one without the other.
//
// `refetchOnWindowFocus: false` SURVIVES the change, because it answers a third question. This app is
// used with a warehouse scanner and a spreadsheet open beside it, so the window loses and regains
// focus constantly. A refetch on every alt-tab is a request storm nobody asked for, and staleness is
// already handled by refetching whenever the screen actually asks a question.
//
// `retry: 1` — a Connect error is usually a real answer (NotFound, PermissionDenied, a validation
// violation), not a blip. Retrying those three times delays the error message the user needs to see
// by seconds and changes nothing. One retry still covers a dropped connection.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ── Two opt-ins, because "always fresh" is not free everywhere ──────────────────────────────────
//
// Spread these into a `useQuery` rather than hand-writing the option, so the REASON travels with the
// setting and a reader can find every list or picker feed by searching for one name.

// `listQuery` — for a paginated or filtered LIST.
//
// `keepPreviousData` keeps the rows that are already on screen while the next answer loads, instead of
// dropping `data` to undefined and tearing the table down. Switching tab, turning a page or changing a
// filter then reads as the same table answering a new question, rather than as a screen that vanished.
//
// ⚠ NOT a global default, and that is the point. It is right when the key change REFINES the same
// question (page 2, the Fulfilled tab, supplier = Ani) and wrong when the key change picks a DIFFERENT
// SUBJECT — a by-id detail hook keyed on product 5 would spend a beat showing product 5's name under a
// URL that already says product 9, which reads as the wrong record having loaded. There are two dozen
// such hooks; they stay on the plain default.
//
// Pair it at the call site with `<RefreshOverlay busy={query.isFetching && !query.isPending}>`, or the
// kept rows give no sign that a newer answer is on its way.
export const listQuery = {
  placeholderData: keepPreviousData,
} as const;

// `referenceQuery` — for a PICKER FEED or a name lookup.
//
// Reference data (the teams in a dropdown, a debounced product search, a team's shops) is read to
// LABEL something, not to work from. It is re-read every time a dropdown mounts, several times per
// screen, and a stale courier name is a cosmetic problem where a stale stock count is not — so this is
// the one place the always-fresh default is bought out, deliberately and by name.
//
// Only reaches TanStack-backed feeds. `CategorySelect`, `SupplierSelect`, `RackSelect`, the four
// product pickers (they share `ProductPickerShell`) and the courier catalogue run their own
// `useEffect`/session caches and never saw `staleTime` at all — see features/shipping/catalogue.ts.
export const referenceQuery = {
  staleTime: 5 * 60_000,
} as const;

// ── Query keys ──────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE TEAM GOES IN THE KEY. ALWAYS.
//
// Almost everything here is team-scoped: the backend reads `team_id` off the request message
// (`use_scope`), so the SAME RPC with the SAME filters returns different rows for different teams.
// A key that omits the team makes those two answers share one cache entry — and one team would see
// another team's rows. That is the worst bug this app can have, and it would arrive silently: the
// screen looks right, the numbers are simply somebody else's.
//
// It is the same rule the backend already enforces on the wire. The team is part of the DATA'S
// IDENTITY, not an ambient setting — so it belongs in the key, not in a closure.
//
// The shape is `[domain, teamId, params]`:
//
//   queryKey: key.expenses(teamId, { month, kind, page, pageSize })
//
// `domain` first so `invalidateQueries({ queryKey: ["expenses"] })` clears every expense query
// regardless of team or filter — prefix matching is why the order is not arbitrary.
//
// `teamId` is a bigint, and a bigint is NOT JSON-serialisable — TanStack hashes keys with
// JSON.stringify, which throws on one. Every helper below converts it to a string, which is also why
// callers should use these helpers rather than hand-rolling an array.
type Params = Record<string, unknown> | undefined;

const scope = (domain: string, teamId: bigint | undefined, params?: Params) =>
  [domain, teamId?.toString() ?? "none", ...(params ? [params] : [])] as const;

// Global reference data — deliberately NOT team-scoped, because it is the same for everyone.
// Regions and the courier catalogue are the only things in this app that are, and they are listed
// here rather than left to judgement, so "does this need a team?" is answered by looking.
const global = (domain: string, params?: Params) =>
  [domain, ...(params ? [params] : [])] as const;

export const key = {
  expenses: (teamId: bigint | undefined, params?: Params) => scope("expenses", teamId, params),
  revenue: (teamId: bigint | undefined, params?: Params) => scope("revenue", teamId, params),
  products: (teamId: bigint | undefined, params?: Params) => scope("products", teamId, params),
  orders: (teamId: bigint | undefined, params?: Params) => scope("orders", teamId, params),
  // Drafts are their OWN domain, not a filter on orders (#195). A draft is not an order, and sharing
  // the `orders` prefix would mean promoting one invalidates every order query and vice versa —
  // which is exactly the entanglement the separate table was chosen to avoid.
  orderDrafts: (teamId: bigint | undefined, params?: Params) => scope("orderDrafts", teamId, params),
  shops: (teamId: bigint | undefined, params?: Params) => scope("shops", teamId, params),
  inventory: (teamId: bigint | undefined, params?: Params) => scope("inventory", teamId, params),
  racks: (teamId: bigint | undefined, params?: Params) => scope("racks", teamId, params),
  restock: (teamId: bigint | undefined, params?: Params) => scope("restock", teamId, params),
  suppliers: (teamId: bigint | undefined, params?: Params) => scope("suppliers", teamId, params),
  users: (teamId: bigint | undefined, params?: Params) => scope("users", teamId, params),
  teams: (teamId: bigint | undefined, params?: Params) => scope("teams", teamId, params),
  liability: (teamId: bigint | undefined, params?: Params) => scope("liability", teamId, params),
  settlement: (teamId: bigint | undefined, params?: Params) => scope("settlement", teamId, params),

  // No team: global reference data (see `global` above).
  regions: (params?: Params) => global("regions", params),
  shipping: (params?: Params) => global("shipping", params),
  categories: (params?: Params) => global("categories", params),
} as const;

// ── Where query hooks live ──────────────────────────────────────────────────────────────────────
//
// Beside the screens that use them — `src/expenses/queries.ts`, `src/orders/queries.ts` — not in a
// central `src/api/queries/`. A central directory becomes a file every feature edits, and it
// separates a query from the component whose needs shape it. The convention lives here; the queries
// live with their screens.
