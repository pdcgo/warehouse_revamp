import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { MEMBERS } from "../../fixtures";
import { MemberListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Team/MemberList",
  component: MemberListPage,
  parameters: { docs: { description: { component: description } } },
  args: { members: MEMBERS },
} satisfies Meta<typeof MemberListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("member-list-page")).toBeVisible();
    // Three people share the given name Ani — the handle is what tells them apart.
    await expect(canvas.getAllByTestId("user-cell-username").length).toBeGreaterThan(2);
  },
};

// ⚠ THE ACTIONS ARE ABOUT THE RELATIONSHIP, not the account. "Delete user" is deliberately absent —
// removing somebody from a team must not sit one mis-click away from destroying their account.
export const CannotDeleteAUserFromHere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getAllByTestId("action-menu-trigger")[0]);

    await waitFor(async () => {
      await expect(screen.getByTestId("action-Remove from team")).toBeVisible();
    });
    await expect(screen.queryByTestId("action-Delete user")).toBeNull();
  },
};

// A suspended member is SHOWN, not filtered away — they still occupy a seat and still appear in old
// records, so hiding them makes "who is in this team" wrong.
export const SuspendedMembersStillAppear: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Suspended")).toBeVisible();
  },
};

export const FilteredByRole: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(canvas.getByLabelText("Role"), "Team Owner");

    await waitFor(async () => {
      await expect(canvas.getByText("Budi Hartono")).toBeVisible();
    });
    await expect(canvas.queryByText("Ani Rahayu")).toBeNull();
  },
};

export const Loading: Story = { args: { members: [], loading: true } };

export const Empty: Story = { args: { members: [] } };
