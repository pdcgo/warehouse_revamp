import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { NOTIFICATIONS } from "../../fixtures";
import { NotificationDetailPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Notifications/NotificationDetail",
  component: NotificationDetailPage,
  parameters: { docs: { description: { component: description } } },
  args: { notification: NOTIFICATIONS[0], actionHref: "/stocks/low", actionLabel: "See low stock" },
} satisfies Meta<typeof NotificationDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// THE reason this screen beats the list entry: it takes you to the thing. A notification you can
// only read is one that made you go and find the subject yourself.
export const TakesYouToTheThing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("notification-action")).toHaveAttribute("href", "/stocks/low");
  },
};

// An announcement has nowhere to go, and the screen SAYS so rather than rendering a dead button — a
// disabled primary action on a detail screen reads as something that failed to load.
export const AnnouncementSaysThereIsNothingToOpen: Story = {
  args: { notification: NOTIFICATIONS[3], actionHref: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("notification-no-action")).toBeVisible();
    await expect(canvas.queryByTestId("notification-action")).toBeNull();
  },
};

export const BillingAlert: Story = {
  args: { notification: NOTIFICATIONS[2], actionHref: "/billing", actionLabel: "Open billing" },
};
