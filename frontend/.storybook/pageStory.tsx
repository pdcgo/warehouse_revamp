import { useMemo } from "react";

import type { RouteObject } from "react-router-dom";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Text } from "@chakra-ui/react";

import { CURRENT_TEAM_KEY } from "../src/features/team/TeamContext";

// The two things every PAGE story needs and no component story does.
//
// A page is not a component with more props: it navigates, and it reads the current team. Both of
// those are context the story has to supply, and both were about to be copy-pasted into the second
// page story that needed them — so they live here once.

// ── Which team is standing in front of the screen ───────────────────────────────────────────────

/**
 * A `beforeEach` that makes `teamId` the CURRENT team.
 *
 * TeamProvider restores its selection from sessionStorage before falling back to the first
 * membership, so planting the key is how a story chooses which team it is — the alternative would be
 * a Storybook-only prop on a page that has none, or reordering the fixtures until the right team
 * happened to be first.
 *
 * ⚠ IT MUST BE A `beforeEach`, NOT A DECORATOR. `preview.tsx` clears sessionStorage in its own
 * `beforeEach` (so one story cannot leave the next one on its team), and project hooks run BEFORE
 * component and story ones — a decorator would run later still, after TeamProvider had already read
 * an empty key and settled on the default.
 */
export function asTeam(teamId: bigint) {
  return () => {
    window.sessionStorage.setItem(CURRENT_TEAM_KEY, teamId.toString());
  };
}

// ── Where the page can navigate to ──────────────────────────────────────────────────────────────

/**
 * Build a page's own router, ONCE, at module scope:
 *
 * ```ts
 * const Routed = routedPage([{ path: "/orders", element: <OrdersPage /> }, marker("/orders/:id", "at-order")], "/orders")
 * ```
 *
 * Storybook calls `render` on every re-render, so a router built inline would be a fresh one each
 * time — and with it a fresh history, resetting the very navigation the story is asserting on.
 *
 * The page mounts under a DATA router, which means the story must also set
 * `parameters: { dataRouter: true }` so `preview.tsx` stands its shared `<MemoryRouter>` down —
 * react-router refuses to render one router inside another.
 */
export function routedPage(routes: RouteObject[], initialEntry: string) {
  return function RoutedPage() {
    const router = useMemo(
      () => createMemoryRouter(routes, { initialEntries: [initialEntry] }),
      // Both are module-scope arguments, so this memo holds for the life of the story.
      [],
    );

    return <RouterProvider router={router} />;
  };
}

/**
 * A destination, stubbed as a marker: `marker("/orders/:orderId", "at-order-detail")`.
 *
 * A story asserts it ARRIVED. Mounting the real destination page instead would make this a test of
 * THAT page's queries — and a failure there would be reported against this screen.
 */
export function marker(path: string, testId: string): RouteObject {
  return { path, element: <Text data-testid={testId}>{testId}</Text> };
}
