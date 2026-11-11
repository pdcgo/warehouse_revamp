import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { ACCEPT_META, AtAccepted, AtOngoing, expectAccept, loaded } from "./kit";

// RESTOCK ACCEPT — the restock in each other status, as it opens: still on its way, or already counted in.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept/States",
  ...ACCEPT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** 501, still on its way — a box that turns up before anybody signed for it can still be counted in. */
export const OngoingRestock: Story = {
  name: "Ongoing",
  render: () => <AtOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // accept-locks-the-restock: ongoing is acceptable — the form is here, three lines, nothing counted yet.
    await expect(await canvas.findByTestId("accept-line-74")).toBeInTheDocument();
    await expect(canvas.getByTestId("accept-line-71")).toBeInTheDocument();
    await expect(canvas.getByTestId("accept-line-72")).toBeInTheDocument();
    await expect(canvas.queryByTestId("accept-not-acceptable")).toBeNull();
    await expectAccept(canvasElement, false);
  },
};

/** 503 is already accepted — accept-locks-the-restock refuses it, so the page says so instead of offering a count. */
export const AlreadyAcceptedIsNotAcceptable: Story = {
  name: "Already accepted",
  render: () => <AtAccepted />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("accept-not-acceptable")).toBeInTheDocument();
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ACCEPTED}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId("accept-submit")).toBeNull();
    await expect(canvas.queryByTestId(/^accept-line-/)).toBeNull();
    // The way back carries its icon (an-action-button-carries-its-icon).
    await expect(canvas.getByTestId("accept-open-restock").querySelector("svg")).not.toBeNull();
  },
};
