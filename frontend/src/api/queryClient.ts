import { QueryClient } from "@tanstack/react-query";

// The app's ONE QueryClient, and the conventions every query in it follows (#174).
//
// This file exists so the answers live in one place, the way `theme.ts` owns density: a default
// argued once here beats the same argument re-had in thirty `useQuery` calls, differently each time.

// ── Defaults ────────────────────────────────────────────────────────────────────────────────────
//
// `staleTime: 0` is TanStack's default and is wrong for this app. Every list here is a warehouse
// record that a person changed deliberately — stock, orders, teams — not a live feed. Refetching the
// instant a component remounts means a back-navigation hits the server for data that was correct a
// second ago. Thirty seconds is short enough that nobody works from a stale screen and long enough
// that moving between two pages is free.
//
// `refetchOnWindowFocus: false` for the same reason, and one more: this app is used with a warehouse
// scanner and a spreadsheet open beside it, so the window loses and regains focus constantly. A
// refetch on every alt-tab is a request storm that answers a question nobody asked.
//
// `retry: 1` — a Connect error is usually a real answer (NotFound, PermissionDenied, a validation
// violation), not a blip. Retrying those three times delays the error message the user needs to see
// by seconds and changes nothing. One retry still covers a dropped connection.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

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
  shops: (teamId: bigint | undefined, params?: Params) => scope("shops", teamId, params),
  inventory: (teamId: bigint | undefined, params?: Params) => scope("inventory", teamId, params),
  racks: (teamId: bigint | undefined, params?: Params) => scope("racks", teamId, params),
  restock: (teamId: bigint | undefined, params?: Params) => scope("restock", teamId, params),
  suppliers: (teamId: bigint | undefined, params?: Params) => scope("suppliers", teamId, params),
  users: (teamId: bigint | undefined, params?: Params) => scope("users", teamId, params),
  teams: (teamId: bigint | undefined, params?: Params) => scope("teams", teamId, params),

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
