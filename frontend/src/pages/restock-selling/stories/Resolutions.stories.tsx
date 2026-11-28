import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { restockResolutionScenario } from "../../../../.storybook/restockResolutionScenario";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockSettledFilter } from "../../../gen/warehouse/inventory/v1/restock_resolution_pb";
import { DESKTOP, PHONE, SELLING_LIST_META, sellingAt } from "../../../features/restockResolution/storyKit";

// THE SELLER'S PROBLEM LIST, WITH RESOLUTIONS (backlog #101, live since the-restock-resolutions-prototype-is-accepted).
// The problem list is the restock list filtered by *Barang kurang* + *Barang rusak* (a-restock-problem-is-a-system-tag,
// built #89); the lost ones are the Hilang tab. With resolutions recorded a row reads *N resolutions* (the row's
// `resolution_count`) beside its *kurang N* / *rusak N* (the desktop table: the icon and the count beside the status, its
// words in the tooltip — the column does not widen); marked settled it reads *Settled* — its tags are off, so it leaves
// the problem filter, and a settled lost restock leaves the Hilang tab: the tab asks LOST + UNSETTLED of the server
// (🔄 *"A"*: *listed under the Hilang tab until the seller marks it settled*) — both still under Semua.
//
// The seed: 503 (kurang 1 · rusak 2, two resolutions, open), 504 (Hilang, two resolutions, open), 507 (kurang 3, a refund,
// SETTLED — its Barang kurang came off).

const ProblemList = sellingAt("/inventories/restock?tag=1,2");
const Everything = sellingAt("/inventories/restock");
const LostTab = sellingAt("/inventories/restock?status=lost");
const From504 = sellingAt("/inventories/restock/504");

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Resolutions",
  component: ProblemList,
  ...SELLING_LIST_META,
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rowIds = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid^='restock-row-']")].map((el) => el.getAttribute("data-testid"));

/** THE PROBLEM LIST — filtered by the two problem tags: 503 with its counts and *2 resolutions*; settled 507 is gone. */
export const TheProblemList: Story = {
  name: "Problem list — open ones with their resolutions",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-503", {}, { timeout: 4000 });
    await expect(rowIds(canvasElement)).toEqual(["restock-row-503"]);
    await expect(canvas.getByTestId("restock-missing-503")).toBeVisible();
    await expect(canvas.getByTestId("restock-broken-503")).toBeVisible();
    await expect(canvas.getByTestId("restock-resolutions-503")).toHaveTextContent(/^2$/);
    await expect(canvas.getByTestId("restock-resolutions-503")).toHaveAttribute("title", "2 resolutions");
  },
};

/** SEMUA STATUS — how each reads: 503 and 504 *2 resolutions* (open), 507 *Settled*; a restock with no problem has neither. */
export const HowEachReads: Story = {
  name: "All — open, settled, none",
  render: () => <Everything />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-507", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("restock-resolutions-503")).toHaveAttribute("title", "2 resolutions");
    await expect(canvas.getByTestId("restock-resolutions-504")).toHaveAttribute("title", "2 resolutions");
    await expect(canvas.getByTestId("restock-settled-507")).toHaveTextContent("Settled");
    await expect(canvas.getByTestId("restock-missing-507")).toBeVisible();
    await expect(canvas.queryByTestId("restock-resolutions-501")).toBeNull();
    await expect(canvas.queryByTestId("restock-settled-501")).toBeNull();
    // Semua asks no settled filter.
    await expect(restockResolutionScenario.listAsks.at(-1)).toEqual({ status: RestockRequestStatus.UNSPECIFIED, settled: RestockSettledFilter.UNSPECIFIED });
  },
};

/** THE HILANG TAB — LOST + UNSETTLED asked of the server: the lost restock still open, with its resolutions. */
export const TheLostTab: Story = {
  name: "Hilang tab — an open lost restock (LOST + UNSETTLED)",
  render: () => <LostTab />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-504", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("restock-resolutions-504")).toHaveAttribute("title", "2 resolutions");
    await expect(restockResolutionScenario.listAsks.at(-1)).toEqual({ status: RestockRequestStatus.LOST, settled: RestockSettledFilter.UNSETTLED });
  },
};

/**
 * SETTLED, IT LEAVES THE HILANG TAB — 504 marked settled on its page; back on the list the Hilang tab no longer holds it,
 * Semua shows it *Settled*.
 */
export const SettledLeavesTheLostTab: Story = {
  name: "Settled — leaves the Hilang tab, stays under All",
  render: () => <From504 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = within(await canvas.findByTestId("restock-detail-resolutions-section", {}, { timeout: 4000 }));
    await userEvent.click(box.getByTestId("resolution-settle"));
    const dialog = await screen.findByRole("alertdialog", {}, { timeout: 3000 });
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await box.findByTestId("resolution-settled", {}, { timeout: 3000 });

    await userEvent.click(canvas.getByTestId("restock-detail-back"));
    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("restock-settled-504")).toHaveTextContent("Settled"));
    await userEvent.click(canvas.getByTestId("restock-tab-lost"));
    await waitFor(() => expect(canvas.queryByTestId("restock-row-504")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("restock-requests-empty")).toBeVisible(), { timeout: 3000 });
  },
};

/** ON A PHONE — the mark on the block's status line. */
export const OnAPhone: Story = {
  name: "Phone — the mark on the status line",
  render: () => <Everything />,
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-507", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("restock-settled-507")).toBeVisible();
    await expect(canvas.getByTestId("restock-resolutions-503")).toHaveTextContent("2 resolutions");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
