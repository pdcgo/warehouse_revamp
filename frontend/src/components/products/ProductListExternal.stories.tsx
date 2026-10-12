import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Button } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { ProductListExternal, description, type ExternalProduct } from "./ProductListExternal";

// What a marketplace scrape actually looks like: keyword-stuffed titles carrying the variant in their
// own words (the size is IN the title, because there is no code to put it in), and whole rupiah.
const scraped: ExternalProduct[] = [
  {
    id: 1,
    name: "Sepatu Running Pria Original Import Sneakers Olahraga Casual - Hitam 42",
    price: 250_000n,
    quantity: 1,
  },
  {
    id: 2,
    name: "Sepatu Running Pria Original Import Sneakers Olahraga Casual - Hitam 43",
    price: 250_000n,
    quantity: 2,
  },
  { id: 3, name: "Kaos Kaki Olahraga isi 3 Pasang", price: 35_000n, quantity: 3 },
];

const meta = {
  title: "Components/Products/ProductListExternal",
  component: ProductListExternal,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { items: scraped },
  decorators: [
    (Story) => (
      <Box w="xl">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof ProductListExternal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FromANamedMarketplace: Story = { args: { source: "Tokopedia" } };

export const WithTotal: Story = { args: { source: "Tokopedia", showTotal: true } };

export const WithAction: Story = {
  args: {
    action: (_item, i) => (
      <Button size="xs" variant="outline">
        Map {i + 1}
      </Button>
    ),
  },
};

// An empty list renders a SENTENCE, never blank space — a blank box reads as a screen that failed to
// load, and "the app sent nothing" is a real answer somebody needs.
export const Empty: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-empty")).toBeVisible();
  },
};

// ⚠ THE RULE THIS PINS: a title the scrape could not read must SAY so. Rendering an empty card with a
// price in it would look like a product whose name simply did not fit — and with no code and no image
// on the card, there is nothing else there to tell the two apart.
export const MissingTitleSaysSo: Story = {
  args: { items: [{ id: 9, price: 12_000n, quantity: 1 }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-name-9")).toHaveTextContent(/read no name/i);
  },
};

// A title of only whitespace is the same case — scraped values arrive padded, and " " would otherwise
// render as a nameless row that claims to have a name.
export const WhitespaceTitleCountsAsMissing: Story = {
  args: { items: [{ id: 9, name: "   ", price: 12_000n, quantity: 1 }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-name-9")).toHaveTextContent(/read no name/i);
  },
};

// The title is rendered VERBATIM — the app's own casing and punctuation, unchanged. It is pasted back
// into the marketplace's search box to check a doubtful mapping, and a title we have "improved" is one
// that comes back not found.
export const TitleIsVerbatim: Story = {
  args: { items: [{ id: 9, name: "sepatu RUNNING pria - ORIGINAL", price: 12_000n, quantity: 1 }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-name-9")).toHaveTextContent(
      "sepatu RUNNING pria - ORIGINAL",
    );
  },
};

// ⚠ QUANTITY 0 IS "NOT READ", NOT A NUMBER. `OrderDraftItem.quantity` is unconstrained precisely
// because a scrape may fail to read it, and "× 0" printed on the row is a lie with a multiplication
// sign in front of it.
export const UnreadableQuantityIsNotPrintedAsZero: Story = {
  args: { items: [{ id: 9, name: "Kaos Kaki Olahraga", price: 35_000n, quantity: 0 }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-qty-unknown-9")).toBeVisible();
    await expect(canvas.queryByTestId("product-list-external-qty-9")).toBeNull();
    // …and no line total either: 0 × 35.000 is a confident Rp 0 for a line whose quantity nobody knows.
    await expect(canvas.queryByTestId("product-list-external-line-total-9")).toBeNull();
  },
};

// ⚠ THE OPPOSITE RULE, ON PURPOSE: zero rupiah is a PRICE, so it is stated rather than hidden or
// relabelled "not read". The wire cannot tell "free" from "unread", so the row states the number the
// app sent and colours it for a second look — it never guesses which one it was.
export const ZeroPriceIsStatedNotHidden: Story = {
  args: { items: [{ id: 9, name: "Bonus Gantungan Kunci", price: 0n, quantity: 1 }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-price-9")).toHaveTextContent("Rp 0");
    await expect(canvas.queryByTestId("product-list-external-price-unknown-9")).toBeNull();
  },
};

// An ABSENT price is the case that reads as unknown — and it is a different prop value (undefined)
// from the zero above, which is the only reason the two can be told apart at all.
export const AbsentPriceReadsAsUnknown: Story = {
  args: { items: [{ id: 9, name: "Sepatu Running Pria", quantity: 2 }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-price-unknown-9")).toBeVisible();
  },
};

// At × 1 the line total IS the unit price, and printing it twice reads as two separate facts about
// the row. It appears only when the quantity is more than one.
export const LineTotalOnlyAboveOne: Story = {
  args: {
    items: [
      { id: 1, name: "One of these", price: 250_000n, quantity: 1 },
      { id: 2, name: "Two of these", price: 250_000n, quantity: 2 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("product-list-external-line-total-1")).toBeNull();
    await expect(canvas.getByTestId("product-list-external-line-total-2")).toHaveTextContent("Rp 500.000");
  },
};

export const TotalSumsTheLines: Story = {
  args: { showTotal: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 250.000 + (2 × 250.000) + (3 × 35.000)
    await expect(canvas.getByTestId("product-list-external-total")).toHaveTextContent("Rp 855.000");
    await expect(canvas.queryByTestId("product-list-external-total-partial")).toBeNull();
  },
};

// ⚠ A SHORT TOTAL SAYS IT IS SHORT. A line missing its quantity or its price cannot be summed, and a
// plain number that quietly leaves it out is the worst of the three options: somebody reconciling
// against the marketplace sees a mismatch and has no way to tell which side is wrong.
export const PartialTotalIsMarked: Story = {
  args: {
    showTotal: true,
    items: [
      { id: 1, name: "Readable", price: 100_000n, quantity: 2 },
      { id: 2, name: "No quantity", price: 50_000n, quantity: 0 },
      { id: 3, name: "No price", quantity: 4 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-total")).toHaveTextContent("Rp 200.000");
    await expect(canvas.getByTestId("product-list-external-total-partial")).toBeVisible();
  },
};

// ⚠ ONE CARD AROUND THE WHOLE LIST, with a heading — the card is the BOUNDARY between somebody
// else's data and ours, not a separator between line 1 and line 2. Every product is a row inside it.
export const OneCardWithAHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-title")).toHaveTextContent(
      /products from the app/i,
    );

    for (const id of [1, 2, 3]) {
      await expect(canvas.getByTestId(`product-list-external-row-${id}`)).toBeVisible();
    }
  },
};

// The heading is overridable — a screen that already has a better name for the origin uses it, and
// the default is only the fallback.
export const CustomTitle: Story = {
  args: { title: "Tokopedia — Pesanan MEL-9001", source: "Tokopedia" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-title")).toHaveTextContent("MEL-9001");
  },
};

// WHO SENT IT is named ONCE, under the heading — every line in this card arrived from the same
// extension, so a badge per row would be the same words repeated down the page.
export const SourceIsNamedOnce: Story = {
  args: { source: "Tokopedia" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText(/Tokopedia/)).toHaveLength(1);
    await expect(canvas.getByTestId("product-list-external-caption")).toHaveTextContent(
      "Send By External Extension — Tokopedia",
    );
  },
};

// With no `source`, the extension is still named — the caption is what says these lines were pushed
// in from outside, and a card that dropped it when the source was unknown would be a card that stops
// warning exactly when it knows least.
export const CaptionWithoutASource: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-caption")).toHaveTextContent(
      "Send By External Extension",
    );
  },
};

// The title and the warning survive an EMPTY list. A card that lost its heading when the app sent
// nothing would read as a component that failed to render, rather than as an answer.
export const EmptyKeepsItsHeading: Story = {
  args: { items: [], source: "Tokopedia" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("product-list-external-title")).toBeVisible();
    await expect(canvas.getByTestId("product-list-external-caption")).toBeVisible();
    await expect(canvas.getByTestId("product-list-external-empty")).toBeVisible();
  },
};
