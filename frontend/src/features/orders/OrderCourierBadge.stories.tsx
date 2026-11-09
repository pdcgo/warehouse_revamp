import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { OrderCourierBadge, description } from "./OrderCourierBadge";
import { shipmentChannels } from "../../../.storybook/fixtures";

// An order's courier, by id, named from the shared catalogue the stub serves (fixtures' shipmentChannels):
//   | TheIdIsNamedFromTheCatalogue | 91 → JNE, in the courier's badge                                    |
//   | ADeletedChannelIsStillNamed  | 94 → POS Indonesia, marked deleted (a-deleted-channel-still-resolves-by-id) |
//   | AnUnknownIdShowsItself       | 999 → #999, never a borrowed name                                     |
//   | NoCourierIsADash             | 0 → —                                                                 |
const meta = {
  title: "Features/Orders/OrderCourierBadge",
  component: OrderCourierBadge,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof OrderCourierBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const jne = shipmentChannels.find((c) => c.code === "jne")!;
const pos = shipmentChannels.find((c) => c.code === "pos")!;

export const TheIdIsNamedFromTheCatalogue: Story = {
  args: { channelId: jne.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shipment-channel-badge-jne")).toHaveTextContent("JNE"));
  },
};

export const ADeletedChannelIsStillNamed: Story = {
  args: { channelId: pos.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shipment-channel-badge-deleted-pos")).toBeVisible());
    await expect(canvas.getByTestId("shipment-channel-badge-pos")).toHaveTextContent(pos.name);
  },
};

export const AnUnknownIdShowsItself: Story = {
  args: { channelId: 999n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shipment-channel-badge-unknown-999")).toHaveTextContent("#999"));
  },
};

export const NoCourierIsADash: Story = {
  args: { channelId: 0n },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("shipment-channel-badge-none")).toHaveTextContent("—");
  },
};
