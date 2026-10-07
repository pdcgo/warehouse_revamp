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
// server, because they reach every team without being in it (the-switcher-offers-every-team); a team they are
// not in is marked as such, and picking it acts there under a strip (a-non-member-root-acts-under-a-strip —
// pinned in the shell stories, Layouts/*/AppShell).
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

// A member's switcher is their own teams, and nothing else — no All teams section.
export const AMemberSeesOnlyTheirTeams: Story = {
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await waitFor(() => expect(screen.getByTestId(`team-option-${SELLING.id}`)).toBeVisible());
    await expect(screen.queryByTestId("team-section-all")).toBeNull();
  },
};

// the-switcher-offers-every-team — Root sees every team. One they are IN stays under My teams, once, unmarked;
// the rest are marked "Not a member".
export const RootSeesEveryTeam: Story = {
  beforeEach: asPlatformOnly(Role.ROOT, [WAREHOUSE.id]),
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await waitFor(() => expect(screen.getByTestId(`team-not-member-${SELLING.id}`)).toBeVisible(), { timeout: 4000 });
    await expect(screen.getByTestId("team-section-mine")).toBeVisible();
    await expect(screen.getByTestId("team-section-all")).toBeVisible();

    await expect(screen.getAllByTestId(`team-option-${WAREHOUSE.id}`)).toHaveLength(1);
    await expect(screen.queryByTestId(`team-not-member-${WAREHOUSE.id}`)).toBeNull();
  },
};

// All teams grows with every seller, so it is searched on the server, not scrolled.
export const RootSearchesAllTeams: Story = {
  beforeEach: asPlatformOnly(Role.ROOT),
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    const search = await screen.findByTestId("team-search");
    await userEvent.type(search, "kenanga", { delay: 30 });

    await waitFor(() => expect(screen.getByTestId(`team-not-member-${KENANGA.id}`)).toBeVisible(), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByTestId(`team-option-${SELLING.id}`)).toBeNull());
  },
};

// The System Administrator reaches every team too.
export const TheAdministratorSeesEveryTeam: Story = {
  beforeEach: asPlatformOnly(Role.ADMINISTRATOR),
  play: async ({ canvasElement }) => {
    await openSwitcher(canvasElement);

    await waitFor(() => expect(screen.getByTestId(`team-not-member-${WAREHOUSE.id}`)).toBeVisible(), { timeout: 4000 });
  },
};
