import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { DESKTOP, PHONE, TAG, TAG_VIEWPORTS, orderTagScenario } from "../../../.storybook/orderTagScenario";
import { orderExportScenario } from "../../../.storybook/sessionScenario";
import { OrdersPage } from "./index";

// THE SELLER'S ORDER LIST — ITS TAGS (backlog #100, live since the-order-tags-prototype-is-accepted). Orders have a tag
// list of their own (orders-have-their-own-tag-list) on the restock tags' accepted design
// (the-restock-tags-prototype-is-accepted): the order's tags as chips in a Tags column — after whose order it is (Toko /
// Tim) and before the dates, two chips + `+N`, at most two lines; the system's first, purple with a lock — and a Tag filter
// after the shop's: SEVERAL tags, an order shown when it carries ANY of them, kept in the address and sent as the list's
// `tag_ids`. The stub's OrderService plays the tags (.storybook/orderTagScenario.ts).
//
// The scene: Toko Melati's orders — 101 carries Kemasan Ulang (the warehouse's) + Kirim Pagi + VIP, 103 an admin's
// *Audit Admin*, 104 VIP; Toko Kenanga's *Bonus Stiker* (on its 110) is on the one list too, though no Melati order
// carries it. No tag here is the app's: there are no app-owned order tags for now.

const Routed = routedPage(
  [
    {
      path: "/orders",
      element: (
        <>
          <OrdersPage />
          <LocationProbe hidden />
        </>
      ),
    },
    marker("/orders/:orderId", "at-order-detail"),
  ],
  "/orders",
);

const meta = {
  title: "Pages/Order/SellerOrderListPage/Tags",
  component: OrdersPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen", viewport: { options: TAG_VIEWPORTS } },
  beforeEach: asTeam(12n),
  globals: DESKTOP,
  render: () => <Routed />,
} satisfies Meta<typeof OrdersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("order-row-101", {}, { timeout: 4000 });
  return canvas;
}

/** The filter controls — inline on a desktop, in the bottom sheet behind Filter on a phone. */
async function filterControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const open = canvas.queryByTestId("orders-filters-open");
  if (!open) return canvas;

  await userEvent.click(open);
  const sheet = await screen.findByTestId("orders-filters-sheet");
  await waitFor(() => expect(sheet).toBeVisible());
  return within(sheet);
}

/** The Tag filter opened — a click on its field; its options are inline. */
async function openTagFilter(canvasElement: HTMLElement) {
  const controls = await filterControls(canvasElement);
  const field = within(controls.getByTestId("orders-tag-filter")).getByRole("combobox");
  await userEvent.click(field);
  const first = await screen.findByTestId(`order-tag-filter-option-${TAG.audit}`, {}, { timeout: 3000 });
  await waitFor(() => expect(first).toBeVisible());
  return field;
}

const rowIds = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid^='order-row-']")].map((el) => el.getAttribute("data-testid")!.replace("order-row-", "")).sort();

/**
 * CHIPS ON EVERY ROW — a Tags column after Shop, before the dates: 101's first two chips by name and a `+1` naming VIP on
 * hover; 103's admin-made *Audit Admin* first, purple with a lock; a custom tag plain; an order with none draws nothing.
 */
export const ChipsOnEveryRow: Story = {
  name: "Chips on every row",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headers = within(canvas.getByTestId("orders-table"))
      .getAllByRole("columnheader")
      .map((el) => el.textContent);
    await expect(headers.indexOf("Tags")).toBe(headers.indexOf("Shop") + 1);
    await expect(headers[headers.indexOf("Tags") + 1]).toBe("Placed");

    const chips101 = canvas.getByTestId("order-tags-101");
    await expect([...chips101.querySelectorAll("[data-tag-type]")].map((el) => el.textContent)).toEqual(["Kemasan Ulang", "Kirim Pagi"]);
    await expect(canvas.getByTestId("order-tags-101-more")).toHaveTextContent("+1");
    await expect(canvas.getByTestId("order-tags-101-more")).toHaveAttribute("title", "VIP");
    await expect(canvas.getByTestId(`order-tags-101-${TAG.kirimPagi}`)).toHaveAttribute("data-tag-type", "custom");
    await expect(canvas.queryByTestId(`order-tags-101-${TAG.kirimPagi}-lock`)).toBeNull();

    await expect(canvas.getByTestId(`order-tags-103-${TAG.audit}`)).toHaveAttribute("data-tag-type", "system");
    await expect(canvas.getByTestId(`order-tags-103-${TAG.audit}-lock`)).toBeInTheDocument();
    await expect(canvas.getByTestId(`order-tags-104-${TAG.vip}`)).toHaveTextContent("VIP");
    await expect(canvas.getByTestId("order-tags-cell-102")).toBeEmptyDOMElement();

    // A cell is at most two lines (one-context-per-column-and-never-three-lines): 101's chips sit on one.
    const [a, b] = [...chips101.querySelectorAll("[data-tag-type]")] as HTMLElement[];
    await expect(Math.abs(a!.getBoundingClientRect().top - b!.getBoundingClientRect().top)).toBeLessThan(4);
  },
};

/**
 * ANY OF THE PICKED — the Tag filter, after the shop's and before the date, takes VIP and then *Audit Admin*: the orders
 * carrying either are left (101, 104 for VIP; 103 for Audit Admin). Kept in the address (`?tag=11,1`), counted by the
 * strip's Clear, and the picks sit as chips in the field.
 */
export const AnyOfThePickedTags: Story = {
  name: "Filter — several tags, any of them",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const strip = [...canvasElement.querySelectorAll("[data-testid$='-filter']")].map((el) => el.getAttribute("data-testid"));
    await expect(strip.indexOf("orders-tag-filter")).toBe(strip.indexOf("orders-shop-filter") + 1);

    await openTagFilter(canvasElement);
    await userEvent.click(screen.getByTestId(`order-tag-filter-option-${TAG.vip}`));
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["101", "104"]));

    await userEvent.click(screen.getByTestId(`order-tag-filter-option-${TAG.audit}`));
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["101", "103", "104"]));

    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`tag=${TAG.vip}%2C${TAG.audit}`));
    await expect(canvas.getByTestId(`order-tag-filter-pick-${TAG.vip}`)).toHaveTextContent("VIP");
    await expect(canvas.getByTestId(`order-tag-filter-pick-${TAG.audit}`)).toHaveTextContent("Audit Admin");
    await expect(canvas.getByTestId("orders-filters-clear")).toBeVisible();
  },
};

/**
 * THE FILTER OFFERS THE ORDERS' OWN LIST — every team's ORDER tags (Toko Kenanga's *Bonus Stiker*, *Pre-order* on nobody's
 * order yet), the system's first and locked; no restock tag (*Barang kurang*, *Prioritas* — another list). Typing narrows.
 */
export const TheFilterOffersTheOrdersOwnList: Story = {
  name: "Filter — the orders' own list, every team's",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    const field = await openTagFilter(canvasElement);

    const offered = [...document.querySelectorAll("[data-testid^='order-tag-filter-option-']")].map((el) =>
      el.getAttribute("data-testid")!.replace("order-tag-filter-option-", ""),
    );
    await expect(offered).toEqual([TAG.audit, TAG.bonusStiker, TAG.kemasanUlang, TAG.kirimPagi, TAG.preOrder, TAG.vip].map(String));
    await expect(screen.getByTestId(`order-tag-filter-option-${TAG.audit}`).querySelector("[data-tag-type='system']")).not.toBeNull();
    await expect(screen.queryByText("Barang kurang")).toBeNull();
    await expect(screen.queryByText("Prioritas")).toBeNull();

    await userEvent.type(field, "kir", { delay: 40 });
    await waitFor(() => expect(screen.queryByTestId(`order-tag-filter-option-${TAG.vip}`)).toBeNull());
    await expect(screen.getByTestId(`order-tag-filter-option-${TAG.kirimPagi}`)).toBeVisible();
  },
};

/**
 * OPENED AT `?tag=` A TAG NO ORDER HERE CARRIES (Toko Kenanga's *Bonus Stiker*) — the field names it, nothing matches and
 * the empty hint says so; Clear Filters takes the tag off with the rest.
 */
const AtBonusStiker = routedPage(
  [
    {
      path: "/orders",
      element: (
        <>
          <OrdersPage />
          <LocationProbe hidden />
        </>
      ),
    },
  ],
  `/orders?tag=${TAG.bonusStiker}`,
);

export const OpensFilteredFromTheAddress: Story = {
  name: "Filter — opened from the address, then cleared",
  render: () => <AtBonusStiker />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("orders-empty", {}, { timeout: 4000 });
    await expect(canvas.getByTestId(`order-tag-filter-pick-${TAG.bonusStiker}`)).toHaveTextContent("Bonus Stiker");
    await expect(canvas.getByTestId("orders-empty")).toHaveTextContent("No orders match these filters.");

    await userEvent.click(canvas.getByTestId("orders-filters-clear"));
    await canvas.findByTestId("order-row-101", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("tag="));
  },
};

/**
 * THE STATISTICS AND EKSPOR FOLLOW THE TAGS — opened at `?tag=` VIP: the rows are 101 and 104; the statistics are asked
 * with the same pick (`OrderStatFilter.tag_ids`), and Ekspor writes exactly those two rows — one predicate on the server
 * (`scopedOrders`), so the file, the cards and the table agree.
 */
const AtVip = routedPage([{ path: "/orders", element: <OrdersPage /> }], `/orders?tag=${TAG.vip}`);

export const TheStatisticsAndEksporFollowTheTags: Story = {
  name: "Filter — the statistics and Ekspor follow it",
  render: () => <AtVip />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["101", "104"]));

    await userEvent.click(canvas.getByTestId("order-summary-toggle"));
    await waitFor(() => expect(canvas.getByTestId("order-summary")).toBeInTheDocument());
    await waitFor(() => expect(orderTagScenario.statTagIds).toEqual([TAG.vip]));

    await userEvent.click(canvas.getByTestId("orders-export"));
    await expect(await screen.findByText("Export ready — the file is downloading")).toBeInTheDocument();
    await expect(orderExportScenario.last?.rows).toBe(2);
  },
};

/**
 * ON A PHONE — the seller's list stays its table, scrolling inside its own box (one-context-per-column-and-never-three-
 * lines): the Tags column is there; the Tag filter sits in the Filter sheet with the others and is counted on its button.
 */
export const OnAPhone: Story = {
  name: "Phone — the column, and the filter in the sheet",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId(`order-tags-101-${TAG.kemasanUlang}`)).toBeInTheDocument();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await openTagFilter(canvasElement);
    await userEvent.click(screen.getByTestId(`order-tag-filter-option-${TAG.vip}`));
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["101", "104"]));
  },
};

/**
 * BESIDE A STATUS DATE — with the date filter on a status (`?date=shipping`) the list gains its *Tgl {status}* column
 * (the-order-list-filters-by-seven-dates); the Tags column keeps its place after Shop, and the widest view still reads.
 */
const AtStatusDate = routedPage([{ path: "/orders", element: <OrdersPage /> }], "/orders?date=shipping");

export const TheColumnBesideAStatusDate: Story = {
  name: "Beside a status date column",
  render: () => <AtStatusDate />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headers = within(canvas.getByTestId("orders-table"))
      .getAllByRole("columnheader")
      .map((el) => el.textContent);
    await expect(headers).toEqual([
      "Order ID",
      "Tracking no.",
      "Shop",
      "Tags",
      "Placed",
      "MP date",
      "Handed over on",
      "Cost",
      "MP total · Margin",
      "Actions",
    ]);
    await expect(canvas.getByTestId(`order-tags-101-${TAG.kemasanUlang}`)).toBeVisible();
  },
};
