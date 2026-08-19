import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";

import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { MenuSheet } from "./MenuSheet";

// THE MORE SHEET — the mobile half that THINKS, and the desktop [Sidebar]'s opposite number.
//
// It draws the SAME menu from the same nav.ts, so what is worth pinning here is not "does the menu
// exist" (Sidebar's stories cover the menu's rules) but the three things this sheet does DIFFERENTLY,
// each of which is a deliberate trade the desktop refused:
//
//   | the sidebar does              | the sheet does                        | because                     |
//   | ----------------------------- | ------------------------------------- | --------------------------- |
//   | one group open at a time      | every group open, as sections         | a full screen has the room; |
//   |                               |                                       | collapsing costs a tap each |
//   | theme/lang/sign-out in a Menu | inline rows                           | a popup on the layer that IS |
//   |                               |                                       | the dismissal               |
//   | closes on the ROUTE changing  | closes on the TAP                     | re-tapping the screen you    |
//   |                               |                                       | are on changes no route      |
//
// ⚠ EVERYTHING IS PORTALLED. A Drawer renders at the end of <body>, so every query below is on
// `screen`, never `within(canvasElement)` — the canvas is empty by design.
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLING = teams[1]!; // Toko Melati (12)

const onClose = fn();

// A SPLAT route: the sheet renders no <Outlet/>, so this is what gives its links somewhere to land
// and lets the highlight move for real.
const at = (path: string, open = true) => {
  const route: RouteObject = { path: "*", element: <MenuSheet open={open} onClose={onClose} /> };

  return routedPage([route], path);
};

const AtHome = at("/");
const AtRestock = at("/inventories/restock");

const meta = {
  title: "Layouts/Mobile/MenuSheet",
  component: MenuSheet,
  parameters: {
    // It reads BOTH contexts — `useAuth()` for the identity in the account block, `useTeam()` for the
    // scope the whole menu is built from (and `useTeam()` throws without it).
    signedIn: true,
    // It builds its own data router (see pageStory.tsx), so the shared MemoryRouter stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  globals: { viewport: { value: "mobile2" } },
  beforeEach: asTeam(WAREHOUSE.id),
  args: { open: true, onClose },
  render: () => <AtHome />,
} satisfies Meta<typeof MenuSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const WarehouseTeam: Story = {};

export const SellingTeam: Story = {
  beforeEach: asTeam(SELLING.id),
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE SUB-MENUS ARE OPEN SECTIONS, NOT AN ACCORDION. The sidebar collapses them because a 258px
// column has no room; a full-screen sheet does, and there collapsing charges a tap for every single
// navigation — the opposite of the trade the accordion was making.
export const EveryGroupIsOpenAtOnce: Story = {
  play: async () => {
    // Both of a warehouse's Inventories children are reachable with no click anywhere…
    await waitFor(() => expect(screen.getByRole("link", { name: "Racks" })).toBeVisible());
    await expect(screen.getByRole("link", { name: "Batches" })).toBeVisible();
    // …and so is a top-level item that is not in any group, on the same screen.
    await expect(screen.getByRole("link", { name: "Profile" })).toBeVisible();
  },
};

// ⚠ IT CLOSES ON THE TAP, NOT ON THE ROUTE. The desktop drawer closes from an effect keyed on the
// pathname, which does nothing when you tap the screen you are already standing on — and a menu that
// stays up after a deliberate tap reads as the tap not having registered.
export const TappingTheCurrentScreenStillClosesIt: Story = {
  render: () => <AtRestock />,
  play: async () => {
    const restock = await screen.findByRole("link", { name: "Restock" });
    // It is the current screen: the route will not change when this is clicked.
    await waitFor(() => expect(restock).toHaveAttribute("aria-current", "page"));

    const before = onClose.mock.calls.length;
    await userEvent.click(restock);
    await waitFor(() => expect(onClose.mock.calls.length).toBe(before + 1));
  },
};

// THE ACCOUNT BLOCK IS FLAT — the two app-wide preferences and the way out, each one tap. The desktop
// hides them behind a popup on the user card; inside a sheet that is a layer to dismiss on the layer
// that IS the dismissal, and the first tap of the pair does nothing a person can see.
export const ThemeLanguageAndSignOutAreOneTapEach: Story = {
  play: async () => {
    await waitFor(() => expect(screen.getByTestId("current-user")).toHaveTextContent("ani"));
    // The role is scoped — "Warehouse Admin HERE", not a property of the person.
    await expect(screen.getByText("Warehouse Admin")).toBeInTheDocument();

    await expect(screen.getByTestId("lang-id")).toBeInTheDocument();
    await expect(screen.getByTestId("sign-out")).toBeInTheDocument();

    // Theme is ONE class on <html> (lib/colorMode.ts) — the same single line the desktop menu runs.
    await userEvent.click(screen.getByTestId("theme-dark"));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    await userEvent.click(screen.getByTestId("theme-light"));
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
  },
};

// THE CURRENT TEAM IS THE SCOPE, so the switcher is the sheet's header rather than a row in it: it
// re-scopes every screen at once, and this is the one mobile surface with room for the full card.
//
// ⚠ NOTHING HERE CLICKS ANOTHER TEAM. `selectTeam` deliberately hard-reloads to "/" (TeamContext:
// nothing from the previous team survives) — in a story that would navigate the test runner out of
// the page it is running.
export const TheTeamSwitcherIsTheHeader: Story = {
  play: async () => {
    await userEvent.click(await screen.findByTestId("team-switcher"));

    const search = await screen.findByTestId("team-search");
    await waitFor(() => expect(search).toBeVisible());
    for (const team of teams) {
      await expect(screen.getByTestId(`team-option-${team.id}`)).toBeInTheDocument();
    }
  },
};

// The mirror of the warehouse story: same component, a different team's job. Shops and the supplier
// are the selling side's; the racks and the batches are not.
export const ASellingTeamGetsTheSellingMenu: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async () => {
    await waitFor(() => expect(screen.getByRole("link", { name: "Shops" })).toBeVisible());
    await expect(screen.getByRole("link", { name: "Supplier" })).toBeVisible();
    await expect(screen.queryByRole("link", { name: "Racks" })).toBeNull();
  },
};
