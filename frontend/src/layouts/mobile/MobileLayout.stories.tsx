import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RouteObject } from "react-router-dom";
import { Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { asPlatformOnly } from "../../../.storybook/sessionScenario";
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

// THE TOP BAR NAMES THE TEAM, THEN THE SCREEN — whose data this is, then what you are looking at, stacked. And
// nothing else: no bell (`the-phone-has-no-bell`) — nothing sends a notification yet.
export const TheHeaderNamesTheTeamThenTheScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = within(await canvas.findByRole("banner"));

    await waitFor(() => expect(header.getByText(WAREHOUSE.name)).toBeInTheDocument());
    await expect(header.getByTestId("mobile-title")).toHaveTextContent("Home");
    await expect(canvas.queryByTestId("notifications")).toBeNull();

  },
};

// THE WHOLE BOX IS THE SELECTOR (owner, `the-phone-team-chip-is-the-whole-box`) — the avatar, the team, the screen and
// ⇅ are one control, so a tap on the screen's NAME opens the workspace too, not only a tap on the picture.
export const TheWholeHeaderBoxIsTheTeamSelector: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = within(await canvas.findByRole("banner"));

    const selector = await header.findByTestId("team-switcher", {}, { timeout: 4000 });
    await expect(selector).toContainElement(header.getByTestId("mobile-title"));
    await expect(selector).toHaveTextContent(WAREHOUSE.name);
    // Across the bar, not a chip in its corner.
    const bar = canvas.getByRole("banner").getBoundingClientRect();
    await expect(selector.getBoundingClientRect().width).toBeGreaterThan(bar.width * 0.8);

    await userEvent.click(header.getByTestId("mobile-title"));
    await waitFor(() => expect(screen.getByTestId("team-switcher-drawer")).toBeVisible());
  },
};

// THE TEAM CHIP OPENS THE WORKSPACE FROM THE BOTTOM (`the-phone-opens-its-panels-from-the-bottom`) — a drawer at
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
