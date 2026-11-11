import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { At502, At503, At504, At505, WAREHOUSE_DETAIL_META, actionsIn, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the header's acts — what each status lets the warehouse do with the box.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Actions",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// the-warehouse-signs-and-accepts-the-team-does-the-rest — ongoing: Sign for Box and Accept (a box that turns up
// unannounced can be accepted straight away, accept-locks-the-restock). Never the selling team's acts.
export const OngoingOffersSignAndAccept: Story = {
  name: "Ongoing · sign and accept",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() =>
      expect(actionsIn(canvasElement)).toEqual(["restock-action-sign-501", "restock-action-accept-501"]),
    );
  },
};

// Arrived: signed for already — Accept only.
export const ArrivedOffersAcceptOnly: Story = {
  name: "Arrived · accept only",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-accept-502", "restock-action-labels-502"]));
  },
};

// a-late-lost-box-is-signed-for-as-arrived — lost: Sign for Box only; it cannot be accepted until it is signed for.
export const LostOffersSignForBox: Story = {
  name: "Lost · sign for box",
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-sign-504"]));
  },
};

// Accepted: no status act — only what the crew does next, the labels. No Struk (there-is-no-struk).
export const AcceptedOffersLabels: Story = {
  name: "Accepted · labels",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-labels-503"]));
  },
};

// CETAK OPENS THE LABELS' ONE ADDRESS (the-labels-have-one-address) — `/inventories/restock/labels?ids=503`, the same
// page that prints several.
export const PrintOpensTheLabels: Story = {
  name: "Print opens the labels",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-labels-503"));
    await canvas.findByTestId("at-restock-labels");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=503");
  },
};

export const CancelledOffersNothing: Story = {
  name: "Cancelled · nothing",
  render: () => <At505 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

// Accepting is counting, placing and pricing — a page, not a dialog.
export const AcceptOpensTheAcceptPage: Story = {
  name: "Accept opens its page",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-accept-502"));
    await expect(await canvas.findByTestId("at-restock-accept")).toBeInTheDocument();
  },
};
