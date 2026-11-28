import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { productCodeScenario, scanCodesForStory } from "../../../../.storybook/productCodeScenario";
import { withOrderStatus } from "../../../../.storybook/sessionScenario";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { PickOrderPage } from "../index";

// THE PICK PAGE — A PRODUCT'S FORMER CODES STILL FIND IT (backlog #152, #141 P4 —
// a-team-code-change-recomposes-its-product-codes, its 🔄 *an old sticker scanned before the reprint*, owner Q1 "A", and
// its 🔄 *past lines keep their code*). When a team's code changes, its products take the new code; an order line keeps
// the code it was written with, and the shelves wear the old stickers until each warehouse reprints. So the item scan
// matches the line's code, the product's code now and every code it carried before — read ONCE for the page
// (ProductCodesByIds, beside the shelves), never per scan. The stub is .storybook/productCodeStub.ts; a story names a
// line product's codes with `scanCodesForStory(product, codeNow, ...formerCodes)`.
//
// Order 101 at Gudang Pusat (11), being picked (processed): Kaos Polos Hitam — M ×2 (KPH-M, product 301), Kaos Polos
// Putih — L (KPP-L, 302), Topi Rajut (TOP-01, 303).

const WAREHOUSE = 11n;
const ORDER = 101n;

const Routed = (path: string) =>
  routedPage(
    [{ path: "/warehouse-orders/:orderId", element: <PickOrderPage /> }, marker("/warehouse-orders", "at-pick-queue")],
    path,
  );

const At101 = Routed(`/warehouse-orders/${ORDER}`);

const meta = {
  title: "Pages/Order/PickOrderPage/FormerCodes",
  component: PickOrderPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen" },
  beforeEach: () => {
    asTeam(WAREHOUSE)();
    withOrderStatus(ORDER, OrderStatus.PROCESSED)();
  },
  render: () => <At101 />,
} satisfies Meta<typeof PickOrderPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The scan card drawn, its field focused. */
async function scanning(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("pick-scan", {}, { timeout: 4000 });
  const input = canvas.getByTestId("pick-scan-input");
  await waitFor(() => expect(input).toHaveFocus(), { timeout: 5000 });
  return { canvas, input };
}

async function scan(input: HTMLElement, code: string) {
  await userEvent.type(input, `${code}{Enter}`, { delay: 10 });
}

/**
 * AN ORDER PLACED BEFORE THE CHANGE, THE NEW STICKER: the line still says KPH-M (it keeps the code it was written with),
 * the unit wears XYZ-KPH-M — it counts, in any case. The codes were asked once for the page's three products, and no
 * scan asked again.
 */
export const OldOrderNewSticker: Story = {
  name: "Old order, new sticker",
  beforeEach: scanCodesForStory(301n, "XYZ-KPH-M", "KPH-M"),
  play: async ({ canvasElement }) => {
    const { canvas, input } = await scanning(canvasElement);
    const first = canvas.getByTestId("pick-scan-line-1");

    await scan(input, "XYZ-KPH-M");
    await scan(input, "xyz-kph-m");
    await waitFor(() => expect(first).toHaveAttribute("data-exact", "true"));
    await expect(first).toHaveTextContent("2 / 2");
    await expect(canvas.queryByTestId("pick-scan-problem")).toBeNull();
    // The line still reads the code it was written with (past lines keep their code).
    await expect(first).toHaveAttribute("data-code", "KPH-M");
    await expect(first).not.toHaveTextContent("XYZ");

    await scan(input, "KPP-L");
    await scan(input, "TOP-01");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-complete")).toBeInTheDocument());
    await expect(canvas.getByTestId("pick-order-set-picked")).toBeEnabled();

    await expect(productCodeScenario.calls).toEqual([{ teamId: WAREHOUSE, productIds: [301n, 302n, 303n] }]);
  },
};

/** AN ORDER PLACED AFTER THE CHANGE, THE OLD STICKER: the line says KPH-M (the code now), the unit still wears ABC-KPH-M. */
export const NewOrderOldSticker: Story = {
  name: "New order, old sticker",
  beforeEach: scanCodesForStory(301n, "KPH-M", "ABC-KPH-M"),
  play: async ({ canvasElement }) => {
    const { canvas, input } = await scanning(canvasElement);
    const first = canvas.getByTestId("pick-scan-line-1");

    await scan(input, "ABC-KPH-M");
    await scan(input, "  abc-kph-m  ");
    await waitFor(() => expect(first).toHaveAttribute("data-exact", "true"));
    await expect(first).toHaveTextContent("2 / 2");
    await expect(canvas.queryByTestId("pick-scan-problem")).toBeNull();
  },
};

/**
 * ANOTHER PRODUCT'S CODE IS REFUSED — a code another product carried before (Minyak's TA-ANG-001) and a piece of a line
 * product's code are not on this order; a line product's own former code counts for ITS line, not another's.
 */
export const AnotherProductsCodeIsRefused: Story = {
  name: "Another product's code is refused",
  beforeEach: () => {
    scanCodesForStory(301n, "XYZ-KPH-M", "KPH-M")();
    scanCodesForStory(302n, "XYZ-KPP-L", "KPP-L")();
  },
  play: async ({ canvasElement }) => {
    const { canvas, input } = await scanning(canvasElement);

    await scan(input, "TA-ANG-001");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-problem")).toHaveTextContent("Not on this order: TA-ANG-001"));
    await scan(input, "XYZ-KPH");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-problem")).toHaveTextContent("Not on this order: XYZ-KPH"));
    await expect(canvas.getByTestId("pick-scan-line-1")).toHaveTextContent("0 / 2");

    await scan(input, "xyz-kpp-l");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-line-2")).toHaveAttribute("data-exact", "true"));
    await expect(canvas.getByTestId("pick-scan-line-1")).toHaveTextContent("0 / 2");
    await expect(canvas.queryByTestId("pick-scan-problem")).toBeNull();
  },
};

/**
 * A CODE TWO LINES' PRODUCTS ANSWER — KPH-M is line 1's code and a code Kaos Putih (302) once carried: it fills the first
 * line still short, then the next (the rule for one product on two lines), and one more is too many.
 */
export const ACodeTwoLinesAnswer: Story = {
  name: "A code two lines answer",
  beforeEach: scanCodesForStory(302n, "KPP-L", "KPH-M"),
  play: async ({ canvasElement }) => {
    const { canvas, input } = await scanning(canvasElement);

    await scan(input, "KPH-M");
    await scan(input, "KPH-M");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-line-1")).toHaveAttribute("data-exact", "true"));
    await expect(canvas.getByTestId("pick-scan-line-2")).toHaveTextContent("0 / 1");

    await scan(input, "KPH-M");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-line-2")).toHaveAttribute("data-exact", "true"));

    await scan(input, "KPH-M");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-problem")).toHaveTextContent("more than ordered"));
  },
};

/** ONLY THE ORDER BEING PICKED ASKS THE CODES — a pending one draws its pick list and asks none. */
export const APendingOrderAsksNoCodes: Story = {
  name: "A pending order asks no codes",
  beforeEach: withOrderStatus(ORDER, OrderStatus.PENDING),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-order-advance")).toHaveTextContent("Confirm Order"), { timeout: 5000 });
    await expect(canvas.queryByTestId("pick-scan")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(productCodeScenario.calls).toEqual([]);
  },
};
