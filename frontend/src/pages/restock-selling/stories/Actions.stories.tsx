import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { SELLING_META, closeMenu, loaded, menuOf } from "./kit";

// RESTOCK SELLING — the row's ⋯ — what each status offers, and the acts it runs from the row. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Actions",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const OngoingRowMenu: Story = {
  name: "Ongoing menu",
  play: async ({ canvasElement }) => {
    await menuOf(await loaded(canvasElement), 501);
  },
};

// the-warehouse-signs-and-accepts-the-team-does-the-rest — the row menu follows the status: ongoing Edit · Cancel ·
// Mark Lost; arrived Edit Lines only; accepted, lost and cancelled nothing of their own — and Catatan last in every
// one (the-list-opens-the-notes-in-a-dialog).
export const TheRowMenuFollowsTheStatus: Story = {
  name: "Menu by status",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await menuOf(canvas, 501)).toEqual([
      "restock-action-edit-501",
      "restock-action-cancel-501",
      "restock-action-mark-lost-501",
      "restock-action-notes-501",
    ]);
    await closeMenu();

    await expect(await menuOf(canvas, 502)).toEqual(["restock-action-edit-lines-502", "restock-action-notes-502"]);
    await closeMenu();

    for (const id of [503, 504, 505, 507]) {
      await expect(await menuOf(canvas, id)).toEqual([`restock-action-notes-${id}`]);
      await closeMenu();
    }
  },
};

// Edit Lines opens the same edit form — the form applies the arrived rules.
export const EditLinesOpensTheEditForm: Story = {
  name: "Edit lines",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 502);
    await userEvent.click(screen.getByTestId("restock-action-edit-lines-502"));
    await expect(await canvas.findByTestId("at-restock-edit")).toBeInTheDocument();
  },
};

// a-restock-names-its-paying-account — cancelling from the row asks the money question too, and the row moves to
// cancelled.
export const CancelFromTheRowAsksAboutTheMoney: Story = {
  name: "Cancel",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-cancel-501"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    // It warns that a cancellation is checked (a-restock-cancel-warns-it-will-be-checked).
    const review = screen.getByTestId("restock-cancel-review");
    await expect(review).toHaveTextContent("Cancelling a restock will be checked.");
    // …and nothing checks it yet: marked, the list's fifth.
    await expect(within(review).getByTestId("not-implemented-cancelReview")).toHaveTextContent("5");
    await expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByTestId("restock-cancel-money-no"));
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.CANCELLED}`)).toBeVisible());
    // Cancelled, its menu is Catatan alone (the-list-opens-the-notes-in-a-dialog).
    await expect(await menuOf(canvas, 501)).toEqual(["restock-action-notes-501"]);
    await closeMenu();
    // The dialog did not navigate the row behind it.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// lost-is-set-only-before-the-box-arrives — Mark Lost from the row.
export const MarkLostFromTheRow: Story = {
  name: "Mark lost",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-mark-lost-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.LOST}`)).toBeVisible());
  },
};
