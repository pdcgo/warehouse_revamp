import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { BERAS, EditOngoing, FORM_META, KECAP, ONGOING, TEPUNG, loaded, pickProducts } from "./kit";

// RESTOCK FORM — the Produk card's lines — the picker, a product once, the piece price, a line as a row.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Products",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const KOPI = 71n;

// SEVERAL PRODUCTS IN ONE PICK (owner: *"di halaman ini aku tidak bisa multi produk … maksudku di storynya"*) — team 12's
// catalogue holds three now, and the picker takes them together: one line each, in the order ticked.
export const SeveralProductsInOnePick: Story = {
  name: "Several in one pick",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await pickProducts(canvas, [BERAS, TEPUNG, KECAP]);

    await waitFor(() => expect(canvas.getByTestId("restock-summary-count")).toHaveTextContent("3"));
    await expect(canvas.getByTestId("restock-line-0")).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(canvas.getByTestId("restock-line-1")).toHaveTextContent("Tepung Terigu 1kg");
    await expect(canvas.getByTestId("restock-line-2")).toHaveTextContent("Kecap Manis 600ml");
  },
};

// a-product-appears-once-per-restock: a product is ticked, not added — picking it again cannot make a second line.
export const AProductIsListedOnce: Story = {
  name: "Listed once",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await pickProducts(canvas, [BERAS]);
    await canvas.findByTestId("restock-line-0");

    // Opened again, the product on the list is already ticked …
    await userEvent.click(canvas.getByTestId("restock-pick-products"));
    const row = await screen.findByTestId(`product-picker-option-${BERAS}`, {}, { timeout: 4000 });
    await waitFor(() => expect(within(row).getByRole("checkbox")).toBeChecked());
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));
    await waitFor(() => expect(screen.queryByTestId("product-picker-dialog")).toBeNull());

    // … so confirming keeps ONE line.
    await expect(canvas.getByTestId("restock-line-0")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-line-1")).toBeNull();
    await expect(canvas.getByTestId("restock-summary-count")).toHaveTextContent("1");
  },
};

// a-line-is-typed-as-its-total: the piece price is derived from the total, never typed.
export const ThePiecePriceIsDerived: Story = {
  name: "Piece price derived",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    // Kopi: 24 for Rp 960.000 → Rp 40.000 a piece.
    await waitFor(() => expect(canvas.getByTestId("restock-per-piece-1")).toHaveTextContent("Rp 40.000"));
  },
};

// Kopi is not team 12's product — a stored line keeps it (the sku and name are a snapshot), shown as ordered.
export const AStoredLineKeepsItsSnapshot: Story = {
  name: "A stored line's snapshot",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const kopi = ONGOING.items.find((l) => l.productId === KOPI)!;

    await expect(canvas.getByTestId("restock-line-1")).toHaveTextContent(kopi.name);
    await expect(canvas.getByTestId("restock-qty-1")).toHaveValue(String(kopi.count));
  },
};

// NO LINES IS A HINT WITH THE PICKER IN IT (an-empty-list-shows-a-hint) — one way to add while the card is empty; once a
// product is picked the hint goes and the picker moves to the card's title.
export const NoLinesIsAHintWithThePicker: Story = {
  name: "Empty hint",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const hint = canvas.getByTestId("restock-no-products");

    await expect(within(hint).getByTestId("restock-pick-products")).toBeVisible();
    // The full-size hint (owner: *"card belum ada produk pilih produk sedikit lebih tinggi heightnya"*,
    // an-empty-produk-is-the-full-size-hint) — it was the small one, 186px.
    await expect(hint.getBoundingClientRect().height).toBeGreaterThan(240);
    await expect(canvas.getAllByTestId("restock-pick-products")).toHaveLength(1);

    await pickProducts(canvas, [BERAS]);
    await waitFor(() => expect(canvas.queryByTestId("restock-no-products")).toBeNull());
    await expect(canvas.getByTestId("restock-pick-products")).toBeVisible();
  },
};

// THE LINES ARE ROWS OF THE PRODUK CARD (never a card inside a card) — no border of their own, a rule between them.
export const TheLinesAreRowsNotCards: Story = {
  name: "Rows, not cards",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const line = await canvas.findByTestId("restock-line-0");

    await expect(getComputedStyle(line).borderTopWidth).toBe("0px");
    await expect(line.parentElement!.querySelector(".chakra-separator, [role='separator'], hr")).not.toBeNull();

    // A line's note is a textarea, two rows to start (owner: *"catatan produk jadi textarea tingginya default 2"*,
    // a-line-note-is-two-rows).
    const note = canvas.getByTestId("restock-line-0-note");
    await expect(note.tagName).toBe("TEXTAREA");
    await expect(note).toHaveAttribute("rows", "2");
  },
};

// THE PICKER'S PAGER IS ONE NUMBER (owner: *"paginasi di modal simpel saja"*, then *"aku ga mau yang num of num, nomor
// saja, ui mirip yang sudah pernah dibuat"*, a-dialog-pager-is-one-number) — ‹ [1] › in the app's pager boxes, the page
// in the main tone; never "1 of 1"; always on screen, the next arrow off on the last page.
export const ThePickerPagerIsOneNumber: Story = {
  name: "Picker pager",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await userEvent.click(canvas.getByTestId("restock-pick-products"));
    const dialog = within(await screen.findByTestId("product-picker-dialog", {}, { timeout: 4000 }));
    await waitFor(() => expect(dialog.getAllByTestId(/^product-picker-option-/)).toHaveLength(3));

    const pager = dialog.getByTestId("product-picker-pager");
    await expect(pager).toBeVisible();
    await expect(pager).toHaveTextContent(/^1$/);
    await expect(dialog.getByTestId("product-picker-pager-page-1")).toHaveAttribute("aria-current", "page");
    await expect(dialog.getByTestId("product-picker-pager-next")).toBeDisabled();
  },
};
