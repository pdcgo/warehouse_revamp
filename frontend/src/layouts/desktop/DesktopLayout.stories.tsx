import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { DesktopLayout } from "./DesktopLayout";

// THE DESKTOP APP SHELL — the sidebar beside a top bar and the routed page. (The phone's shell is a
// different component with its own stories: Layouts/Mobile.)
//
// The menu's own rules live in Sidebar.stories.tsx, beside the component that owns them. What is left
// here is what only exists once the two halves are ASSEMBLED, and each of these is a seam where the
// halves have to agree:
//
//   | the seam            | what goes wrong if it slips                                         |
//   | ------------------- | ------------------------------------------------------------------- |
//   | breadcrumb ↔ menu   | the crumb names one screen while the sidebar highlights another      |
//   | hamburger ↔ drawer  | the top bar opens a sidebar that only the sidebar knows how to close  |
//   | route → canvas      | a page paints its own background and two screens drift apart          |
//
// The team is chosen by planting the current-team key before the providers mount (`asTeam`) — the
// same thing the team switcher does. The shell has no prop for it, and should not: the whole app is
// scoped by that one selection.

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLING = teams[1]!; // Toko Melati (12)

// The shell is a PARENT ROUTE with an <Outlet/>, so a story has to mount it as one — rendering
// <DesktopLayout/> bare would give it no page and no location to derive anything from. The children are
// markers rather than the real pages: this file is about the frame, and mounting a real screen here
// would report that screen's failures against the shell.
const SHELL: RouteObject = {
  path: "/",
  element: <DesktopLayout />,
  children: [
    { index: true, element: <Text data-testid="at-home">at-home</Text> },
    marker("products", "at-products"),
    marker("order-drafts", "at-order-drafts"),
    marker("inventories/batches/:batchId", "at-batch-detail"),
    // Every OTHER menu link needs somewhere to land: an <a> to a route the router does not know
    // throws a 404 element in place of the whole shell, which would read as the nav having broken.
    marker("*", "at-elsewhere"),
  ],
};

const at = (path: string) => routedPage([SHELL], path);

const AtHome = at("/");
const AtDrafts = at("/order-drafts");
const AtBatchDetail = at("/inventories/batches/301");

const meta = {
  title: "Layouts/Desktop/AppShell",
  component: DesktopLayout,
  parameters: {
    // The shell reads BOTH contexts on every path — `useAuth()` for the identity in the user card,
    // `useTeam()` for the scope the entire menu is built from (and `useTeam()` throws without it).
    signedIn: true,
    // It builds its own data router (see pageStory.tsx), so the shared MemoryRouter stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtHome />,
} satisfies Meta<typeof DesktopLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

// The whole screen a warehouse crew works in.
export const WarehouseTeam: Story = {};

// …and a selling team's, from the same component: a different sidebar, the same frame.
export const SellingTeam: Story = {
  beforeEach: asTeam(SELLING.id),
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// The breadcrumb answers "whose data am I looking at, and at what" — in that order. The team comes
// first because two tabs open on two teams are otherwise identical at a glance.
export const TheBreadcrumbNamesTheTeamThenThePage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = within(await canvas.findByRole("banner"));

    await waitFor(() => expect(header.getByText(WAREHOUSE.name)).toBeInTheDocument());
    await expect(header.getByText("Home")).toBeInTheDocument();
  },
};

// ⚠ THE CRUMB AND THE HIGHLIGHT ARE ONE MATCH (nav.ts), which is what this pins. Drafts has its own
// route but no menu item, so it is CLAIMED by Orders (`alsoMatches`) — and the top bar has to reach
// the same conclusion the sidebar did, or the shell names a screen the sidebar says you are not on.
export const TheBreadcrumbAgreesWithTheHighlightedItem: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDrafts />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⚠ The sidebar is selected as `complementary` (the <aside>), NOT as `navigation`: the shell has
    // TWO navigation landmarks — the sidebar's <nav> and the breadcrumb, which Chakra renders as one
    // too — so a by-role query for "navigation" is ambiguous and fails on the wrong thing.
    const sidebar = within(await canvas.findByRole("complementary"));
    const header = within(canvas.getByRole("banner"));

    await waitFor(() =>
      expect(sidebar.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page"),
    );
    await expect(header.getByText("Orders")).toBeInTheDocument();
  },
};

// A DRAGGED-SMALL WINDOW TURNS THE SIDEBAR INTO A DRAWER (#214) — a phone gets the mobile shell
// instead, so this is now about a narrow DESKTOP window. The two ends of it live in different components: the
// hamburger that opens it is in the top bar, and everything that closes it — the backdrop, and
// navigating — is the sidebar's. This is the story that proves they are wired to each other.
//
// ⚠ The trigger is `hideFrom="md"` — a MEDIA QUERY, and the story runner's viewport is a desktop one,
// so what this pins is the drawer's STATE MACHINE, not the breakpoint that reveals the button. The
// breakpoint is CSS with no logic in it; the closing rules are logic that has no CSS.
export const TheDrawerOpensOnTheHamburgerAndClosesOnNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("sidebar-hamburger"));
    await waitFor(() => expect(canvas.getByTestId("sidebar-backdrop")).toBeInTheDocument());

    // An outside tap. The backdrop only asks — this is the caller acting on it.
    await userEvent.click(canvas.getByTestId("sidebar-backdrop"));
    await waitFor(() => expect(canvas.queryByTestId("sidebar-backdrop")).toBeNull());

    // …and a link, which must both navigate and get out of the way.
    await userEvent.click(canvas.getByTestId("sidebar-hamburger"));
    await waitFor(() => expect(canvas.getByTestId("sidebar-backdrop")).toBeInTheDocument());

    const sidebar = within(canvas.getByRole("complementary"));
    await userEvent.click(sidebar.getByRole("link", { name: "Products" }));

    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
    await expect(canvas.queryByTestId("sidebar-backdrop")).toBeNull();
  },
};

// THE SHELL OWNS THE SURFACE, and it decides by ROUTE. The content area is white by default so a
// freshly-built screen is not tinted by something it never asked for; a page that wants the grey
// canvas is named in the shell rather than painting its own background — otherwise two screens end
// up drawing the same "page" two slightly different colours.
export const ThePageCanvasIsChosenByTheShell: Story = {
  render: () => <AtBatchDetail />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("at-batch-detail")).toBeInTheDocument());
    const main = canvas.getByRole("main");
    await expect(window.getComputedStyle(main).backgroundColor).toBe("rgb(246, 247, 249)");
  },
};
