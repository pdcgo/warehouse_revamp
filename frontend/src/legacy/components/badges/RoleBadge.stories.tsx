import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RoleBadge, description } from "./RoleBadge";

const meta = {
  title: "Legacy/Components/Badges/RoleBadge",
  component: RoleBadge,
  parameters: { docs: { description: { component: description } } },
  args: { role: Role.TEAM_OWNER },
} satisfies Meta<typeof RoleBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TeamOwner: Story = {};

export const WarehouseStaff: Story = { args: { role: Role.WAREHOUSE_STAFF } };

// Every role at once. The point of the component is that ONE place decides role → tone, so this is
// where that decision is reviewed — and where "root and admin are the loudest" stays visible.
export const EveryRole: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {[
        Role.ROOT,
        Role.ADMIN,
        Role.TEAM_OWNER,
        Role.TEAM_ADMIN,
        Role.TEAM_CUSTOMER_SERVICE,
        Role.WAREHOUSE_OWNER,
        Role.WAREHOUSE_ADMIN,
        Role.WAREHOUSE_STAFF,
        Role.SYSTEM,
      ].map((r) => (
        <RoleBadge key={r} role={r} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`role-badge-${Role.ROOT}`)).toHaveTextContent("Root");
    await expect(canvas.getByTestId(`role-badge-${Role.WAREHOUSE_STAFF}`)).toHaveTextContent(
      "Warehouse Staff",
    );
  },
};

// An unset role renders neutral and labelled, never blank — a user row with no role is a real state
// and must not look like a rendering failure.
export const Unspecified: Story = {
  args: { role: Role.UNSPECIFIED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`role-badge-${Role.UNSPECIFIED}`)).toBeInTheDocument();
  },
};
