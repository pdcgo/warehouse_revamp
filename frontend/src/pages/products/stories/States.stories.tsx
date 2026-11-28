import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, waitFor, within } from "storybook/test";

import { type HeldRpc, callsOf, holdRpc } from "../../../../.storybook/holdRpc";
import { teamClient, userClient } from "../../../api/clients";
import { At, PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — the states worth looking at, beyond Default and Mobile: the archive, its own page, and the team known late.
// The page's stories are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-
// screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/States",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The archive — its own page, the archived products alone. */
export const Archived: Story = {
  name: "Archived",
  render: () => <AtArchived />,
};
const AtArchived = At("/products/archived");

// THE TEAM KNOWN LATE (#136) — a selling team's side of Warehouse.stories.tsx's: until the memberships answer, nothing is
// drawn and nothing asked — not the catalogue's "no team" line for a beat, not its lens's TeamList; then the catalogue.
let membershipsHeld: HeldRpc | undefined;

export const TheTeamKnownLate: Story = {
  name: "Late team, catalogue",
  beforeEach: () => {
    membershipsHeld = holdRpc(userClient, "teamAccessList");
    const teamList = spyOn(teamClient, "teamList");

    return () => {
      membershipsHeld?.restore();
      teamList.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(callsOf(userClient.teamAccessList)).toHaveLength(1), { timeout: 5000 });
    await expect(canvas.queryByTestId("products-no-team")).toBeNull();
    await expect(canvas.queryByTestId("products-page")).toBeNull();
    await expect(callsOf(teamClient.teamList)).toHaveLength(0);

    membershipsHeld?.release();
    const page = await loaded(canvasElement);

    await expect(page.getByTestId("products-page")).toBeVisible();
    await expect(page.queryByTestId("products-no-team")).toBeNull();
    await expect(page.queryByTestId("warehouse-products-page")).toBeNull();
  },
};
