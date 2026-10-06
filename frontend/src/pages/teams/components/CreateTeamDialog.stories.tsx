import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { users } from "../../../../.storybook/fixtures";
import { asPlatformOnly, teamCreateScenario } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { CreateTeamDialog } from "./CreateTeamDialog";

// THE CREATE TEAM FORM names the new team's first Owner (the-create-team-form-names-the-first-owner): found
// with the user search, or created right here when the search finds nobody. The person creating it — Root or
// the System Administrator — is not made a member; they reach it from the switcher's All teams.
//
// ⚠ The server does not yet honour the Owner (the form says so with a pending mark); these stories pin what
// the form SENDS, read back from the stub (teamCreateScenario).

const BUDI = users[1]!; // budi (62)

const meta = {
  title: "Pages/Teams/CreateTeamDialog",
  component: CreateTeamDialog,
  parameters: {
    // It refreshes the switcher's memberships after a create, so it reads `useTeam()`.
    signedIn: true,
  },
  beforeEach: asPlatformOnly(Role.ROOT),
} satisfies Meta<typeof CreateTeamDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens the form and fills the team's own fields; returns the dialog. */
async function openAndFill(canvasElement: HTMLElement): Promise<HTMLElement> {
  const canvas = within(canvasElement);

  await userEvent.click(await canvas.findByTestId("open-create-team"));

  const name = await screen.findByTestId("new-team-name");
  await userEvent.type(name, "Toko Anyelir", { delay: 20 });
  await userEvent.type(screen.getByTestId("new-team-code"), "SL-09", { delay: 20 });

  return screen.getByRole("dialog");
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId("open-create-team"));
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// A team is never created without an Owner: an empty field is refused by the form itself, and a name typed
// but never PICKED is refused by the dialog — text in the box is not a person.
export const TheOwnerIsRequired: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openAndFill(canvasElement);
    const owner = within(within(dialog).getByTestId("new-team-owner")).getByRole("combobox");

    await userEvent.click(within(dialog).getByTestId("submit-create-team"));
    await expect(owner).toBeInvalid();

    await userEvent.type(owner, "nobody here", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-create-team"));

    await expect(await within(dialog).findByTestId("create-team-error")).toHaveTextContent("owner");
    await expect(teamCreateScenario.last).toBeUndefined();
  },
};

// The Owner is found with the user search, and the form sends THAT person — not the one pressing Create.
export const PicksAnOwner: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openAndFill(canvasElement);

    await userEvent.type(within(within(dialog).getByTestId("new-team-owner")).getByRole("combobox"), "bud", { delay: 30 });
    const option = await screen.findByTestId(`user-select-option-${BUDI.username}`, {}, { timeout: 4000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await userEvent.click(within(dialog).getByTestId("submit-create-team"));

    await waitFor(() => expect(teamCreateScenario.last?.ownerUserId).toBe(BUDI.id));
    await expect(teamCreateScenario.last?.name).toBe("Toko Anyelir");
  },
};

// Nobody found → the Owner is created right here, then named on the team.
export const CreatesAnOwner: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openAndFill(canvasElement);

    await userEvent.click(within(dialog).getByTestId("new-owner-create"));
    await userEvent.type(within(dialog).getByTestId("new-owner-username"), "hendra", { delay: 20 });
    await userEvent.type(within(dialog).getByTestId("new-owner-password"), "hendra123", { delay: 20 });
    await userEvent.type(within(dialog).getByTestId("new-owner-name"), "Hendra", { delay: 20 });

    await userEvent.click(within(dialog).getByTestId("submit-create-team"));

    await waitFor(() => expect(teamCreateScenario.last?.ownerUserId).toBeGreaterThan(0n));
    await expect(Object.values(users).some((u) => u.id === teamCreateScenario.last?.ownerUserId)).toBe(false);
  },
};

// A new Owner still needs a name (only-name-and-username-are-required): an empty one is refused by the form,
// and one of only spaces by the dialog. Nothing is sent either way.
export const ANewOwnerNeedsAName: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openAndFill(canvasElement);

    await userEvent.click(within(dialog).getByTestId("new-owner-create"));
    await userEvent.type(within(dialog).getByTestId("new-owner-username"), "hendra", { delay: 20 });
    await userEvent.type(within(dialog).getByTestId("new-owner-password"), "hendra123", { delay: 20 });

    await userEvent.click(within(dialog).getByTestId("submit-create-team"));
    await expect(within(dialog).getByTestId("new-owner-name")).toBeInvalid();

    await userEvent.type(within(dialog).getByTestId("new-owner-name"), "   ", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-create-team"));

    await expect(await within(dialog).findByTestId("create-team-error")).toHaveTextContent("Name is required");
    await expect(teamCreateScenario.last).toBeUndefined();
  },
};
