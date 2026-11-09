import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { liabilityTerms, products } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { formatRupiah } from "../../../lib/money";
import { ORDER_CREATE_META, pickProduct, typeQuantity } from "./kit";

// ORDER CREATE — the warehouse fee, the debt limits and the warning at one, what the invoice charges.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Totals",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── THE WAREHOUSE FEE (the-flat-rate-is-dropped-last, step 3) ──────────────────────────────────────

// THE WAREHOUSE PRICES IT, on the goods' cost (the-fee-is-priced-on-goods-cost) — the very call order create makes
// before freezing the fee, so the figure here is the one the order keeps. Gudang Pusat charges 2.5% with a floor of
// 2.000: one Kopi at an HPP of 18.500 is 462,50 by the percent, so the FLOOR is what it pays.
export const TheWarehouseFeeIsPricedByTheWarehouse: Story = {
  name: "Warehouse fee",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);

    await waitFor(() =>
      expect(canvas.getByTestId("order-create-warehouse-fee")).toHaveTextContent(formatRupiah(2000n)),
    );
  },
};

// ── THE DEBT LIMITS (the-debtor-sees-the-limits-set-on-it) ──────────────────────────────────────────────────────────

// EACH CREDITOR'S OWN LIMIT ON THIS TEAM, and the debt already carried — read by LiabilityCreditByIds, the same
// reading the create's check makes. Toko Melati ships from Gudang Pusat, which set it a 10.000.000 limit and is owed
// 8.700.000: 87%, so the row is marked NEAR beside the name. The panel's ⚠ mark is gone with the samples it flagged.
export const TheDebtLimitsAreEachCreditorsOwn: Story = {
  name: "Debt limits",
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const meter = await canvas.findByTestId("credit-meter-11", {}, { timeout: 4000 });
    await expect(meter).toHaveTextContent(`${formatRupiah(8_700_000n)} of ${formatRupiah(10_000_000n)}`);
    await expect(canvas.getByTestId("credit-meter-11-pct")).toHaveTextContent("87%");
    await expect(canvas.getByTestId("credit-warn-11")).toBeInTheDocument();

    await expect(canvas.queryByTestId("not-implemented-creditLimit")).toBeNull();
    await expect(canvas.queryByTestId("pending-row-creditLimit")).toBeNull();
  },
};

// THE DEBTOR'S WARNING AT THE LIMIT (over-the-limit-refuses-the-create). Gudang Pusat lowers Melati's limit to
// 8.000.000 while Melati already owes it 8.700.000 — the committed debt is past the limit, so the create will be
// refused whatever this order adds, and the row says so in words before customer service presses Create.
export const ACreditorAtItsLimitSaysTheOrderIsRefused: Story = {
  name: "At the limit, refused",
  beforeEach: [
    asTeam(12n),
    () => {
      const terms = liabilityTerms.find((x) => x.teamId === 11n && x.counterpartyId === 12n)!;
      const before = terms.creditLimit;
      terms.creditLimit = 8_000_000;
      return () => {
        terms.creditLimit = before;
      };
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 8.700.000 of 8.000.000 is 108,75% — the meter prints whole percents, rounded.
    await expect(await canvas.findByTestId("credit-meter-11-pct", {}, { timeout: 4000 })).toHaveTextContent("109%");
    await expect(canvas.getByTestId("credit-warn-11")).toBeInTheDocument();
    await expect(canvas.getByTestId("credit-after-11")).toHaveTextContent("this order will be refused");
  },
};

// ── THE INVOICE (the-cross-markup-belongs-to-the-product) ───────────────────────────────────────────────────────────

// EACH LINE IS CHARGED AT ITS PRODUCT'S OWN MARKUP. Toko Melati selling Gudang Pusat's Kopi: an HPP of 18.500 at the
// Kopi's own 10% is 20.350 owed to Gudang Pusat — read off the product, never a figure per team.
export const TheInvoiceChargesTheProductsOwnMarkup: Story = {
  name: "Product's own markup",
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Gudang Pusat's Kopi is on Melati's OTHER tab — it is not Melati's own catalogue.
    await waitFor(() => expect(canvas.getByTestId("order-create-add-line")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("order-create-add-line"));
    await userEvent.click(await screen.findByTestId("product-picker-tab-other"));

    const option = await screen.findByTestId(`product-picker-option-${products[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    const row = await canvas.findByTestId("invoice-row-product-11");
    await waitFor(() => expect(row).toHaveTextContent(formatRupiah(20_350n)));
    await expect(row).toHaveTextContent(`${formatRupiah(18_500n)} at cost · 10.00% markup`);
  },
};

// ── WHAT LEAVES THE SHELF (an-order-is-costed-at-what-leaves-the-shelf) ─────────────────────────────────────────────

// THE INVOICE CHARGES THE DRAW. Toko Melati selling two of Gudang Pusat's Teh owes Gudang Pusat what those two units
// cost when they leave the shelf — 17.500, the January unit and a March one — and nothing the average would make
// of them (18.000). Teh carries no markup, so the row is the goods alone.
export const TheInvoiceChargesWhatTheTakeWouldDraw: Story = {
  name: "Charges the draw",
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Gudang Pusat's Teh is on Melati's OTHER tab.
    await waitFor(() => expect(canvas.getByTestId("order-create-add-line")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("order-create-add-line"));
    await userEvent.click(await screen.findByTestId("product-picker-tab-other"));

    const option = await screen.findByTestId(`product-picker-option-${products[1]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    await typeQuantity(canvasElement, 0, "2");

    const row = await canvas.findByTestId("invoice-row-product-11");
    await waitFor(() => expect(row).toHaveTextContent(formatRupiah(17_500n)));
    await expect(row).not.toHaveTextContent(formatRupiah(18_000n));
  },
};
