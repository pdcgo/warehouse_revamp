import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asAdminTeam, asRole } from "../../../../.storybook/sessionScenario";
import {
  teamCodePreviewFailsForStory,
  teamCodeScenario,
  teamCodeTakenInBetweenForStory,
} from "../../../../.storybook/teamCodeStub";
import { toaster } from "../../../components/feedback/Toaster";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { SettingsPage } from "../index";

// SETTINGS — THE TEAM CODE (backlog #150, LIVE; accepted as the-team-code-and-product-tags-prototype-is-accepted). A
// selling team's *Kode tim* card: the code shown to its people, edited by its Owner and Admin, a confirm that says what
// follows — its figures from TeamCodePreview, read when Save opens it and never on the page's load — and the refusal of a
// code another team holds or ever held (a-team-code-change-recomposes-its-product-codes, its 🔄 lines; the acceptance
// rows docs/acceptances/teams/team_code.md given 1). The server is .storybook/teamCodeStub.ts: Toko Anggrek (15) is
// SL-03 with 46 products (two archived) held in Gudang Cabang and Gudang Pusat; Toko Melati holds SL-01; Toko Kenanga
// was KNG before SL-02.

const ANGGREK = 15n;
const GUDANG_PUSAT = 11n;

const meta = {
  title: "Pages/Settings/SettingsPage/TeamCode",
  component: SettingsPage,
  parameters: { signedIn: true },
  beforeEach: () => {
    asTeam(ANGGREK)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The card, once the team's code has landed in its field. */
async function card(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const c = within(await canvas.findByTestId("settings-team-code-card", {}, { timeout: 5000 }));
  await waitFor(() => expect(c.getByTestId("settings-team-code")).toHaveValue("SL-03"), { timeout: 5000 });
  return c;
}

async function typeCode(c: ReturnType<typeof within>, code: string) {
  const input = c.getByTestId("settings-team-code");
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.clear(input);
  await userEvent.type(input, code, { delay: 30 });
}

async function askFor(c: ReturnType<typeof within>, code: string) {
  await typeCode(c, code);
  await userEvent.click(c.getByTestId("save-team-code"));
}

/** The card as it opens: the code, what it is the prefix of, its rule — Save waiting for a different code — and NO
 *  preview read: TeamCodePreview is asked when Save opens the confirm, never on the page's load. */
export const TheCodeIsShown: Story = {
  name: "The code, shown",
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);

    await expect(c.getByTestId("settings-team-code-lead")).toHaveTextContent("SL-03-…");
    await expect(c.getByTestId("settings-team-code-help")).toHaveTextContent("Up to 10 characters");
    // The same code again changes nothing — Save waits for another.
    await expect(c.getByTestId("save-team-code")).toBeDisabled();
    await expect(c.queryByTestId("settings-team-code-refused")).toBeNull();
    await expect(teamCodeScenario.previews).toHaveLength(0);
  },
};

/** A new code asks first, and the confirm says what follows: every product takes it, each holding warehouse reprints
 *  (the tag until then), past lines keep theirs, the old code stays the team's. Nothing is written before the confirm. */
export const TheConfirmSaysWhatFollows: Story = {
  name: "The confirm",
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await typeCode(c, "ANGR");

    await expect(c.getByTestId("settings-team-code-change")).toHaveTextContent("SL-03 → ANGR");
    await userEvent.click(c.getByTestId("save-team-code"));

    await waitFor(() => expect(screen.getByTestId("team-code-confirm")).toBeVisible(), { timeout: 5000 });
    await expect(screen.getByText("Change the team code to ANGR?")).toBeVisible();
    await expect(screen.getByTestId("team-code-confirm-products")).toHaveTextContent(
      "46 products take the new code — SL-03-ANG-001 becomes ANGR-ANG-001",
    );
    await expect(screen.getByTestId("team-code-confirm-reprint")).toHaveTextContent("Gudang Cabang, Gudang Pusat");
    await expect(screen.getByTestId("team-code-confirm-reprint")).toHaveTextContent("need_reprint_code");
    await expect(screen.getByTestId("team-code-confirm-past")).toHaveTextContent("Past orders, restocks and transfers keep");
    await expect(screen.getByTestId("team-code-confirm-former")).toHaveTextContent("SL-03 stays this team's");
    await expect(teamCodeScenario.previews).toEqual([{ teamId: ANGGREK, teamCode: "ANGR" }]);
    await expect(teamCodeScenario.updates).toHaveLength(0);
  },
};

/** A code ANOTHER team holds is refused in place (*already exists*, naming it), before any confirm — nothing written. */
export const ACodeAnotherTeamHoldsIsRefused: Story = {
  name: "Held by another team",
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await askFor(c, "SL-01");

    await waitFor(() =>
      expect(c.getByTestId("settings-team-code-refused")).toHaveTextContent("SL-01 already exists — Toko Melati uses it."),
    );
    await expect(screen.queryByTestId("team-code-confirm")).toBeNull();
    await expect(teamCodeScenario.updates).toHaveLength(0);
  },
};

/** A refusal is said until the code is typed again. */
export const ARefusalClearsAsYouType: Story = {
  name: "Refusal clears as you type",
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await askFor(c, "SL-01");
    await waitFor(() => expect(c.getByTestId("settings-team-code-refused")).toBeVisible());

    await userEvent.type(c.getByTestId("settings-team-code"), "X", { delay: 30 });
    await expect(c.queryByTestId("settings-team-code-refused")).toBeNull();
  },
};

/** A code another team held BEFORE is refused too — a former code stays taken (owner Q1 "A"): an old sticker can only
 *  ever mean that team's product. */
export const ACodeOnceHeldIsRefused: Story = {
  name: "Held before by another team",
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await askFor(c, "KNG");

    await waitFor(() =>
      expect(c.getByTestId("settings-team-code-refused")).toHaveTextContent("KNG already exists — another team used it before"),
    );
    await expect(screen.queryByTestId("team-code-confirm")).toBeNull();
  },
};

/** More than ten characters is said in place, and Save waits — nothing is asked. */
export const ACodeTooLongIsSaid: Story = {
  name: "Too long",
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await typeCode(c, "ANGGREKJAYA");

    await expect(c.getByTestId("settings-team-code-too-long")).toHaveTextContent("at most 10 characters");
    await expect(c.getByTestId("save-team-code")).toBeDisabled();
    await expect(teamCodeScenario.previews).toHaveLength(0);
  },
};

/** WRITES — the confirm's Change Code sends TeamCodeUpdate with the new code; the card re-reads the team (its code is
 *  ANGR now), Save waits again, and the toast says how many products took it. */
export const SavingChangesTheCode: Story = {
  name: "Saving (writes)",
  beforeEach: () => {
    toaster.remove();
  },
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await askFor(c, "ANGR");
    await waitFor(() => expect(screen.getByTestId("team-code-confirm")).toBeVisible(), { timeout: 5000 });

    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(teamCodeScenario.updates).toEqual([{ teamId: ANGGREK, teamCode: "ANGR" }]));
    await waitFor(() => expect(c.getByTestId("settings-team-code-lead")).toHaveTextContent("ANGR-…"));
    await expect(c.getByTestId("settings-team-code")).toHaveValue("ANGR");
    await expect(c.getByTestId("save-team-code")).toBeDisabled();
    await waitFor(() => expect(screen.getByText("The team code is ANGR now — 46 products took the new code.")).toBeVisible());
    await waitFor(() => expect(screen.queryByTestId("team-code-confirm")).toBeNull());
  },
};

/** WRITES — another team took the code between the preview and Change Code: the write's TeamCodeTaken detail is said
 *  in place, naming it, and the team keeps its code. */
export const TakenInBetweenIsRefusedByTheWrite: Story = {
  name: "Taken in between (writes)",
  beforeEach: teamCodeTakenInBetweenForStory("ANGR", "Toko Mawar"),
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await askFor(c, "ANGR");
    await waitFor(() => expect(screen.getByTestId("team-code-confirm")).toBeVisible(), { timeout: 5000 });

    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() =>
      expect(c.getByTestId("settings-team-code-refused")).toHaveTextContent("ANGR already exists — Toko Mawar uses it."),
    );
    await waitFor(() => expect(screen.queryByTestId("team-code-confirm")).toBeNull());
    await expect(c.getByTestId("settings-team-code-change")).toHaveTextContent("SL-03 → ANGR");
  },
};

/** The preview failing is said in place — no confirm opens on figures nobody read. */
export const APreviewFailureIsSaid: Story = {
  name: "Preview fails",
  beforeEach: teamCodePreviewFailsForStory,
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await askFor(c, "ANGR");

    await waitFor(() => expect(c.getByTestId("settings-team-code-error")).toBeVisible());
    await expect(screen.queryByTestId("team-code-confirm")).toBeNull();
    await expect(teamCodeScenario.updates).toHaveLength(0);
  },
};

/** Cancel on the confirm writes nothing — the code stays as typed, to be saved or changed. */
export const DismissingTheConfirmWritesNothing: Story = {
  name: "Confirm dismissed",
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    await askFor(c, "ANGR");
    await waitFor(() => expect(screen.getByTestId("team-code-confirm")).toBeVisible(), { timeout: 5000 });

    await userEvent.click(screen.getByTestId("confirm-dismiss"));

    await waitFor(() => expect(screen.queryByTestId("team-code-confirm")).toBeNull());
    await expect(teamCodeScenario.updates).toHaveLength(0);
    await expect(c.getByTestId("settings-team-code")).toHaveValue("ANGR");
  },
};

/** The team's other people see the code and change nothing — the edit is the Owner's and the Admin's. */
export const TheTeamsCsSeesItReadOnly: Story = {
  name: "CS reads it",
  beforeEach: asRole(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);

    await expect(c.getByTestId("settings-team-code")).toBeDisabled();
    await expect(c.getByTestId("settings-team-code-hint")).toHaveTextContent("Only the team's owner or admin");
    await expect(c.queryByTestId("save-team-code")).toBeNull();
  },
};

/** The admin team MONITORS read-only (the-admin-team-monitors-read-only): the code, no edit. */
export const AMonitorReadsIt: Story = {
  name: "Monitor reads it",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);

    await expect(c.getByTestId("settings-team-code")).toBeDisabled();
    await expect(c.queryByTestId("save-team-code")).toBeNull();
  },
};

/** Only a selling team's code is edited — a warehouse's Settings has no card. */
export const AWarehouseHasNoCard: Story = {
  name: "No card for a warehouse",
  beforeEach: () => {
    asTeam(GUDANG_PUSAT)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("settings-team-name", {}, { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(canvas.queryByTestId("settings-team-code-card")).toBeNull();
  },
};

/** On a phone the card is the page's width — the field and Save inside it. */
export const OnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const c = await card(canvasElement);
    const box = canvasElement.querySelector<HTMLElement>('[data-testid="settings-team-code-card"]')!;
    const save = c.getByTestId("save-team-code");

    await expect(save.getBoundingClientRect().right).toBeLessThanOrEqual(box.getBoundingClientRect().right);
    await expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
  },
};
