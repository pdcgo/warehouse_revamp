import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockStatusBadge, description } from "./RestockStatusBadge";

const meta = {
  title: "Components/Badges/RestockStatusBadge",
  component: RestockStatusBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { status: RestockRequestStatus.PENDING },
} satisfies Meta<typeof RestockStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};

export const Fulfilled: Story = { args: { status: RestockRequestStatus.FULFILLED } };

export const Cancelled: Story = { args: { status: RestockRequestStatus.CANCELLED } };

// Blue is the ACTIONABLE state, green a positive terminal one, gray inert. Reviewing them together
// is what keeps that a rule rather than three separate colour choices.
export const AllStatuses: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {[
        RestockRequestStatus.PENDING,
        RestockRequestStatus.FULFILLED,
        RestockRequestStatus.CANCELLED,
      ].map((s) => (
        <RestockStatusBadge key={s} status={s} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Unlike OrderStatusBadge these labels were ALREADY translated before the badge was extracted,
    // so a shared component that quietly dropped i18n would be a regression. Asserting real words
    // (not the key) is what catches a missing catalogue entry.
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.PENDING}`)).toHaveTextContent(
      /pending/i,
    );
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.FULFILLED}`)).not.toHaveTextContent(
      "restock.status",
    );
  },
};
