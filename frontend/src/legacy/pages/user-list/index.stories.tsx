import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { MEMBERS } from "../../fixtures";
import { UserListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Team/UserList",
  component: UserListPage,
  parameters: { docs: { description: { component: description } } },
  args: { users: MEMBERS },
} satisfies Meta<typeof UserListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("user-list-page")).toBeVisible();
  },
};

// ⚠ The screen SAYS its actions are system-wide. Suspending here signs the person out of every team,
// and nothing about a row makes that visible.
export const StatesThatItsActionsAreSystemWide: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("user-list-scope-warning")).toHaveTextContent(
      /affect the account everywhere/i,
    );
  },
};

// The dangerous, account-level operations live HERE — not on the member list, where "remove" means
// something much smaller.
export const OwnsTheAccountLevelActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getAllByTestId("action-menu-trigger")[0]);

    await waitFor(async () => {
      await expect(screen.getByTestId("action-Delete account")).toBeVisible();
    });
    await expect(screen.getByTestId("action-Suspend account")).toBeVisible();
  },
};

export const Loading: Story = { args: { users: [], loading: true } };

export const LoadFailed: Story = { args: { users: [], isError: true } };
