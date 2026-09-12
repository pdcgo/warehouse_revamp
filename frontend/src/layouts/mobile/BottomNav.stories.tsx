import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { BottomNav } from "./BottomNav";

// THE BOTTOM TAB BAR — the mobile shell's only one-tap navigation, and therefore the only place a
// wrong answer costs a person real time:
//
//   | it reads          | and decides                                                             |
//   | ----------------- | ----------------------------------------------------------------------- |
//   | the team's TYPE   | which three destinations — a warehouse's Restock vs a seller's Products  |
//   | the caller's ROLE | that it never offers a screen this person's menu does not contain        |
//   | the current ROUTE | which single tab is lit, More included                                    |
//
// ⚠ THE THREE ARE A DECISION, NOT THE FIRST THREE MENU ENTRIES. A bar is what a thumb reaches all
// day; a reference screen belongs in More. The stories below pin the choice per team type, because a
// bar that quietly follows menu ORDER would change the day's work every time the sidebar is reordered.
//
// ⚠ HIDING A TAB IS UX, NOT SECURITY — same as the sidebar. The server's access interceptor is the
// only thing that stops a call.
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLING = teams[1]!; // Toko Melati (12)

const onMenuOpen = fn();

// A SPLAT route: the bar renders no <Outlet/>, so there is nothing to put under it — this way every
// tab lands somewhere, the bar re-renders with the new location, and its lit tab moves for real.
const at = (path: string, menuOpen = false) => {
  const route: RouteObject = {
    path: "*",
    element: <BottomNav menuOpen={menuOpen} onMenuOpen={onMenuOpen} />,
  };

  return routedPage([route], path);
};

const AtHome = at("/");
const AtDiscover = at("/products/discover");
const AtUsers = at("/users");
const AtHomeWithMenuOpen = at("/", true);

const meta = {
  title: "Layouts/Mobile/BottomNav",
  component: BottomNav,
  parameters: {
    // `useTeam()` is the scope the whole bar is built from, and it throws outside the provider.
    signedIn: true,
    // It builds its own data router (see pageStory.tsx), so the shared MemoryRouter stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  globals: { viewport: { value: "mobile2" } },
  beforeEach: asTeam(WAREHOUSE.id),
  // The props, for the docs table. The values the component receives come from the routed wrapper
  // built at module scope (`at` above) — a router cannot be rebuilt per render without resetting the
  // navigation these stories assert on — so `menuOpen` is varied by picking a different wrapper.
  args: { menuOpen: false, onMenuOpen },
  render: () => <AtHome />,
} satisfies Meta<typeof BottomNav>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const WarehouseTeam: Story = {};

export const SellingTeam: Story = {
  beforeEach: asTeam(SELLING.id),
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE BAR IS THE TEAM'S DAY. A warehouse crew packs orders and receives restocks; the catalogue is a
// reference they open occasionally, so it goes to More.
export const AWarehouseGetsTheWarehousesTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByRole("link", { name: "Home" })).toBeInTheDocument());
    // ⚠ THE ROUTE, not the word: both team types say "Orders" (nav.ts — it is the same subject read
    // from the other end), so only the href tells the two bars apart.
    await expect(canvas.getByRole("link", { name: "Orders" })).toHaveAttribute(
      "href",
      "/warehouse-orders",
    );
    await expect(canvas.getByRole("link", { name: "Restock" })).toBeInTheDocument();
    await expect(canvas.getByTestId("bottom-nav-more")).toBeInTheDocument();
  },
};

// The mirror of it — a selling team takes orders from a catalogue it curates, and never touches a
// rack. Its Restock is a request it raises rather than a queue it works, so it lives in More.
export const ASellingTeamGetsTheSellingTabs: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/orders"),
    );
    // "Products", not the menu's "My Product" — the bar labels its own tabs, because the group child's
    // name reads as a narrower screen than the one it opens.
    await expect(canvas.getByRole("link", { name: "Products" })).toHaveAttribute(
      "href",
      "/products",
    );
    await expect(canvas.queryByRole("link", { name: "Restock" })).toBeNull();
  },
};

// ⚠ THE HIGHLIGHT IS MATCHED AGAINST THE BAR, NOT THE MENU. /products/discover is a menu item of its
// own, so the menu's winner there is a route the bar does not carry — matching against the menu would
// leave every sub-route with no lit tab at all.
export const ASubRouteStillLightsItsTab: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDiscover />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const products = await canvas.findByRole("link", { name: "Products" });
    await waitFor(() => expect(products).toHaveAttribute("aria-current", "page"));
    await expect(canvas.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  },
};

// EXACTLY ONE TAB IS LIT, ALWAYS — More owns everywhere the other three do not. A bar with nothing
// lit reads as having fallen out of the app, and it is the state most of the menu leads to.
export const MoreOwnsEverywhereTheTabsDoNot: Story = {
  render: () => <AtUsers />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("bottom-nav-more")).toHaveAttribute("data-active"));
    await expect(canvas.getByRole("link", { name: "Home" })).not.toHaveAttribute("data-active");
  },
};

// ⚠ EVERY TAB'S CONTENT IS CENTRED IN ITS OWN SLOT, and this is checked in PIXELS because nothing
// else can see it. The tabs divide the bar evenly on their own; what went wrong was one level in —
// the icon+label box was shrink-to-fit and packed to the START of its column, so a 24px label sat at
// the left edge of a 98px slot and the whole bar read as shifted. Every text, href, role and
// `data-active` assertion in this file passed the entire time it was broken.
export const EachTabIsCentredInItsSlot: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await canvas.findByTestId("bottom-nav");

    for (const tab of Array.from(bar.children)) {
      const slot = tab.getBoundingClientRect();
      // The icon is the tab's visual anchor — if it is centred, the column it lives in is too.
      const icon = tab.querySelector("svg")!.getBoundingClientRect();
      const drift = Math.abs(icon.x + icon.width / 2 - (slot.x + slot.width / 2));

      await expect(drift).toBeLessThanOrEqual(1);
    }
  },
};

// THE SHEET IS THE CALLER'S (MobileLayout owns the state, because a link inside the sheet closes it).
// This is the CONTRACT half: the tab asks, and it lights itself while the sheet is up so the bar keeps
// naming what is on screen.
export const TheMoreTabAsksTheCallerToOpenTheSheet: Story = {
  render: () => <AtHomeWithMenuOpen />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const more = await canvas.findByTestId("bottom-nav-more");

    // Open: More is lit even though we are standing on Home, and it says so to a screen reader.
    await expect(more).toHaveAttribute("data-active");
    await expect(more).toHaveAttribute("aria-expanded", "true");

    const before = onMenuOpen.mock.calls.length;
    await userEvent.click(more);
    await waitFor(() => expect(onMenuOpen.mock.calls.length).toBe(before + 1));
  },
};
