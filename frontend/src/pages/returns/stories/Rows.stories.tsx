import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import {
  ACCEPTED_HERE,
  GOING_ELSEWHERE,
  RETURNS_META,
  WAITING_HERE,
  WAREHOUSE,
  noRowOf,
  rowOf,
  withReturns,
} from "./kit";

// INVENTARIS › RETUR — what a ROW opens, and who may act on it (the-retur-list-prototype-is-accepted):
//
//   waiting   → the accept page, carrying the list's address back; Terima only on a return addressed HERE
//               (only-the-return-warehouse-accepts-a-return), a return going elsewhere reads Kembali ke …
//   accepted  → the order's page
//   a monitor → the order's page, always — no Terima, no Receive a Return (the-admin-team-monitors-read-only)
//   the header's Receive a Return → the warehouse list's dialog (features/orders/ReceiveReturnDialog)

const meta = {
  title: "Pages/Warehouse/ReturnsPage/Rows",
  ...RETURNS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A WAITING RETURN OPENS THE ACCEPT PAGE (the-retur-menu-is-the-warehouses-return-list), the list's address riding along
 * so the page's Back — and its Accept — come back to the same narrowed list.
 */
export const AWaitingRowOpensTheAcceptPage: Story = {
  name: "A waiting row opens the accept page",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await rowOf(canvasElement, 102n));

    await waitFor(() => expect(canvas.getByTestId("at-return-accept")).toHaveTextContent("/warehouse-orders/102/accept-return"));
    await expect(canvas.getByTestId("at-return-accept-from")).toHaveTextContent(/^\/inventories\/returns$/);
  },
};

/**
 * TERIMA ONLY WHERE IT CAN BE (only-the-return-warehouse-accepts-a-return): on the returns addressed to Gudang Pusat —
 * 109 too, which Gudang Cabang shipped — and it opens the accept page; Kenanga's 110, returning to Gudang Cabang, says so
 * and has none.
 */
export const OnlyAReturnAddressedHereHasTerima: Story = {
  name: "Only a return addressed here has Terima",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 109n);

    for (const id of WAITING_HERE.filter((id) => !GOING_ELSEWHERE.includes(id))) {
      await waitFor(() => expect(canvas.getByTestId(`return-list-accept-${id}`)).toBeVisible());
      await expect(canvas.queryByTestId(`return-list-goes-to-${id}`)).toBeNull();
    }
    for (const id of GOING_ELSEWHERE) {
      await expect(canvas.queryByTestId(`return-list-accept-${id}`)).toBeNull();
      await waitFor(() => expect(canvas.getByTestId(`return-list-goes-to-${id}`)).toHaveTextContent("Returns to Gudang Cabang"));
    }

    await userEvent.click(canvas.getByTestId("return-list-accept-109"));
    await waitFor(() => expect(canvas.getByTestId("at-return-accept")).toHaveTextContent("/warehouse-orders/109/accept-return"));
    await expect(canvas.getByTestId("at-return-accept-from")).toHaveTextContent(/^\/inventories\/returns$/);
  },
};

/** A SELLER WITH NO RETURN WAREHOUSE — its return says so, and has no Terima. */
export const NoReturnWarehouseSaysSo: Story = {
  name: "No return warehouse says so",
  beforeEach: withReturns({ kenangaTo: 0n }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 110n);

    await waitFor(() => expect(canvas.getByTestId("return-list-goes-to-110")).toHaveTextContent("No return warehouse set"));
    await expect(canvas.queryByTestId("return-list-accept-110")).toBeNull();
    await expect(canvas.getByTestId("return-list-accept-101")).toBeVisible();
  },
};

/** SUDAH DITERIMA: each with when it was accepted, no Terima; a row opens the order's page, where the accept's note is. */
export const AnAcceptedRowOpensTheOrder: Story = {
  name: "An accepted row opens the order",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);
    await userEvent.click(canvas.getByTestId("return-list-tab-accepted"));
    // The tab's own URL write (a gathered `replace`) can land after the rows — wait for it, as a person's click would.
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("state=accepted"));

    for (const id of ACCEPTED_HERE) await rowOf(canvasElement, id);
    await noRowOf(canvasElement, 101n);
    await expect(canvas.getByRole("columnheader", { name: "Accepted" })).toBeInTheDocument();
    await expect(canvas.getByTestId("return-list-accepted-103")).toBeInTheDocument();
    await expect(canvas.getByTestId("return-list-state-103")).toHaveTextContent("Accepted");
    await expect(canvas.queryAllByTestId(/^return-list-accept-\d+$/)).toHaveLength(0);

    await userEvent.click(canvas.getByTestId("return-list-row-103"));
    await waitFor(() => expect(canvas.getByTestId("at-order")).toHaveTextContent(/^\/warehouse-orders\/103$/));
    await expect(canvas.getByTestId("at-order-from")).toHaveTextContent("state=accepted");
  },
};

/** SEMUA holds both — a waiting row still opens the accept page there, an accepted one the order. */
export const SemuaOpensEachByItsState: Story = {
  name: "Semua opens each by its state",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);
    await userEvent.click(canvas.getByTestId("return-list-tab-all"));
    await rowOf(canvasElement, 104n);

    // The waiting row reads "—" under Diterima; the accepted one its date.
    await expect(canvas.getByTestId("return-list-accepted-104")).toBeInTheDocument();
    await expect(canvas.queryByTestId("return-list-accepted-105")).toBeNull();

    await userEvent.click(canvas.getByTestId("return-list-row-104"));
    await waitFor(() => expect(canvas.getByTestId("at-order")).toHaveTextContent(/^\/warehouse-orders\/104$/));
  },
};

/**
 * A MONITOR READS (the-admin-team-monitors-read-only): no Receive a Return, no Terima — and every row, a waiting one too,
 * opens the order's page: the accept page is a write, turned away at its door.
 */
export const AMonitorReadsOnly: Story = {
  name: "A monitor reads only",
  beforeEach: () => {
    asAdminTeam()();
    asTeam(WAREHOUSE)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);

    await expect(canvas.queryByTestId("return-list-receive")).toBeNull();
    await expect(canvas.queryAllByTestId(/^return-list-accept-\d+$/)).toHaveLength(0);

    await userEvent.click(canvas.getByTestId("return-list-row-101"));
    await waitFor(() => expect(canvas.getByTestId("at-order")).toHaveTextContent(/^\/warehouse-orders\/101$/));
    await expect(canvas.queryByTestId("at-return-accept")).toBeNull();
  },
};

/** RECEIVE A RETURN, from this list's header — the warehouse list's dialog (search, force if needed, accept). */
export const ReceiveAReturnOpensTheDialog: Story = {
  name: "Receive a Return opens the dialog",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);

    await userEvent.click(canvas.getByTestId("return-list-receive"));
    const input = await screen.findByTestId("receive-return-input");
    await waitFor(() => expect(input).toBeVisible());
  },
};

/** The other warehouse's own view: Gudang Cabang lists Kenanga's returns coming to it, with Terima. */
export const TheReturnWarehouseHasTerima: Story = {
  name: "The return warehouse has Terima",
  beforeEach: () => {
    asTeam(14n)();
    withReturns({ waiting: [110n], accepted: [] })();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 110n);

    await expect(canvas.getByTestId("return-list-accept-110")).toBeVisible();
    await expect(canvas.queryByTestId("return-list-goes-to-110")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("return-list-seller-110")).toHaveTextContent("Toko Kenanga"));
  },
};
