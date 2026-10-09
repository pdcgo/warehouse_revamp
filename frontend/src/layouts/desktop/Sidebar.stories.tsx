import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

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

// A SPLAT route, rather than the parent/child pair a page story uses: the sidebar renders no
// <Outlet/>, so nothing would ever show under it. This way every link in the menu lands somewhere,
// the sidebar re-renders with the new location, and its active item moves for real.
const at = (path: string) => {
  const route: RouteObject = { path: "*", element: <Sidebar /> };

  return routedPage([route], path);
};

const AtHome = at("/");
const AtDiscover = at("/products/discover");
const AtDrafts = at("/order-drafts");

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
    await expect(canvas.queryByRole("link", { name: "My Supplier" })).toBeNull();
    await expect(canvas.queryByRole("link", { name: "Discover Supplier" })).toBeNull();
    await expect(canvas.queryByRole("link", { name: "Supplier Report" })).toBeNull();
    await expect(canvas.queryByTestId("nav-group-toggle-nav.suppliers")).toBeNull();
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

    // A rack belongs to the building that holds it, not to the team that raises the restock.
    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.inventories"));
    await waitFor(() => expect(canvas.getByRole("link", { name: "Placements" })).toBeVisible());
    await expect(canvas.queryByRole("link", { name: "Racks" })).toBeNull();

    // Suppliers is a group of its own, shaped like Products: My Supplier, Discover Supplier, Supplier Report.
    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.suppliers"));
    await waitFor(() => expect(canvas.getByRole("link", { name: "My Supplier" })).toBeVisible());
    await expect(canvas.getByRole("link", { name: "Discover Supplier" })).toHaveAttribute(
      "href",
      "/inventories/suppliers/discover",
    );
    // …and the report that ranks them (the-figures-are-a-statistics-tab-and-a-supplier-report).
    await expect(canvas.getByRole("link", { name: "Supplier Report" })).toHaveAttribute(
      "href",
      "/inventories/suppliers/report",
    );
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
    const theme = await screen.findByTestId("theme-switch");
    await waitFor(() => expect(theme).toBeVisible());
    await expect(screen.getByTestId("lang-switch")).toHaveTextContent("EN");
    await expect(screen.getByTestId("sign-out")).toBeInTheDocument();

    // Theme is ONE class on <html> (lib/colorMode.ts) — the same single line the toolbar switch runs. The ROW is the
    // control (the-account-menu-switches-theme-and-language), and the menu stays open to show the change.
    await userEvent.click(theme);
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    await expect(screen.getByTestId("theme-switch")).toBeVisible();
    await userEvent.click(screen.getByTestId("theme-switch"));
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
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

    // A panel under the card, portalled out of the sidebar (the-workspace-opens-under-its-card).
    const panel = await screen.findByTestId("team-switcher-panel");
    await waitFor(() => expect(panel).toBeVisible());
    for (const team of teams) {
      await expect(screen.getByTestId(`team-option-${team.id}`)).toBeInTheDocument();
    }

    // Searched from the heading's icon, the field opening under it (the-workspace-search-opens-under-its-heading).
    await userEvent.click(screen.getByTestId("team-search-mine"));
    const search = await screen.findByTestId("team-search");
    await userEvent.type(search, SELLING.name, { delay: 40 });
    await waitFor(() => expect(screen.queryByTestId(`team-option-${WAREHOUSE.id}`)).toBeNull());
    await expect(screen.getByTestId(`team-option-${SELLING.id}`)).toBeInTheDocument();
  },
};

// THE MENU IS IN SECTIONS (owner, `the-sidebar-is-in-sections`) — Home leads with no heading, then the team's work,
// its money and its people, each under a small heading. Profile is the person's, so it is in the user card instead.
export const TheMenuIsInSections: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("link", { name: "Shops" })).toBeInTheDocument());

    const sections = Array.from(canvasElement.querySelectorAll("[data-testid^='nav-section-']"));
    await expect(sections.map((s) => s.getAttribute("data-testid"))).toEqual([
      "nav-section-lead",
      "nav-section-nav.sectionOperations",
      "nav-section-nav.sectionFinance",
      "nav-section-nav.sectionTeam",
    ]);

    const operations = within(canvas.getByTestId("nav-section-nav.sectionOperations"));
    await expect(operations.getByText("Operations")).toBeVisible();
    await expect(operations.getByRole("link", { name: "Shops" })).toBeInTheDocument();
    const finance = within(canvas.getByTestId("nav-section-nav.sectionFinance"));
    await expect(finance.getByRole("link", { name: "Accounts" })).toBeInTheDocument();
    const team = within(canvas.getByTestId("nav-section-nav.sectionTeam"));
    await expect(team.getByRole("link", { name: "Users" })).toBeInTheDocument();

    await expect(canvas.queryByRole("link", { name: "Profile" })).toBeNull();
  },
};

// A WAREHOUSE's Inventories is in its operations, beside its orders — it sat under the money while the menu was one
// column, where stock read as a footnote to the books rather than the job.
export const AWarehousesInventoriesIsInItsOperations: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const operations = within(await canvas.findByTestId("nav-section-nav.sectionOperations"));

    await expect(operations.getByTestId("nav-group-nav.inventories")).toBeInTheDocument();
    await expect(operations.getByRole("link", { name: "Orders" })).toBeInTheDocument();
  },
};

// THE COUNT ON KEWAJIBAN — payments waiting for this team to confirm. Gudang Pusat has one: Toko Melati's transfer
// of 2.000.000, recorded and not yet confirmed (fixtures, liabilityPayments 602).
export const LiabilityCountsWhatAwaitsConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const count = await canvas.findByTestId("nav-count-/liability", {}, { timeout: 4000 });
    await expect(count).toHaveTextContent("1");
    // Nothing else counts — a 0 is never drawn.
    await expect(canvasElement.querySelectorAll("[data-testid^='nav-count-']")).toHaveLength(1);
  },
};

// Profile from the user card — the person's page, beside their theme and language.
export const ProfileIsInTheUserCard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("user-menu"));
    const profile = await screen.findByTestId("user-menu-profile");
    await waitFor(() => expect(profile).toBeVisible());
    await expect(profile).toHaveTextContent("Profile");
    await userEvent.click(profile);
    await waitFor(() => expect(screen.queryByTestId("user-menu-profile")).toBeNull());
  },
};

// A SUB-MENU ITEM HAS NO ICON (owner, provisional, `a-submenu-item-has-no-icon`) — the icon is the front level's: the
// group header keeps its own, and a top-level item keeps its own. Under the rail a child is its name alone.
export const ASubmenuItemHasNoIcon: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDiscover />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const discover = await canvas.findByRole("link", { name: "Discover Product" });
    await waitFor(() => expect(discover).toBeVisible());
    await expect(discover.querySelector("svg")).toBeNull();
    await expect(canvas.getByRole("link", { name: "My Product" }).querySelector("svg")).toBeNull();

    await expect(canvas.getByTestId("nav-group-toggle-nav.products").querySelector("svg")).not.toBeNull();
    await expect(canvas.getByRole("link", { name: "Shops" }).querySelector("svg")).not.toBeNull();
  },
};

// ── Collapsed (`the-sidebar-collapses-to-its-icons`) ────────────────────────────────────────────

const sidebarWidth = (canvas: ReturnType<typeof within>) =>
  Math.round(canvas.getByTestId("sidebar").getBoundingClientRect().width);

// THE SIDEBAR COLLAPSES TO ITS ICONS (owner) — the « in the logo row takes it to 64px: a section's heading becomes a
// line, an item its icon (its name kept for a screen reader and shown in a tooltip). The choice is remembered.
export const TheSidebarCollapsesToItsIcons: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("link", { name: "Shops" })).toBeVisible());
    await waitFor(() => expect(sidebarWidth(canvas)).toBe(258));

    await userEvent.click(canvas.getByTestId("sidebar-toggle"));
    await waitFor(() => expect(sidebarWidth(canvas)).toBe(64));
    await expect(canvas.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByText("Operations")).toBeNull();
    const shops = canvas.getByRole("link", { name: "Shops" });
    await expect(shops).not.toHaveTextContent("Shops");
    await expect(localStorage.getItem("wh-sidebar-collapsed")).toBe("1");

    // A tooltip names the icon.
    await userEvent.hover(shops);
    await waitFor(() => expect(screen.getByText("Shops")).toBeVisible());

    await userEvent.click(canvas.getByTestId("sidebar-toggle"));
    await waitFor(() => expect(sidebarWidth(canvas)).toBe(258));
    await expect(localStorage.getItem("wh-sidebar-collapsed")).toBe("0");
  },
};

// …remembered: a browser that collapsed it opens collapsed.
export const ACollapsedSidebarStaysCollapsed: Story = {
  beforeEach: () => {
    asTeam(SELLING.id)();
    localStorage.setItem("wh-sidebar-collapsed", "1");
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("link", { name: "Shops" })).toBeInTheDocument());
    await expect(sidebarWidth(canvas)).toBe(64);
  },
};

// Ctrl+B toggles it — but not while somebody is typing in a field.
export const CtrlBTogglesTheSidebar: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("link", { name: "Shops" })).toBeVisible());

    await userEvent.keyboard("{Control>}b{/Control}");
    await waitFor(() => expect(sidebarWidth(canvas)).toBe(64));
    await userEvent.keyboard("{Control>}b{/Control}");
    await waitFor(() => expect(sidebarWidth(canvas)).toBe(258));

    // In the team switcher's search box, Ctrl+B is the field's.
    await userEvent.click(canvas.getByTestId("team-switcher"));
    await userEvent.click(await screen.findByTestId("team-search-mine"));
    const search = await screen.findByTestId("team-search");
    await userEvent.click(search);
    await userEvent.keyboard("{Control>}b{/Control}");
    await expect(sidebarWidth(canvas)).toBe(258);
  },
};

// COLLAPSED, A GROUP OPENS A FLYOUT — on a click, never a hover: its name and its children, by name and without
// icons (`a-submenu-item-has-no-icon`). Escape shuts it; so does going somewhere.
export const ACollapsedGroupOpensAFlyout: Story = {
  beforeEach: () => {
    asTeam(SELLING.id)();
    localStorage.setItem("wh-sidebar-collapsed", "1");
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("nav-group-toggle-nav.products"));
    const flyout = await screen.findByTestId("nav-flyout-nav.products");
    await waitFor(() => expect(flyout).toBeVisible());
    await expect(flyout).toHaveTextContent("Products");
    const mine = within(flyout).getByRole("link", { name: "My Product" });
    await expect(mine.querySelector("svg")).toBeNull();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("nav-flyout-nav.products")).toBeNull());

    // Going somewhere from it closes it.
    await userEvent.click(canvas.getByTestId("nav-group-toggle-nav.products"));
    const reopened = await screen.findByTestId("nav-flyout-nav.products");
    await userEvent.click(await within(reopened).findByRole("link", { name: "Discover Product" }));
    await waitFor(() => expect(screen.queryByTestId("nav-flyout-nav.products")).toBeNull());
  },
};

// Collapsed, Kewajiban's count rides its icon's corner — Gudang Pusat's one payment awaiting confirmation.
export const ACollapsedCountRidesTheIcon: Story = {
  beforeEach: () => {
    localStorage.setItem("wh-sidebar-collapsed", "1");
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const count = await canvas.findByTestId("nav-count-/liability", {}, { timeout: 4000 });
    await expect(count).toHaveTextContent("1");
    await expect(canvas.getByRole("link", { name: "Liability" })).toContainElement(count);
  },
};

// THE WORKSPACE OPENS UNDER ITS CARD (owner: *"workspace, di panel aja langsung di bawahnya"*,
// `the-workspace-opens-under-its-card`) — a panel straight below the switcher, as wide as it; not a dialog in the
// middle of the screen.
export const TheWorkspaceOpensUnderItsCard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const card = await canvas.findByTestId("team-switcher", {}, { timeout: 4000 });
    await userEvent.click(card);
    const panel = await screen.findByTestId("team-switcher-panel");
    await waitFor(() => expect(panel).toBeVisible());
    // Not the centred dialog — no backdrop dims the page.
    await expect(document.querySelector("[data-scope='dialog'][data-part='backdrop']")).toBeNull();

    const c = card.getBoundingClientRect();
    // Measured once the panel has finished growing in — it opens with a scale.
    await waitFor(() => {
      const p = panel.getBoundingClientRect();
      expect(Math.round(p.top - c.bottom)).toBe(6);
      expect(Math.round(p.left)).toBe(Math.round(c.left));
      expect(Math.round(p.width)).toBe(Math.round(c.width));
    });

    // ⚠ Not by picking a team — a pick hard-reloads the app (switching re-scopes everything), which a story
    // cannot survive. Escape closes it, as an outside click does.
    await expect(within(panel).getByTestId(`team-option-${SELLING.id}`)).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("team-switcher-panel")).toBeNull());
  },
};

// …and collapsed, beside the avatar, to the right of the rail.
export const ACollapsedWorkspaceOpensBesideTheRail: Story = {
  beforeEach: () => {
    localStorage.setItem("wh-sidebar-collapsed", "1");
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("team-switcher", {}, { timeout: 4000 }));
    const panel = await screen.findByTestId("team-switcher-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await waitFor(() =>
      expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(canvas.getByTestId("sidebar").getBoundingClientRect().right),
    );
  },
};
