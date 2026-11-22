import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { besideTheOpenSidebar } from "../../../.storybook/pageStory";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";
import i18n from "../../i18n/config";
import {
  ACCEPTED_HERE,
  GOING_ELSEWHERE,
  PHONE,
  RETURNS_META,
  WAITING_HERE,
  counts,
  listedIds,
  noRowOf,
  orderById,
  rowOf,
} from "./stories/kit";

// INVENTARIS › RETUR — the warehouse's real list of returns (the-retur-menu-is-the-warehouses-return-list, accepted as
// drawn in the-retur-list-prototype-is-accepted), on the real OrderList / OrderStat stubs. Gudang Pusat (11), its Admin.
// Default and Mobile lead; the rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Rows      what a row opens — Terima → the accept page, an accepted return → the order, Kembali ke …, the monitor,
//             Receive a Return
//   Filters   the tabs and filters in the URL, an address reopening the same list, the filters narrowing rows and counts
//   States    the empty tab, nothing matching, the pager, a selling team

const meta = {
  title: "Pages/Warehouse/ReturnsPage",
  ...RETURNS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * THE WAITING RETURNS — Gudang Pusat's own and the one its seller sends back to it — newest order first, each with its
 * order and buyer, seller, storefront + ref, courier + resi, units, state and when it was asked. The tabs count the two
 * states; an order that is no return is not here; no money is shown.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const id of WAITING_HERE) await rowOf(canvasElement, id);
    await counts(canvasElement, WAITING_HERE.length, ACCEPTED_HERE.length);
    await expect(canvas.getByTestId("return-list-tab-waiting")).toHaveAttribute("aria-selected", "true");

    // Newest order first, as OrderList answers.
    await waitFor(() => expect(listedIds(canvasElement)).toEqual(WAITING_HERE.map(String)));

    const row = within(canvas.getByTestId("return-list-row-101"));
    const o = orderById(101n);
    await expect(canvas.getByTestId("return-list-order-101")).toHaveTextContent("#101");
    await expect(row.getByText(o.customerName)).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("return-list-seller-101")).toHaveTextContent("Toko Melati"));
    await waitFor(() => expect(row.getByText("Melati Official")).toBeInTheDocument());
    await expect(row.getByText(o.orderExternalRefId!)).toBeInTheDocument();
    await expect(row.getByText(o.receiptCode)).toBeInTheDocument();
    // The units over the order's lines (2 + 1 + 1).
    await expect(canvas.getByTestId("return-list-qty-101")).toHaveTextContent(/^4$/);
    await expect(canvas.getByTestId("return-list-state-101")).toHaveTextContent("Awaiting acceptance");
    // WHEN IT WAS ASKED — the date the read's date_field (ENTERED_RETURN) fills; never the "—" of a row without it.
    await expect(canvas.getByTestId("return-list-asked-101")).toBeInTheDocument();
    await expect(canvas.queryByTestId("return-list-asked-101-none")).toBeNull();
    // The waiting tab has no Accepted column — nothing on it was accepted.
    await expect(canvas.queryByRole("columnheader", { name: "Accepted" })).toBeNull();

    // An order that is no return (106, shipping) is on the warehouse's order list, never here.
    await noRowOf(canvasElement, 106n);
    await noRowOf(canvasElement, 107n);
    await expect(canvasElement.textContent).not.toMatch(/Rp/);
    await expect(canvas.getByTestId("return-list-pager")).toBeInTheDocument();
  },
};

/**
 * ON A PHONE a return is a block — its state and Terima first, where it goes, the storefront, the resi, whose it is, when
 * it was asked (and accepted) — Receive a Return is the header's icon, and nothing runs past the 390 px screen.
 */
export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const block = await canvas.findByTestId("return-list-block-101", {}, { timeout: 4000 });

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.queryByTestId("return-list-table")).toBeNull();
    await expect(canvas.getByTestId("return-list-blocks")).toBeInTheDocument();
    await expect(within(block).getByTestId("return-list-accept-101")).toBeVisible();
    await expect(within(block).getByTestId("return-list-asked-101")).toHaveTextContent("Asked");
    await waitFor(() => expect(within(block).getByTestId("return-list-order-101")).toHaveTextContent("#101 · Toko Melati · Bu Ani"));
    for (const id of GOING_ELSEWHERE) {
      await waitFor(() => expect(canvas.getByTestId(`return-list-goes-to-${id}`)).toHaveTextContent("Returns to Gudang Cabang"));
      await expect(canvas.queryByTestId(`return-list-accept-${id}`)).toBeNull();
    }
    await expect(canvas.getByTestId("return-list-receive")).toHaveAccessibleName("Receive a Return");
    await fitsTheScreen(canvasElement);

    // Sudah diterima: each block adds when it was accepted, and has no Terima.
    await userEvent.click(canvas.getByTestId("return-list-tab-accepted"));
    const accepted = await rowOf(canvasElement, 111n);
    await waitFor(() => expect(within(accepted).getByTestId("return-list-accepted-111")).toHaveTextContent("Accepted"));
    await noRowOf(canvasElement, 101n);
    await expect(canvas.queryAllByTestId(/^return-list-accept-\d+$/)).toHaveLength(0);
    await fitsTheScreen(canvasElement);
  },
};

/** ON A PHONE, A BLOCK'S TERIMA opens the accept page too — carrying the list's address — and the block itself as well. */
export const MobileTerimaOpensTheAcceptPage: Story = {
  name: "Mobile Terima opens the accept page",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const block = await rowOf(canvasElement, 109n);

    await userEvent.click(within(block).getByTestId("return-list-accept-109"));
    await waitFor(() => expect(canvas.getByTestId("at-return-accept")).toHaveTextContent("/warehouse-orders/109/accept-return"));
    await expect(canvas.getByTestId("at-return-accept-from")).toHaveTextContent(/^\/inventories\/returns$/);
  },
};

/**
 * AT THE APP'S WIDTH — 1366 px beside the open sidebar, on Semua, the widest view (both date columns, a Terima): the
 * table fits its box in English and in Indonesian.
 */
export const BesideTheSidebar: Story = {
  globals: { viewport: { value: "desktop1366" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);
    await userEvent.click(canvas.getByTestId("return-list-tab-all"));
    await rowOf(canvasElement, 103n);

    const fits = async () => {
      const table = canvas.getByTestId("return-list-table");
      const box = table.parentElement!;
      await waitFor(() => expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth));
    };

    await fits();
    // …and in Indonesian, whose headers are the wider. Left in Indonesian: preview.tsx's beforeEach sets the next story's
    // language from its globals.
    await i18n.changeLanguage("id");
    await waitFor(() => expect(canvas.getByTestId("return-list-tab-all")).toHaveTextContent("Semua"));
    await fits();
  },
};
