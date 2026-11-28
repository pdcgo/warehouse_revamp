import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asPlatformOnly } from "../../../../.storybook/sessionScenario";
import { teamCodeScenario } from "../../../../.storybook/teamCodeStub";
import { teamClient } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { TeamsPage } from "../index";

// TEAMS → EDIT TEAM — THE CODE FIELD (backlog #150, LIVE; the-team-code-and-product-tags-prototype-is-accepted, *Teams →
// Edit Team (root)*). Root's administrator changes a SELLING team's code here (the acceptance rows' given 2): the code
// field takes the place of the *"Type and code are fixed after creation"* line, an UNTOUCHED code is never sent, a changed
// one asks TeamCodePreview and the same confirm as Settings' card, then TeamCodeUpdate, and a code another team holds or
// ever held is refused (owner Q1 "A"). A warehouse's or an admin team's code stays fixed. The server is
// .storybook/teamCodeStub.ts.

const ANGGREK = 15n;

const meta = {
  title: "Pages/Teams/TeamsPage/EditTeamCode",
  component: TeamsPage,
  parameters: { signedIn: true },
  beforeEach: () => {
    asPlatformOnly(Role.ROOT)();
  },
} satisfies Meta<typeof TeamsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open a row's Edit Team — the dialog, found on the screen (it portals). */
async function openEdit(canvasElement: HTMLElement, code: string) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByTestId(`row-actions-team-${code}`, {}, { timeout: 5000 }));
  await waitFor(() => expect(screen.getByTestId(`edit-team-${code}`)).toBeVisible());
  await userEvent.click(screen.getByTestId(`edit-team-${code}`));
  await waitFor(() => expect(screen.getByTestId("edit-team-name")).toBeVisible());
}

async function typeCode(code: string) {
  const input = screen.getByTestId("edit-team-code");
  await userEvent.clear(input);
  await userEvent.type(input, code, { delay: 30 });
}

/** A selling team's Edit Team: the code field where the "fixed after creation" line was, the type still fixed. */
export const TheCodeFieldReplacesTheFixedLine: Story = {
  name: "The code field",
  play: async ({ canvasElement }) => {
    await openEdit(canvasElement, "SL-03");

    await expect(screen.getByTestId("edit-team-code")).toHaveValue("SL-03");
    await expect(screen.getByTestId("edit-team-code-help")).toHaveTextContent("The team's products take the new code");
    await expect(screen.getByTestId("edit-team-type-fixed")).toHaveTextContent("The type is fixed after creation.");
    await expect(screen.queryByText(/and code are fixed after creation/)).toBeNull();
    await expect(teamCodeScenario.previews).toHaveLength(0);
  },
};

/** WRITES — a rename with the code untouched saves as today and sends NO code — no preview, no TeamCodeUpdate (the
 *  e2e's *rename sticks; type and code are untouched*). */
export const AnUntouchedCodeIsNotSent: Story = {
  name: "Untouched code not sent (writes)",
  play: async ({ canvasElement }) => {
    const update = spyOn(teamClient, "teamUpdate");
    await openEdit(canvasElement, "SL-03");

    const name = screen.getByTestId("edit-team-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Toko Anggrek Jaya", { delay: 20 });
    await userEvent.click(screen.getByTestId("submit-edit-team"));

    await waitFor(() => expect(update).toHaveBeenCalled());
    await expect(update.mock.calls[0]![0]).toMatchObject({ teamId: ANGGREK, name: "Toko Anggrek Jaya" });
    await expect(screen.queryByTestId("team-code-confirm")).toBeNull();
    await expect(teamCodeScenario.previews).toHaveLength(0);
    await expect(teamCodeScenario.updates).toHaveLength(0);
  },
};

/** WRITES — a changed code asks the confirm first (the same lines as Settings'), then sends TeamCodeUpdate and the
 *  rename as today. */
export const AChangedCodeAsksThenSends: Story = {
  name: "Changed code (writes)",
  play: async ({ canvasElement }) => {
    const update = spyOn(teamClient, "teamUpdate");
    await openEdit(canvasElement, "SL-03");
    await typeCode("ANGR");
    await userEvent.click(screen.getByTestId("submit-edit-team"));

    await waitFor(() => expect(screen.getByTestId("team-code-confirm")).toBeVisible(), { timeout: 5000 });
    await expect(screen.getByTestId("team-code-confirm-products")).toHaveTextContent("SL-03-ANG-001 becomes ANGR-ANG-001");
    await expect(teamCodeScenario.previews).toEqual([{ teamId: ANGGREK, teamCode: "ANGR" }]);
    await expect(teamCodeScenario.updates).toHaveLength(0);
    await expect(update).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(teamCodeScenario.updates).toEqual([{ teamId: ANGGREK, teamCode: "ANGR" }]));
    await waitFor(() => expect(update).toHaveBeenCalled());
  },
};

/** A code another team HELD before is refused in place — no confirm, nothing written. */
export const ACodeOnceHeldIsRefused: Story = {
  name: "Held before by another team",
  play: async ({ canvasElement }) => {
    const update = spyOn(teamClient, "teamUpdate");
    await openEdit(canvasElement, "SL-03");
    await typeCode("KNG");
    await userEvent.click(screen.getByTestId("submit-edit-team"));

    await waitFor(() => expect(screen.getByTestId("edit-team-code-refused")).toHaveTextContent("KNG already exists"));
    await expect(screen.queryByTestId("team-code-confirm")).toBeNull();
    await expect(update).not.toHaveBeenCalled();
    await expect(teamCodeScenario.updates).toHaveLength(0);
  },
};

/** A code another team HOLDS is refused in place too, naming it. */
export const ACodeAnotherTeamHoldsIsRefused: Story = {
  name: "Held by another team",
  play: async ({ canvasElement }) => {
    await openEdit(canvasElement, "SL-03");
    await typeCode("SL-01");
    await userEvent.click(screen.getByTestId("submit-edit-team"));

    await waitFor(() =>
      expect(screen.getByTestId("edit-team-code-refused")).toHaveTextContent("SL-01 already exists — Toko Melati uses it."),
    );
    await expect(screen.queryByTestId("team-code-confirm")).toBeNull();
  },
};

/** A warehouse's code stays fixed — its dialog keeps today's line, and has no code field. */
export const AWarehouseCodeStaysFixed: Story = {
  name: "Warehouse code stays fixed",
  play: async ({ canvasElement }) => {
    await openEdit(canvasElement, "WH-01");

    await expect(screen.queryByTestId("edit-team-code")).toBeNull();
    await expect(screen.getByText("Type (WH-01) and code are fixed after creation.")).toBeVisible();
  },
};

/** On a phone the dialog holds the field whole. */
export const OnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await openEdit(canvasElement, "SL-03");

    const input = screen.getByTestId("edit-team-code");
    await expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  },
};
