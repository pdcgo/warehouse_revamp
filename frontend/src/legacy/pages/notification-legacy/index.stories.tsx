import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { NOTIFICATIONS } from "../../fixtures";
import { NotificationLegacyPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Notifications/NotificationLegacy",
  component: NotificationLegacyPage,
  parameters: { docs: { description: { component: description } } },
  args: { notifications: NOTIFICATIONS },
} satisfies Meta<typeof NotificationLegacyPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ A TABLE, and that is the point of keeping it. A notification is a short message to READ, not a
// record to compare against its neighbours — so the body, which is the part that says what happened,
// gets truncated to whatever fits the column.
export const BodyIsTruncatedByTheTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("table")).toBeInTheDocument();
    await expect(canvas.getAllByTestId("legacy-body").length).toBeGreaterThan(0);
  },
};

// It has NO unread state — everything looks identical, so there is no way to tell what is new
// without remembering. The replacement expresses unread as weight.
export const NothingMarksWhatIsUnread: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByLabelText("Unread")).toBeNull();
    await expect(canvas.queryByTestId("choice-tabs")).toBeNull();
  },
};

export const Loading: Story = { args: { notifications: [], loading: true } };

export const Empty: Story = {
  args: { notifications: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No notifications");
  },
};
