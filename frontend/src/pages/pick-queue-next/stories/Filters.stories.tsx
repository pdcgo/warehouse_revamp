import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { teams } from "../../../../.storybook/fixtures";

import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { PickQueueNextPage } from "../index";
import { HERE, NEW_HERE, PICK_QUEUE_META, rowOf } from "./kit";

// THE WAREHOUSE'S ORDER LIST — the step tabs, the crew's filters, the URL.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Warehouse/PickQueueNextPage/Filters",
  // HIDDEN from the sidebar, as the page is (../index.stories.tsx) — `tags` is read statically, so every file writes it.
  tags: ["!dev"],
  ...PICK_QUEUE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * WHERE THE FILTER CONTROLS ARE. On a phone every control but the search sits in a bottom sheet behind
 * the Filter button, and the runner's canvas is phone-width — so open it when it is there.
 */
async function filterControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const open = canvas.queryByTestId("warehouse-orders-filters-open");

  if (!open) return canvas;

  await userEvent.click(open);
  const sheet = await screen.findByTestId("warehouse-orders-filters-sheet");
  await waitFor(() => expect(sheet).toBeVisible());

  return within(sheet);
}

/**
 * THE TABS ARE THE WAREHOUSE'S STEPS (owner — `the-warehouse-tabs-are-the-processed-steps`): it opens
 * on Perlu konfirmasi with its count, Dikonfirmasi narrows to processed only, and Sudah diserahkan — a
 * status of its own now (shipping) — is a real tab with its count.
 */
export const TheTabsAreTheWarehousesSteps: Story = {
  name: "Tabs are the steps",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("pick-tab-count-toConfirm")).toHaveTextContent(String(NEW_HERE.length)),
    );
    await expect(canvas.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByTestId("pick-tab-handover")).toBeEnabled();
    await expect(canvas.getByTestId("pick-tab-count-handover")).toBeInTheDocument();

    // …and a row says what its tab says — "To confirm", not the status's own "Pending".
    const row = await rowOf(canvasElement, NEW_HERE[0]!.id);
    await expect(within(row).getByTestId(`order-status-${OrderStatus.PENDING}`)).toHaveTextContent("To confirm");

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    for (const o of NEW_HERE) {
      await waitFor(() =>
        expect(canvas.queryByTestId(`pick-queue-row-${o.id}`) ?? canvas.queryByTestId(`pick-queue-block-${o.id}`)).toBeNull(),
      );
    }
  },
};

/** The crew's filters — search, date, team, marketplace, courier. No "filter type", no second status. */
export const TheFiltersAreTheCrews: Story = {
  name: "The crew's filters",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await expect(canvas.getByTestId("warehouse-orders-search")).toBeInTheDocument();
    const controls = await filterControls(canvasElement);
    await expect(controls.getByTestId("warehouse-orders-date")).toBeInTheDocument();
    await expect(controls.getByTestId("warehouse-orders-team-filter")).toBeInTheDocument();
    await expect(controls.getByTestId("warehouse-orders-marketplace-filter")).toBeInTheDocument();
    await expect(controls.getByTestId("warehouse-orders-courier-filter")).toBeInTheDocument();
  },
};

// THE STEP AND THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the search
// are its; another tab is written back beside the search.
const AtFilteredUrl = routedPage(
  [{ path: "/warehouse-orders", element: <><PickQueueNextPage /><LocationProbe /></> }],
  "/warehouse-orders?step=all&q=melati",
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("warehouse-orders-search", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(search).toHaveValue("melati");
    await expect(canvas.getByTestId("pick-tab-all")).toHaveAttribute("aria-selected", "true");

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await waitFor(() => expect(location).toHaveTextContent("step=confirm"));
    await expect(location).toHaveTextContent("q=melati");
  },
};

/**
 * THE SELLER FILTER NARROWS THE ROWS (the-filter-gains-seller-marketplace-and-courier). Gudang Pusat ships for Toko
 * Melati and Toko Kenanga; picking Kenanga leaves Kenanga's order and drops Melati's.
 */
export const TheSellerFilterNarrowsTheRows: Story = {
  name: "Seller filter",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const kenanga = teams.find((t) => t.teamCode === "SL-02")!;
    const kenangaOrder = HERE.find((o) => o.teamId === kenanga.id)!;

    await userEvent.click(canvas.getByTestId("pick-tab-all"));
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    const controls = await filterControls(canvasElement);
    await userEvent.click(within(controls.getByTestId("warehouse-orders-team-filter")).getByRole("combobox"));

    const option = await screen.findByTestId(`team-select-option-${kenanga.teamCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() =>
      expect(
        canvas.queryByTestId(`pick-queue-row-${NEW_HERE[0]!.id}`) ?? canvas.queryByTestId(`pick-queue-block-${NEW_HERE[0]!.id}`),
      ).toBeNull(),
    );
    await rowOf(canvasElement, kenangaOrder.id);
  },
};
