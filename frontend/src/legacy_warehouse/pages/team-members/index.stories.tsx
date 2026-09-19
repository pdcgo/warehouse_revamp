import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { MEMBERS } from "../../fixtures";
import { TeamMembersPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/TeamMembers",
  component: TeamMembersPage,
  parameters: { docs: { description: { component: description } } },
  args: { members: MEMBERS },
} satisfies Meta<typeof TeamMembersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("shift-cell")).toHaveLength(5);
  },
};

// ⚠ "WHAT YOU MAY DO" AND "ARE YOU HERE" ARE TWO COLUMNS, side by side. That adjacency is what makes
// the distinction legible — same person, two different facts, changing on different timescales.
export const RolesAndShiftAreDifferentColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("columnheader", { name: /can do/i })).toBeVisible();
    await expect(canvas.getByRole("columnheader", { name: /on shift/i })).toBeVisible();
  },
};

// Somebody who has gone home keeps their roles. Deactivating the account instead would lock them out
// tomorrow — and leaving everyone active makes "who packed this?" unanswerable.
export const GoingHomeDoesNotRemoveWhatYouMayDo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("Dedi Kurniawan").closest("tr")!;
    await expect(within(row).getByTestId("shift-cell")).toHaveAttribute("data-on-shift", "false");
    // Still carries both roles.
    await expect(row).toHaveTextContent("picker");
    await expect(row).toHaveTextContent("packer");
  },
};

// ⚠ THE HEADLINE IS "HOW MANY ARE HERE", not "how many do we have". One is a hiring question; the
// other decides whether today's volume is achievable.
export const OnShiftIsTheHeadlineNotHeadcount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const items = canvas.getAllByTestId("summary-item");
    await expect(items[0]).toHaveTextContent("On shift now");
    await expect(items[0]).toHaveTextContent("3");
  },
};

// Flipping a shift is one click and does NOT confirm — it is trivially reversible, and a
// confirmation on something done forty times a day is a dialog people learn to dismiss unread.
export const StartingAShiftDoesNotConfirm: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getAllByTestId("toggle-shift")[0]);
    await expect(within(document.body).queryByRole("alertdialog")).toBeNull();
  },
};

// Somebody added and never seen again is a real state, and it looks different from somebody who is
// simply off today.
export const AMemberWhoHasNeverWorked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("Eka Putri").closest("tr")!;
    await expect(within(row).getByText("Off")).toBeVisible();
  },
};

export const NobodyYet: Story = {
  args: { members: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("members-table")).toHaveTextContent("Nobody here yet");
  },
};

export const Loading: Story = { args: { members: [], loading: true } };
