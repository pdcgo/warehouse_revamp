import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { ParcelCard, RouteCard, TransferLinesCard } from "./TransferDetailCards";
import { storyTransfer } from "./storyTransfer";

// The three cards both transfer detail pages read — what differs by reader is passed in: the owner sees the money, a
// warehouse crew sees none, and the sending warehouse sees its pick list until it ships.
function Cards({
  id,
  showMoney,
  showPicks,
}: {
  id: bigint;
  showMoney: boolean;
  showPicks: boolean;
}) {
  const transfer = storyTransfer(id);

  return (
    <Stack gap="section">
      <RouteCard transfer={transfer} />
      <ParcelCard transfer={transfer} teamId={12n} showMoney={showMoney} />
      <TransferLinesCard transfer={transfer} showPrices={showMoney} showPicks={showPicks} />
    </Stack>
  );
}

const meta = {
  title: "Features/WarehouseTransfer/TransferDetailCards",
  component: Cards,
  parameters: { signedIn: true },
  args: { id: 603n, showMoney: true, showPicks: false },
} satisfies Meta<typeof Cards>;

export default meta;
type Story = StoryObj<typeof meta>;

// The owner's view: the courier A entered, the cost the team entered, the value of the goods.
export const AsTheOwner: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-detail-tracking")).toHaveTextContent("JNE7788990011");
    await expect(canvas.getByTestId("transfer-detail-shipping-cost")).toHaveTextContent("18.000");
    await expect(canvas.getByTestId("transfer-detail-total")).toHaveTextContent("488.000");
  },
};

// A warehouse crew's view: no money anywhere.
export const AsAWarehouse: Story = {
  args: { showMoney: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/Rp\s/)).toBeNull();
  },
};

// The sending warehouse before it ships: where to take each product from.
export const WithThePickList: Story = {
  args: { id: 601n, showMoney: false, showPicks: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("transfer-line-6012-picks")).toHaveTextContent("B-02-1 × 6"));
  },
};

// Accepted with problems: what arrived, what broke, what never came, where the good units went — and the loss.
export const AcceptedWithProblems: Story = {
  args: { id: 605n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-detail-loss")).toHaveTextContent("130.000");
    await expect(canvas.getByTestId("transfer-detail-on-site")).toHaveTextContent("Biaya bongkar kurir");
  },
};
