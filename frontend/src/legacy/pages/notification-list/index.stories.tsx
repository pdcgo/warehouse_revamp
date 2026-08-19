import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { NOTIFICATIONS } from "../../fixtures";
import { NotificationListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Notifications/NotificationList",
  component: NotificationListPage,
  parameters: { docs: { description: { component: description } } },
  args: { notifications: NOTIFICATIONS, onOpen: fn(), onMarkAllRead: fn() },
} satisfies Meta<typeof NotificationListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// DECISION 1: unread is a WEIGHT, not a badge — a badge per row would put a second thing to scan
// beside the thing you are scanning.
export const UnreadIsExpressedAsWeight: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("notification-1")).toHaveAttribute("data-unread", "true");
    await expect(canvas.getByTestId("notification-3")).not.toHaveAttribute("data-unread");
  },
};

export const UnreadFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("choice-tab-unread"));

    await waitFor(async () => {
      await expect(canvas.queryByTestId("notification-3")).toBeNull();
    });
    await expect(canvas.getByTestId("notification-1")).toBeVisible();
  },
};

// Nothing unread means nothing to do — a live button that does nothing invites the click.
export const MarkAllReadIsDisabledWhenNothingIsUnread: Story = {
  args: { notifications: NOTIFICATIONS.map((n) => ({ ...n, read: true })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("mark-all-read")).toBeDisabled();
  },
};

// DECISION 2: no confirmation. It is reversible in the only sense that matters — the notifications
// are all still there — and confirming the most frequent action on a screen is friction with nothing
// behind it.
export const MarkAllReadNeedsNoConfirmation: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("mark-all-read"));

    await expect(args.onMarkAllRead).toHaveBeenCalled();
    // Straight through — no dialog in the way.
    await expect(canvas.queryByTestId("modal")).toBeNull();
  },
};

export const OpeningOne: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("notification-2"));
    await expect(args.onOpen).toHaveBeenCalledWith(2n);
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
