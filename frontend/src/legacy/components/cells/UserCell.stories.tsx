import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { UserCell, description } from "./UserCell";

const meta = {
  title: "Legacy/Components/Cells/UserCell",
  component: UserCell,
  parameters: { docs: { description: { component: description } } },
  args: { user: { id: 57n, name: "Ani Rahayu", username: "ani.r" } },
} satisfies Meta<typeof UserCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("Ani Rahayu");
    await expect(canvas.getByTestId("user-cell-username")).toHaveTextContent("@ani.r");
  },
};

// THE case the handle exists for: three people called Ani. The display name alone is ambiguous on a
// members list, an audit trail, or a "who picked this" column — the handle is the unique one.
export const ThreePeopleCalledAni: Story = {
  render: () => (
    <Stack gap="2">
      <UserCell user={{ id: 57n, name: "Ani Rahayu", username: "ani.r" }} />
      <UserCell user={{ id: 91n, name: "Ani Wijaya", username: "ani.w" }} />
      <UserCell user={{ id: 104n, name: "Ani", username: "ani.gudang" }} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const handles = canvas.getAllByTestId("user-cell-username").map((el) => el.textContent);
    await expect(new Set(handles).size).toBe(3);
  },
};

// No photo is the common case, so the avatar falls back to INITIALS. A column of identical grey
// silhouettes carries no information at all.
export const NoPhotoShowsInitials: Story = {
  args: { user: { id: 57n, name: "Ani Rahayu" } },
};

export const Unresolved: Story = {
  args: { user: undefined, userId: 57n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("#57");
  },
};

export const Loading: Story = { args: { user: undefined, loading: true } };
