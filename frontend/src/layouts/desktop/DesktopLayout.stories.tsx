import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { Text } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { asPlatformOnly } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DesktopLayout } from "./DesktopLayout";

// THE DESKTOP APP SHELL — the sidebar beside the routed page, nothing above it (`the-desktop-shell-has-no-top-bar`).
// (The phone's shell is a different component with its own stories: Layouts/Mobile.)
//
// The menu's own rules live in Sidebar.stories.tsx, beside the component that owns them. What is left
// here is what only exists once the halves are ASSEMBLED:
//
//   | the seam            | what goes wrong if it slips                                         |
//   | ------------------- | ------------------------------------------------------------------- |
//   | no top bar          | a header creeps back over every page                                 |
//   | route → canvas      | a page paints its own background and two screens drift apart          |
//   | the non-member strip| a Root override reads as ordinary membership                          |
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

// NO TOP BAR (owner: *"di app shell, kita tidak perlu heading yang ada breadcrumbnya"*) — the page starts at the top,
// beside the sidebar: no header landmark, no breadcrumb, no search, no bell, no hamburger. The team and the screen
// are the sidebar's to say — the switcher, and the lit item.
export const TheShellHasNoTopBar: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDrafts />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sidebar = within(await canvas.findByRole("complementary"));

    await waitFor(() =>
      expect(sidebar.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page"),
    );
    await expect(canvas.queryByRole("banner")).toBeNull();
    await expect(canvas.getAllByRole("navigation")).toHaveLength(1);
    await expect(canvas.queryByTestId("sidebar-hamburger")).toBeNull();
    await expect(canvas.queryByTestId("global-search")).toBeNull();
    await expect(canvas.queryByTestId("notifications")).toBeNull();

    // The page starts at the top of the window.
    await expect(Math.round(canvas.getByRole("main").getBoundingClientRect().top)).toBe(0);
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
    // gray.100 — GREY_CANVAS in shell.ts.
    await expect(window.getComputedStyle(main).backgroundColor).toBe("rgb(243, 244, 246)");
  },
};

// a-non-member-root-acts-under-a-strip — Root, a member of the root team only, picked Toko Melati from the
// switcher's All teams. The team is restored BY ID (it is not a membership), and every page says whose reach
// this is: a write here is an override, and must never look like ordinary membership.
export const RootInATeamTheyAreNotIn: Story = {
  beforeEach: () => {
    asPlatformOnly(Role.ROOT)();
    asTeam(SELLING.id)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const strip = await canvas.findByTestId("not-member-strip", {}, { timeout: 4000 });
    await expect(strip).toHaveTextContent("acting as Root");
  },
};

// …and a member sees no strip: it is said only when it is true.
export const AMemberSeesNoStrip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The switcher renders once the memberships have loaded — only then is "no strip" an answer.
    await canvas.findByTestId("team-switcher", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("not-member-strip")).toBeNull();
  },
};
