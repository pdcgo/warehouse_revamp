import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { Sidebar } from "./Sidebar";

// THE SIDEBAR — the half of the shell that THINKS.
//
// Everything it draws is computed, and every one of those computations can go wrong while the
// sidebar still looks perfectly normal:
//
//   | it reads             | and decides                                                        |
//   | -------------------- | ------------------------------------------------------------------ |
//   | the team's TYPE      | which menu — a warehouse's Racks/Batches vs a seller's Shops        |
//   | the caller's ROLE    | whether the money and membership items are offered at all           |
//   | the current ROUTE    | which single item is lit, and which group opens itself              |
//
// ⚠ HIDING A MENU ITEM IS UX, NOT SECURITY. Every rule here is about what a person is shown; the
// server's access interceptor is the only thing that stops a call. Nothing below may ever be read as
// a permission check.
//
// The team is chosen by planting the current-team key before the providers mount (`asTeam`) — the
// same thing the team switcher does. The sidebar has no prop for it, and should not: the whole app is
// scoped by that one selection.

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLING = teams[1]!; // Toko Melati (12)

// The drawer state is the CALLER'S (Layout owns it, because the hamburger is in the top bar), so a
// story passes it in — which is exactly how the backdrop rule below can be checked as a contract
// rather than through a whole shell.
const onClose = fn();

// A SPLAT route, rather than the parent/child pair a page story uses: the sidebar renders no
// <Outlet/>, so nothing would ever show under it. This way every link in the menu lands somewhere,
// the sidebar re-renders with the new location, and its active item moves for real.
const at = (path: string, open = false) => {
  const route: RouteObject = { path: "*", element: <Sidebar open={open} onClose={onClose} /> };

  return routedPage([route], path);
};

const AtHome = at("/");
const AtDiscover = at("/products/discover");
const AtDrafts = at("/order-drafts");
const AtHomeWithDrawerOpen = at("/", true);

// A nav link found by its ROUTE rather than by its role.
//
// ⚠ THIS IS THE ONLY WAY TO ASSERT A GROUP IS SHUT. A closed group keeps its children MOUNTED (an
// unmounted list has no height for the drawer to animate from) and hides them with `visibility`,
// which takes them out of the accessibility tree — so `getByRole("link", { name: "Restock" })` cannot
// find them, and neither can `{ hidden: true }`, because a hidden subtree contributes no accessible
// name to match on. The anchor is still in the DOM, and it is the same node the visible assertions
// used, so `not.toBeVisible()` on it says exactly what it means.
const linkTo = (canvasElement: HTMLElement, to: string) =>
  canvasElement.querySelector<HTMLAnchorElement>(`a[href="${to}"]`)!;

const meta = {
  title: "Layouts/Desktop/Sidebar",
  component: Sidebar,
  parameters: {
    // It reads BOTH contexts — `useAuth()` for the identity in the user card, `useTeam()` for the
    // scope the entire menu is built from (and `useTeam()` throws without it).
    signedIn: true,
    // It builds its own data router (see pageStory.tsx), so the shared MemoryRouter stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(WAREHOUSE.id),
  // The props, for the docs table. The values the component actually receives come from the routed
  // wrapper built at module scope (`at` above) — a router cannot be rebuilt per render without
  // resetting the very navigation these stories assert on — so `open` is varied by picking a
  // different wrapper rather than by an arg.
  args: { open: false, onClose },
  render: () => <AtHome />,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

// A warehouse crew's sidebar: a flat Products list, Orders meaning "shipping from this building", and
// an Inventories group holding the shelves, the batches and the count.
export const WarehouseTeam: Story = {};

// The same component for a selling team — a different menu entirely.
export const SellingTeam: Story = {
  beforeEach: asTeam(SELLING.id),
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE MENU IS THE TEAM'S JOB, not a fixed list with things greyed out. A warehouse holds racks and
// batches and never types an order; offering it Shops would be offering it somebody else's work.
export const AWarehouseGetsTheWarehousesMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Products is a plain LINK here — the My Product / Discover Product split is a selling team's.
    await waitFor(() => expect(canvas.getByRole("link", { name: "Products" })).toBeInTheDocument());
    await expect(canvas.getByRole("link", { name: "Orders" })).toHaveAttribute(
      "href",
      "/warehouse-orders",
    );

    // A warehouse's own Inventories children.
    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.inventories"));
    for (const label of ["Racks", "Batches", "Stock Opname", "Returns"]) {
      await waitFor(() => expect(canvas.getByRole("link", { name: label })).toBeVisible());
    }

    // …and none of the selling side's.
    await expect(canvas.queryByRole("link", { name: "Shops" })).toBeNull();
    await expect(canvas.queryByRole("link", { name: "Supplier" })).toBeNull();
  },
};

// The mirror of it. Both menus say "Orders" and both say "Products" on purpose — it is the same
// subject read from the other end (nav.ts) — so the difference is the ROUTE and the CHILDREN, which
// is exactly what a story has to check rather than the words.
export const ASellingTeamGetsTheSellingMenu: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByRole("link", { name: "Shops" })).toBeInTheDocument());
    await expect(canvas.getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/orders");

    // Products is a GROUP here, so there is no link by that name — its children carry the routes.
    await expect(canvas.queryByRole("link", { name: "Products" })).toBeNull();
    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.products"));
    await waitFor(() => expect(canvas.getByRole("link", { name: "My Product" })).toBeVisible());
    await expect(canvas.getByRole("link", { name: "Discover Product" })).toBeVisible();

    // A supplier belongs to the team that raises the restock, a rack to the building that holds it.
    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.inventories"));
    await waitFor(() => expect(canvas.getByRole("link", { name: "Supplier" })).toBeVisible());
    await expect(canvas.queryByRole("link", { name: "Racks" })).toBeNull();
  },
};

// ⚠ ONE WINNER, and it is the LONGEST matching prefix (#119). "/products" is a prefix of
// "/products/discover", so a naive match lights both and the sidebar stops telling you where you
// are — while a detail route like /products/123 must still light its parent.
export const OnlyTheLongestMatchingRouteIsActive: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDiscover />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const discover = await canvas.findByRole("link", { name: "Discover Product" });
    await waitFor(() => expect(discover).toHaveAttribute("aria-current", "page"));
    await expect(canvas.getByRole("link", { name: "My Product" })).not.toHaveAttribute(
      "aria-current",
    );
  },
};

// A screen reached from INSIDE a page is still that menu item's screen (`alsoMatches`). Drafts has
// its own route but no menu item of its own, so without the claim it would light nothing — which
// reads as having fallen out of the app.
export const AClaimedRouteStillLightsItsMenuItem: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDrafts />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const orders = await canvas.findByRole("link", { name: "Orders" });
    await waitFor(() => expect(orders).toHaveAttribute("aria-current", "page"));
  },
};

// …and the group holding the winner OPENS ITSELF. With only one group allowed open (#123), landing
// on a sub-menu route with every group shut would hide the very item that is highlighted — the app
// would be telling you where you are somewhere you cannot see.
export const TheGroupHoldingTheActiveRouteOpensItself: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDiscover />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // No click anywhere: the group is open because of where we are standing.
    await waitFor(() => expect(canvas.getByRole("link", { name: "Discover Product" })).toBeVisible());
    // The other group is still shut — opening the owning one is not opening everything.
    await expect(linkTo(canvasElement, "/inventories/restock")).not.toBeVisible();
  },
};

// THE GROUPS ARE AN ACCORDION (#123): at most one open, so the sidebar never becomes a wall of links
// that pushes the item you were reaching for off the bottom.
export const OpeningAGroupClosesTheOther: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("nav-group-toggle-nav.products"));
    await waitFor(() => expect(canvas.getByRole("link", { name: "My Product" })).toBeVisible());

    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.inventories"));
    await waitFor(() => expect(canvas.getByRole("link", { name: "Restock" })).toBeVisible());
    // The drawer transitions `visibility`, so the hidden state arrives a beat after the click.
    await waitFor(() => expect(linkTo(canvasElement, "/products")).not.toBeVisible());

    // Clicking the open one shuts it, leaving nothing open.
    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.inventories"));
    await waitFor(() => expect(linkTo(canvasElement, "/inventories/restock")).not.toBeVisible());
  },
};

// The user card is the identity AND the scope's role — "Warehouse Admin here", not "Warehouse Admin"
// as a property of the person. Its menu opens UPWARD (it sits at the sidebar foot, with nowhere below
// to go) and carries the two app-wide preferences plus the way out.
export const TheAccountMenuCarriesThemeLanguageAndSignOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("current-user")).toHaveTextContent("ani"));
    await expect(canvas.getByText("Warehouse Admin")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("user-menu"));

    // The menu is PORTALLED, so it is on `screen` rather than in the canvas.
    const dark = await screen.findByTestId("theme-dark");
    await waitFor(() => expect(dark).toBeVisible());
    await expect(screen.getByTestId("lang-id")).toBeInTheDocument();
    await expect(screen.getByTestId("sign-out")).toBeInTheDocument();

    // Theme is ONE class on <html> (lib/colorMode.ts) — the same single line the toolbar switch runs.
    await userEvent.click(dark);
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  },
};

// THE CURRENT TEAM IS THE SCOPE, so the switcher is the highest-consequence control in the shell: it
// re-scopes every screen at once. It lists every membership, searchable, with the current one ticked.
//
// ⚠ NOTHING HERE CLICKS ANOTHER TEAM. `selectTeam` deliberately hard-reloads to "/" (TeamContext:
// correctness by construction, nothing from the previous team survives) — in a story that would
// navigate the whole test runner out of the page it is running.
export const TheTeamSwitcherListsEveryTeamAndMarksTheCurrentOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("team-switcher"));

    // A centred Dialog, portalled out of the sidebar.
    const search = await screen.findByTestId("team-search");
    await waitFor(() => expect(search).toBeVisible());
    for (const team of teams) {
      await expect(screen.getByTestId(`team-option-${team.id}`)).toBeInTheDocument();
    }

    await userEvent.type(search, SELLING.name, { delay: 40 });
    await waitFor(() => expect(screen.queryByTestId(`team-option-${WAREHOUSE.id}`)).toBeNull());
    await expect(screen.getByTestId(`team-option-${SELLING.id}`)).toBeInTheDocument();
  },
};

// THE BACKDROP IS THE SIDEBAR'S, THE HAMBURGER IS THE SHELL'S (#214). On a narrow screen the sidebar
// sits OVER the page, so an outside tap has to be able to dismiss it — that gesture is the one people
// try first, and without a target for it the only way out is the link you did not want.
//
// This is the CONTRACT half: the backdrop calls `onClose`, and the caller decides what that means.
// The other half — the hamburger opening it, and navigating closing it — is pinned in the shell's own
// stories, where both ends actually exist.
export const TheBackdropAsksTheCallerToClose: Story = {
  render: () => <AtHomeWithDrawerOpen />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const backdrop = await canvas.findByTestId("sidebar-backdrop");
    // ⚠ A DELTA, not an absolute count: the route effect fires once on mount (mounting IS arriving
    // somewhere), so `onClose` has already been called before the story touches anything.
    const before = onClose.mock.calls.length;

    await userEvent.click(backdrop);
    await waitFor(() => expect(onClose.mock.calls.length).toBe(before + 1));
  },
};
