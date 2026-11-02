import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ProductLinesDialog, description, type ProductLine } from "./ProductLinesDialog";

const lines: ProductLine[] = [
  { id: "1", sku: "SKU-KOPI-250", name: "Kopi Arabika 250g", quantity: 3n, totalPrice: 10_000 },
  { id: "2", sku: "SKU-TEH-100", name: "Teh Melati 100g", quantity: 10n, totalPrice: 55_000 },
  { id: "3", sku: "SKU-GULA-1K", name: "Gula Pasir 1kg", quantity: 2n, totalPrice: 24_000 },
];

const meta = {
  title: "Components/Products/ProductLinesDialog",
  component: ProductLinesDialog,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    lines,
    label: `${lines[0]!.sku} +${lines.length - 1} more`,
  },
} satisfies Meta<typeof ProductLinesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// The warehouse's inbound queue is a COUNTING job, not an invoice — so the same document renders
// without any money for an audience with no business seeing what the goods cost.
export const Unpriced: Story = {
  args: { showPrices: false },
};

export const LongProductNames: Story = {
  args: {
    lines: lines.map((l) => ({ ...l, name: `${l.name} — kemasan besar isi dua belas botol` })),
  },
};

// It lists EVERY line, including the product the table row already names. A list that started at
// the second product would read as if the first had been left out.
export const ListsEveryLineIncludingTheNamedOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-lines-more"));

    // Portalled — a table cell clips its overflow, so the popover renders on document.body.
    const table = await screen.findByTestId("product-lines");
    for (const line of lines) {
      await expect(within(table).getByText(line.sku)).toBeInTheDocument();
    }
  },
};

// The unit price is DERIVED from the line total and openly a rounding: 10.000 over 3 pieces shows
// 3.333 while the line still totals 10.000. People buy in totals (#140), so the total is the truth
// and the per-piece figure is the convenience — the two can look a rupiah apart, honestly.
export const UnitPriceIsARoundingOfTheLineTotal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-lines-more"));

    const table = await screen.findByTestId("product-lines");
    const row = within(table).getByText("SKU-KOPI-250").closest("tr")!;

    await expect(within(row).getByText(/3[.,]333/)).toBeInTheDocument();
    await expect(within(row).getByText(/10[.,]000/)).toBeInTheDocument();
  },
};

// The footer totals the GOODS and only the goods — freight is charged on the document, not on a
// line, so adding it here would produce a sum matching nothing on the invoice.
export const TotalsOnlyTheGoods: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-lines-more"));

    // 10.000 + 55.000 + 24.000
    await expect(await screen.findByTestId("product-lines-total")).toHaveTextContent(/89[.,]000/);
  },
};

// A table row is usually clickable, so the trigger stops the click: opening the summary must not
// also navigate away from the list it is summarising.
export const TriggerDoesNotBubbleToTheRow: Story = {
  render: (args) => (
    <div
      data-testid="row"
      onClick={() => {
        document.body.setAttribute("data-row-clicked", "yes");
      }}
    >
      <ProductLinesDialog {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    document.body.removeAttribute("data-row-clicked");

    await userEvent.click(canvas.getByTestId("product-lines-more"));

    await expect(await screen.findByTestId("product-lines")).toBeInTheDocument();
    await expect(document.body.getAttribute("data-row-clicked")).toBeNull();
  },
};

// IT OPENS AS A DIALOG (the-product-lines-open-in-a-dialog) — the list in the middle of the screen, titled, closed by its
// ×; it was a popover hanging off the row.
export const ItOpensAsADialog: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("product-lines-more"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(dialog).toHaveTextContent("Products");
    await expect(within(dialog).getByTestId("product-lines")).toBeVisible();
  },
};

// ON A PHONE EACH LINE IS A BLOCK (a-phone-reads-each-line-as-a-block) — the name at full width, the SKU and the
// arithmetic under it; no columns. The dialog fits the screen (nothing-runs-past-a-phones-edge).
export const OnAPhoneEachLineIsABlock: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("product-lines-more"));
    const list = await screen.findByTestId("product-lines");
    const content = list.closest('[data-part="content"]')!;

    await expect(within(list).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(list).toHaveTextContent(/SKU-KOPI-250 · 3 × Rp/);
    await expect(content.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(content.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  },
};
