import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { DESKTOP, PHONE, TAG, TAG_VIEWPORTS, orderTagScenario } from "../../../../.storybook/orderTagScenario";
import { orderExportScenario } from "../../../../.storybook/sessionScenario";
import { PickQueuePage } from "../index";

// THE WAREHOUSE'S ORDER LIST — ITS TAGS (backlog #100, live since the-order-tags-prototype-is-accepted). The warehouse that
// ships an order sees and filters the same tags the selling team does — the order's own (orders-have-their-own-tag-list:
// the restock tags' rules on the orders' own list), on the restock tags' accepted design
// (the-restock-tags-prototype-is-accepted): a Tags column after Status (two chips + `+N`, at most two lines), a line of
// chips in a phone's block, and a Tag filter beside the courier's — several tags, an order shown when it carries ANY of
// them, kept in the address and sent as the list's `tag_ids` (so the tab counts follow). The stub's OrderService plays
// the tags (.storybook/orderTagScenario.ts).
//
// The scene: Gudang Pusat (11) ships Toko Melati's 101 (Kemasan Ulang — its own — + Kirim Pagi + VIP), 103 (an admin's
// *Audit Admin*), 104 (VIP), 105 (Kemasan Ulang) and Toko Kenanga's 110 (Bonus Stiker).

const Routed = (path: string) =>
  routedPage(
    [
      {
        path: "/warehouse-orders",
        element: (
          <>
            <PickQueuePage />
            <LocationProbe hidden />
          </>
        ),
      },
      marker("/warehouse-orders/:orderId", "at-pick-order"),
    ],
    path,
  );

const AtAll = Routed("/warehouse-orders?step=all");

const meta = {
  title: "Pages/Warehouse/PickQueuePage/Tags",
  component: PickQueuePage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen", viewport: { options: TAG_VIEWPORTS } },
  beforeEach: asTeam(11n),
  globals: DESKTOP,
  render: () => <AtAll />,
} satisfies Meta<typeof PickQueuePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The row's own element — a table row on a desktop, a block on a phone. */
async function rowOf(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  return waitFor(() => canvas.queryByTestId(`pick-queue-row-${id}`) ?? canvas.getByTestId(`pick-queue-block-${id}`), {
    timeout: 4000,
  });
}

/** The filter controls — inline on a desktop, in the bottom sheet behind Filter on a phone. */
async function filterControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const open = canvas.queryByTestId("warehouse-orders-filters-open");
  if (!open) return canvas;

  await userEvent.click(open);
  const sheet = await screen.findByTestId("warehouse-orders-filters-sheet");
  await waitFor(() => expect(sheet).toBeVisible());
  return within(sheet);
}

const shownIds = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid^='pick-queue-row-'], [data-testid^='pick-queue-block-']")]
    .map((el) => el.getAttribute("data-testid")!.replace(/^pick-queue-(row|block)-/, ""))
    .sort();

/**
 * CHIPS ON EVERY ROW — a Tags column right after Status, before the dates: the selling team's tags and the warehouse's
 * own alike (101's *Kemasan Ulang* is Gudang Pusat's), another seller's too (Toko Kenanga's *Bonus Stiker* on 110), the
 * system's first and locked (103). An order with none draws nothing.
 */
export const ChipsOnEveryRow: Story = {
  name: "Chips on every row",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);
    const headers = within(canvas.getByTestId("pick-queue-table"))
      .getAllByRole("columnheader")
      .map((el) => el.textContent);
    await expect(headers.indexOf("Tags")).toBe(headers.indexOf("Status") + 1);
    await expect(headers[headers.indexOf("Tags") + 1]).toBe("Date");

    const chips101 = canvas.getByTestId("order-tags-101");
    await expect([...chips101.querySelectorAll("[data-tag-type]")].map((el) => el.textContent)).toEqual(["Kemasan Ulang", "Kirim Pagi"]);
    await expect(canvas.getByTestId("order-tags-101-more")).toHaveAttribute("title", "VIP");
    await expect(canvas.getByTestId(`order-tags-110-${TAG.bonusStiker}`)).toHaveTextContent("Bonus Stiker");
    await expect(canvas.getByTestId(`order-tags-103-${TAG.audit}-lock`)).toBeInTheDocument();
    await expect(canvas.getByTestId("order-tags-cell-102")).toBeEmptyDOMElement();
  },
};

/**
 * ANY OF THE PICKED — the Tag filter beside the courier's takes *Kemasan Ulang* and *Bonus Stiker*: 101 and 105 (the
 * first), 110 (the second) are left. In the address (`?tag=14,13`), counted by the strip's Clear.
 */
export const AnyOfThePickedTags: Story = {
  name: "Filter — several tags, any of them",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);

    const strip = [...canvasElement.querySelectorAll("[data-testid$='-filter']")].map((el) => el.getAttribute("data-testid"));
    await expect(strip.indexOf("warehouse-orders-tag-filter")).toBe(strip.indexOf("warehouse-orders-courier-filter") + 1);

    const controls = await filterControls(canvasElement);
    await userEvent.click(within(controls.getByTestId("warehouse-orders-tag-filter")).getByRole("combobox"));
    const option = await screen.findByTestId(`order-tag-filter-option-${TAG.kemasanUlang}`, {}, { timeout: 3000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(shownIds(canvasElement)).toEqual(["101", "105"]));

    await userEvent.click(screen.getByTestId(`order-tag-filter-option-${TAG.bonusStiker}`));
    await waitFor(() => expect(shownIds(canvasElement)).toEqual(["101", "105", "110"]));
    await waitFor(() =>
      expect(canvas.getByTestId("location-search")).toHaveTextContent(`tag=${TAG.kemasanUlang}%2C${TAG.bonusStiker}`),
    );
    await expect(canvas.getByTestId("warehouse-orders-filters-clear")).toBeVisible();
  },
};

/**
 * THE TAB COUNTS AND EKSPOR FOLLOW THE TAGS — opened at `?tag=` *Kemasan Ulang* + *Bonus Stiker*: the rows are 101, 105
 * and 110; the tabs' counts are asked with the same pick (`OrderStatFilter.tag_ids`) and Semua counts those three, and
 * Ekspor with nothing ticked writes exactly them — one predicate on the server (`scopedOrders`).
 */
const AtTwoTags = Routed(`/warehouse-orders?step=all&tag=${TAG.kemasanUlang}%2C${TAG.bonusStiker}`);

export const TheTabCountsAndEksporFollowTheTags: Story = {
  name: "Filter — the tab counts and Ekspor follow it",
  render: () => <AtTwoTags />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);
    await waitFor(() => expect(shownIds(canvasElement)).toEqual(["101", "105", "110"]));

    await waitFor(() => expect(orderTagScenario.statTagIds).toEqual([TAG.kemasanUlang, TAG.bonusStiker]));
    await waitFor(() => expect(canvas.getByTestId("pick-tab-count-all")).toHaveTextContent("3"));

    await userEvent.click(canvas.getByTestId("pick-queue-bulk-export"));
    await expect(await screen.findByText("Export ready — the file is downloading")).toBeInTheDocument();
    await expect(orderExportScenario.last?.rows).toBe(3);
  },
};

/** ON A PHONE — each block carries its tags as a line of chips under the status (up to three, wrapping); none run off. */
export const OnAPhone: Story = {
  name: "Phone — a line of chips in each block",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(window.innerWidth).toBe(390);
    const block = within(await canvas.findByTestId("pick-queue-block-101", {}, { timeout: 4000 }));

    for (const id of [TAG.kemasanUlang, TAG.kirimPagi, TAG.vip]) {
      await expect(block.getByTestId(`order-tags-101-${id}`)).toBeVisible();
    }
    await expect(canvas.getByTestId(`order-tags-110-${TAG.bonusStiker}`)).toBeVisible();
    await expect(within(canvas.getByTestId("pick-queue-block-102")).queryByTestId("order-tags-102")).toBeNull();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
