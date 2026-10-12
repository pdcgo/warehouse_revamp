import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { asPlatformOnly, withTeamName } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { MobileLayout } from "./MobileLayout";

// THE MOBILE APP SHELL — a compact top bar, the page, and a bottom tab bar.
//
// Its halves' own rules live beside them (BottomNav.stories, MenuSheet.stories). What is left here is
// what only exists once they are ASSEMBLED — and every one of these is a seam where the halves have
// to agree:
//
//   | the seam           | what goes wrong if it slips                                          |
//   | ------------------ | -------------------------------------------------------------------- |
//   | title ↔ tab bar    | the header names one screen while a different tab is lit              |
//   | More tab ↔ sheet   | the bar opens a sheet only the sheet knows how to close               |
//   | route → canvas     | a page paints its own background and two screens drift apart          |
//
// ⚠ IT IS MOUNTED DIRECTLY, never through [Layout]. Layout picks a shell from a media query, and the
// story runner has ONE fixed viewport — going through the picker would test the browser's width
// rather than this component. The `viewport` global below is for the workbench, where the point is to
// LOOK at it on a phone-shaped canvas; it has no effect on the assertions.
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLING = teams[1]!; // Toko Melati (12)

const SHELL: RouteObject = {
  path: "/",
  element: <MobileLayout />,
  children: [
    { index: true, element: <Text data-testid="at-home">at-home</Text> },
    marker("products", "at-products"),
    marker("order-drafts", "at-order-drafts"),
    marker("users", "at-users"),
    marker("inventories/batches/:batchId", "at-batch-detail"),
    // Every OTHER menu link needs somewhere to land: an <a> to a route the router does not know
    // throws a 404 element in place of the whole shell, which would read as the nav having broken.
    marker("*", "at-elsewhere"),
  ],
};

const at = (path: string) => routedPage([SHELL], path);

const AtHome = at("/");
const AtDrafts = at("/order-drafts");
const AtUsers = at("/users");
const AtBatchDetail = at("/inventories/batches/301");

const meta = {
  title: "Layouts/Mobile/AppShell",
  component: MobileLayout,
  parameters: {
    // It reads BOTH contexts — `useAuth()` for the identity in the More sheet, `useTeam()` for the
    // scope both the tab bar and the menu are built from (and `useTeam()` throws without it).
    signedIn: true,
    // It builds its own data router (see pageStory.tsx), so the shared MemoryRouter stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  globals: { viewport: { value: "mobile2" } },
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtHome />,
} satisfies Meta<typeof MobileLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

// The screen a warehouse crew actually holds: Orders and Restock a thumb away, everything else in More.
export const WarehouseTeam: Story = {};

// …and a selling team's, from the same component — a different bar, the same frame.
export const SellingTeam: Story = {
  beforeEach: asTeam(SELLING.id),
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE TOP BAR NAMES THE SCREEN, and only that — the team's name is under the workspace bubble in the tab bar
// (`the-workspace-is-the-tab-bars-centre`). No bell either (`the-phone-has-no-bell`) — nothing sends a notification yet.
export const TheHeaderNamesTheScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = within(await canvas.findByRole("banner"));

    await waitFor(() => expect(header.getByTestId("mobile-title")).toHaveTextContent("Home"));
    await expect(header.queryByText(WAREHOUSE.name)).toBeNull();
    await expect(canvas.queryByTestId("notifications")).toBeNull();

  },
};

// THE WORKSPACE IS THE TAB BAR'S CENTRE (owner, `the-workspace-is-the-tab-bars-centre`) — a round bubble of the team's
// avatar in the middle column, lifted above the bar's top line, the team's name under it; the top bar holds no control.
export const TheWorkspaceIsTheTabBarsCentre: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = within(await canvas.findByRole("banner"));

    const nav = await canvas.findByTestId("bottom-nav");
    const bubble = await within(nav).findByTestId("team-switcher", {}, { timeout: 4000 });
    await expect(header.queryByTestId("team-switcher")).toBeNull();
    await expect(bubble).toHaveAccessibleName(`Switch Team: ${WAREHOUSE.name}`);
    await waitFor(() => expect(within(bubble).getByTestId("team-switcher-name")).toHaveTextContent(WAREHOUSE.name));

    // In the middle column — two tabs either side — and raised out of the bar.
    const columns = Array.from(nav.children);
    await expect(columns).toHaveLength(5);
    await expect(columns[2]).toContainElement(bubble);
    // The ROUND part rises; the button around it is the tab's column.
    const n = nav.getBoundingClientRect();
    const r = (bubble.firstElementChild as HTMLElement).getBoundingClientRect();
    await expect(Math.abs(r.left + r.width / 2 - (n.left + n.width / 2))).toBeLessThan(2);
    await expect(r.top).toBeLessThan(n.top - 8);

    await userEvent.click(bubble);
    await waitFor(() => expect(screen.getByTestId("team-switcher-drawer")).toBeVisible());
  },
};

// A LONG TEAM NAME — cut to one line under the bubble, with an ellipsis, in a column a tab's width; the bar keeps its
// height and the bubble its place. The full name is the button's name, and the drawer's row.
const LONG_NAME = "Gudang Pusat Distribusi Jawa Barat Cikarang Utara";

export const ALongTeamName: Story = {
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    withTeamName(WAREHOUSE.id, LONG_NAME)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = await canvas.findByTestId("bottom-nav");
    const label = await within(nav).findByTestId("team-switcher-name", {}, { timeout: 4000 });

    await waitFor(() => expect(label).toHaveTextContent(LONG_NAME));
    // One line, cut — not wrapped, not spilling into the tabs beside it. (A line clamp cuts by LINES, so what it hides
    // is height, not width.)
    await expect(label.scrollHeight).toBeGreaterThan(label.clientHeight);
    await expect(label.getBoundingClientRect().height).toBeLessThan(20);
    const column = canvas.getByTestId("bottom-nav-center").getBoundingClientRect();
    await expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(column.right + 0.5);
    await expect(Math.round(nav.getBoundingClientRect().height)).toBe(56);

    await expect(within(nav).getByTestId("team-switcher")).toHaveAccessibleName(`Switch Team: ${LONG_NAME}`);
  },
};

// THE PHONE WORKSPACE KEEPS ITS SIZE (owner, `the-phone-workspace-keeps-its-size`) — the drawer is three-quarters of the screen
// whatever it holds: a search that leaves nothing does not drop it under the thumb.
export const TheWorkspaceKeepsItsSize: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("team-switcher", {}, { timeout: 4000 }));
    const drawer = await screen.findByTestId("team-switcher-drawer");
    await waitFor(() => expect(Math.round(drawer.getBoundingClientRect().height)).toBe(Math.round(window.innerHeight * 0.75)));
    const before = Math.round(drawer.getBoundingClientRect().height);

    await userEvent.click(screen.getByTestId("team-search-mine"));
    await userEvent.type(await screen.findByTestId("team-search"), "zzz", { delay: 30 });
    await waitFor(() => expect(screen.getByText("No teams found.")).toBeVisible());
    await expect(Math.round(drawer.getBoundingClientRect().height)).toBe(before);
  },
};

// THE BUBBLE OPENS THE WORKSPACE FROM THE BOTTOM (`the-phone-opens-its-panels-from-the-bottom`) — a drawer at
// the screen's foot, where the thumb is, never the whole screen.
export const TheChipOpensTheWorkspaceFromTheBottom: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("team-switcher", {}, { timeout: 4000 }));
    const drawer = await screen.findByTestId("team-switcher-drawer");
    await waitFor(() => expect(drawer).toBeVisible());
    await expect(within(drawer).getByTestId(`team-option-${WAREHOUSE.id}`)).toBeVisible();

    await waitFor(() => {
      const r = drawer.getBoundingClientRect();
      expect(Math.round(r.bottom)).toBe(window.innerHeight);
      expect(r.top).toBeGreaterThan(0);
    });
  },
};

// ⚠ THE TITLE AND THE LIT TAB ARE ONE MATCH (nav.ts). Drafts has its own route but no menu item, so
// it is CLAIMED by Orders (`alsoMatches`) — and the header has to reach the same conclusion the tab
// bar did, or the shell names a screen the bar says you are not on.
export const TheTitleAgreesWithTheLitTab: Story = {
  beforeEach: asTeam(SELLING.id),
  render: () => <AtDrafts />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(await canvas.findByTestId("bottom-nav"));

    await waitFor(() =>
      expect(bar.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page"),
    );
    await expect(canvas.getByTestId("mobile-title")).toHaveTextContent("Orders");
  },
};

// THE MORE TAB AND THE SHEET ARE THE TWO ENDS OF ONE CONTROL, and they live in different components:
// the tab opens it, and everything that closes it — a link, the close button, the backdrop — is the
// sheet's. This is the story that proves they are wired to each other.
export const MoreOpensTheSheetAndANavigationClosesIt: Story = {
  beforeEach: asTeam(SELLING.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("bottom-nav-more"));

    // The sheet is PORTALLED out of the shell, so it is on `screen` rather than in the canvas.
    const sheet = await screen.findByTestId("menu-sheet");
    await waitFor(() => expect(sheet).toBeVisible());

    // A link must both navigate and get out of the way — a menu left covering the screen it just
    // opened is a menu the person has to dismiss before they can read the answer they asked for.
    await userEvent.click(within(sheet).getByRole("link", { name: "Shops" }));

    await waitFor(() => expect(canvas.getByTestId("at-elsewhere")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("menu-sheet")).toBeNull());
  },
};

// A SCREEN THE BAR DOES NOT CARRY IS "MORE"'S — so there is always exactly one lit tab. Users is
// reached from the sheet and has no tab of its own; with nothing lit, the bar would be telling you
// that you are nowhere.
export const MoreIsLitWhenNoTabOwnsTheScreen: Story = {
  render: () => <AtUsers />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const more = await canvas.findByTestId("bottom-nav-more");

    await waitFor(() => expect(canvas.getByTestId("at-users")).toBeInTheDocument());
    await expect(more).toHaveAttribute("data-active");
    // …and it is the ONLY one, which is the half that would break silently: a bar can highlight two
    // tabs and still look deliberate.
    const bar = within(canvas.getByTestId("bottom-nav"));
    await expect(bar.getByRole("link", { name: "Home" })).not.toHaveAttribute("data-active");
  },
};

// THE SHELL OWNS THE SURFACE, and it decides by ROUTE — the same `usesGreyCanvas` the desktop shell
// reads (shell.ts). Two shells deciding a page's background separately is how the same screen ends up
// two colours depending on the device it is opened on.
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
