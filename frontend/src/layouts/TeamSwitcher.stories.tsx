import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { teams } from "../../.storybook/fixtures";
import { asTeam } from "../../.storybook/pageStory";
import { asPlatformOnly } from "../../.storybook/sessionScenario";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamSwitcher } from "./TeamSwitcher";

// THE TEAM SWITCHER — the current team is the scope of the whole app, and this is where it is chosen.
//
// Everyone sees their own teams. Root and the System Administrator also get *All teams*, searched on the
// server, because they reach every team without being in it (the-switcher-offers-every-team); picking one acts
// there under a strip (a-non-member-root-acts-under-a-strip — pinned in the shell stories, Layouts/*/AppShell).
//
// Each section is searched on its own, from the search icon at the right of its heading
// (the-workspace-searches-one-section).
//
// The dialog portals, so its contents are queried on `screen`.

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLING = teams[1]!; // Toko Melati (12)
const KENANGA = teams[2]!; // Toko Kenanga (13)

const meta = {
  title: "Layouts/TeamSwitcher",
  component: TeamSwitcher,
  parameters: {
    // It reads `useTeam()`, which throws outside the provider.
    signedIn: true,
  },
  beforeEach: asTeam(WAREHOUSE.id),
} satisfies Meta<typeof TeamSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openSwitcher(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(await canvas.findByTestId("team-switcher", {}, { timeout: 4000 }));
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const AMember: Story = {};

export const Root: Story = {
  beforeEach: asPlatformOnly(Role.ROOT, [WAREHOUSE.id]),
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// A member's switcher is their own teams, and nothing else — no All teams section; My teams has its heading and
// its search icon, the field opening under it (the-workspace-search-opens-under-its-heading).
export const AMemberSeesOnlyTheirTeams: Story = {
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await waitFor(() => expect(screen.getByTestId(`team-option-${SELLING.id}`)).toBeVisible());
    await expect(screen.queryByTestId("team-section-all")).toBeNull();
    await expect(screen.queryByTestId("team-search")).toBeNull();

    await userEvent.click(screen.getByTestId("team-search-mine"));
    const search = await screen.findByTestId("team-search");
    await expect(search).toHaveAttribute("placeholder", "Search in My teams");
    await expect(screen.getByTestId("team-section-mine")).toBeVisible();
    await userEvent.type(search, "melati", { delay: 30 });
    await waitFor(() => expect(screen.queryByTestId(`team-option-${WAREHOUSE.id}`)).toBeNull());
    await expect(screen.getByTestId(`team-option-${SELLING.id}`)).toBeVisible();
  },
};

// the-switcher-offers-every-team — Root sees every team. One they are IN stays under My teams, once; All teams holds
// the rest — and no "Not a member" badge, the section says it (the-workspace-searches-one-section).
export const RootSeesEveryTeam: Story = {
  beforeEach: asPlatformOnly(Role.ROOT, [WAREHOUSE.id]),
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await waitFor(() => expect(screen.getByTestId(`team-option-${SELLING.id}`)).toBeVisible(), { timeout: 4000 });
    await expect(screen.getByTestId("team-section-mine")).toBeVisible();
    await expect(screen.getByTestId("team-section-all")).toBeVisible();

    await expect(screen.getAllByTestId(`team-option-${WAREHOUSE.id}`)).toHaveLength(1);
    await expect(screen.queryByText("Not a member")).toBeNull();
  },
};

// NO SEARCH BOX OVER BOTH — each heading carries its own search icon. All teams grows with every seller, so its
// search runs on the server; while it is searched, My teams steps aside.
export const RootSearchesAllTeams: Story = {
  beforeEach: asPlatformOnly(Role.ROOT, [WAREHOUSE.id]),
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await waitFor(() => expect(screen.getByTestId("team-section-all")).toBeVisible(), { timeout: 4000 });
    await expect(screen.queryByTestId("team-search")).toBeNull();

    await userEvent.click(screen.getByTestId("team-search-all"));
    const search = await screen.findByTestId("team-search");
    await expect(search).toHaveAttribute("placeholder", "Search in All teams");
    // The heading stays, its icon now the ^ that shuts the search; My teams steps aside.
    await expect(screen.getByTestId("team-section-all")).toBeVisible();
    await expect(screen.getByTestId("team-search-all")).toHaveAttribute("aria-expanded", "true");
    await expect(screen.queryByTestId("team-section-mine")).toBeNull();
    await userEvent.type(search, "kenanga", { delay: 30 });

    await waitFor(() => expect(screen.getByTestId(`team-option-${KENANGA.id}`)).toBeVisible(), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByTestId(`team-option-${SELLING.id}`)).toBeNull());
    // My teams is not searched — its row is not among the answers, and comes back with the section.
    await expect(screen.queryByTestId(`team-option-${WAREHOUSE.id}`)).toBeNull();

    await userEvent.click(screen.getByTestId("team-search-all"));
    await waitFor(() => expect(screen.queryByTestId("team-search")).toBeNull());
    await waitFor(() => expect(screen.getByTestId(`team-option-${WAREHOUSE.id}`)).toBeVisible());
    await expect(screen.getByTestId("team-section-mine")).toBeVisible();
  },
};

// …and, for Root, My teams searches in the browser, its own rows only; Escape leaves the search before it closes
// anything.
export const MyTeamsIsSearchedOnItsOwn: Story = {
  beforeEach: asPlatformOnly(Role.ROOT, [WAREHOUSE.id, SELLING.id]),
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await userEvent.click(await screen.findByTestId("team-search-mine"));
    const search = await screen.findByTestId("team-search");
    await userEvent.type(search, "melati", { delay: 30 });
    await waitFor(() => expect(screen.queryByTestId(`team-option-${WAREHOUSE.id}`)).toBeNull());
    await expect(screen.getByTestId(`team-option-${SELLING.id}`)).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("team-search")).toBeNull());
    await expect(screen.getByTestId(`team-option-${WAREHOUSE.id}`)).toBeVisible();
  },
};

// The System Administrator reaches every team too.
export const TheAdministratorSeesEveryTeam: Story = {
  beforeEach: asPlatformOnly(Role.ADMINISTRATOR),
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await waitFor(() => expect(screen.getByTestId("team-section-all")).toBeVisible(), { timeout: 4000 });
    await expect(screen.getByTestId(`team-option-${WAREHOUSE.id}`)).toBeVisible();
  },
};
