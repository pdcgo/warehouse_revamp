import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { users } from "../../.storybook/fixtures";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { UserItem, description } from "./UserItem";

const meta = {
  title: "Components/UserItem",
  component: UserItem,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    user: { name: users[0]!.name, username: users[0]!.username, avatarUrl: "" },
  },
} satisfies Meta<typeof UserItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRole: Story = {
  args: { role: Role.WAREHOUSE_ADMIN },
};

export const Medium: Story = {
  args: { size: "md" },
};

export const WithAction: Story = {
  args: { action: <Button size="xs">Remove</Button> },
};

export const InAList: Story = {
  render: () => (
    <Stack gap="3" w="80">
      {users.map((u) => (
        <UserItem key={u.username} user={{ name: u.name, username: u.username, avatarUrl: "" }} />
      ))}
    </Stack>
  ),
};

// The name and the @username are BOTH shown, always. Two people can share a display name, so the
// username is what makes a row in a picker unambiguous — dropping it to save space is the change
// this story exists to catch.
export const ShowsNameAndUsername: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText(users[0]!.name)).toBeInTheDocument();
    await expect(canvas.getByText(`@${users[0]!.username}`)).toBeInTheDocument();
  },
};

// An account with no display name falls back to the username rather than rendering an empty line.
export const FallsBackToUsername: Story = {
  args: { user: { name: "", username: "operator", avatarUrl: "" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("operator")).toBeInTheDocument();
    await expect(canvas.getByText("@operator")).toBeInTheDocument();
  },
};

// UNSPECIFIED is not a role, so it must not render an empty badge beside the username.
export const UnspecifiedRoleShowsNoBadge: Story = {
  args: { role: Role.UNSPECIFIED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByText("Unknown")).toBeNull();
  },
};
