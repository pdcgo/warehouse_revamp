import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { teams } from "../../../../.storybook/fixtures";

import { WAREHOUSE_ORDERS_PENDING } from "../pending";
import { NEW_HERE, PICK_QUEUE_META, PROCESSED_HERE, rowOf } from "./kit";

// THE WAREHOUSE'S ORDER LIST — without the marks, a selling team turned away, every gap marked.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Warehouse/PickQueueNextPage/States",
  // HIDDEN from the sidebar, as the page is (../index.stories.tsx) — `tags` is read statically, so every file writes it.
  tags: ["!dev"],
  ...PICK_QUEUE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SELLER = teams[1]!; // Toko Melati (12)

export const WithoutTheMarks: Story = {
  name: "Without the marks",
  globals: { pendingMarks: "off" },
};

export const ASellingTeamIsTurnedAway: Story = {
  name: "Seller turned away",
  beforeEach: asTeam(SELLER.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("pick-queue-not-warehouse")).toBeInTheDocument());
  },
};

/** ⚠ Every fact the row invents has its badge on screen. */
export const EveryDeclaredGapIsMarkedOnScreen: Story = {
  name: "Every gap marked",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    // The workbench's marks: the bulk bar (select a row), the handover dialog, the validation item in a
    // processed row's menu — each opened, checked, closed.
    const found = new Set<string>();
    const collect = () => {
      for (const el of screen.queryAllByTestId(/^not-implemented-/)) found.add(el.getAttribute("data-testid")!.replace("not-implemented-", ""));
    };

    await userEvent.click(within(canvas.getByTestId(`pick-queue-select-${NEW_HERE[0]!.id}`)).getByRole("checkbox", { hidden: true }));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-bar")).toBeInTheDocument());
    collect();

    await userEvent.click(canvas.getByTestId("warehouse-orders-handover"));
    await screen.findByTestId("handover-dialog");
    collect();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("handover-dialog")).toBeNull());

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));
    await waitFor(() => expect(screen.getByTestId(`pick-queue-validate-${PROCESSED_HERE.id}`)).toBeVisible());
    collect();
    await userEvent.keyboard("{Escape}");

    // The All tab's rows. The filters carry no mark any more: all three are real
    // (the-filter-gains-seller-marketplace-and-courier).
    await userEvent.click(canvas.getByTestId("pick-tab-all"));
    await rowOf(canvasElement, NEW_HERE[0]!.id);
    collect();

    for (const part of WAREHOUSE_ORDERS_PENDING.parts) {
      await expect(found.has(part.id), part.id).toBe(true);
    }
  },
};
