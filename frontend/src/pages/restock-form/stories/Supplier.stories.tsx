import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { resetRestockStub } from "../../../../.storybook/restockStub";
import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { BERAS, CAHAYA, CAHAYA_STORE, EditOngoing, FORM_META, KECAP, ONGOING, TEPUNG, connectSupplier, loaded, ongoingFromOneSupplier, pickProducts } from "./kit";

// RESTOCK FORM — the supplier part of the Produk card — one for all in two steps (one-supplier-for-all-in-two-steps),
// or a line's own; and what an edit opens with.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Supplier",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SUMBER = supplierFixture("PT Sumber Makmur");
const SUMBER_SHOPEE = 311n;
const SINAR = supplierFixture("Toko Grosir Sinar"); // no store at all — a stall

const ALL_OPEN = "restock-all-supplier-picker";

// a-line-connects-to-any-teams-supplier-from-a-popup: Connect Supplier Channel → a supplier and one of its stores →
// the line shows both. And a supplier can be cleared off a line again.
export const ConnectingASupplierShowsItOnTheLine: Story = {
  name: "Connect a line",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    // Line 2 (Teh) is connected to nothing yet.
    await waitFor(() =>
      expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent("Not chosen yet"),
    );

    await userEvent.click(canvas.getByTestId("restock-line-2-picker-trigger"));
    const dialog = within(await screen.findByTestId("restock-line-2-picker-dialog"));
    await userEvent.type(dialog.getByTestId("restock-line-2-picker-search"), "Cahaya", { delay: 20 });
    await userEvent.click(await dialog.findByTestId(`restock-line-2-picker-supplier-${CAHAYA.id}`, {}, { timeout: 4000 }));
    await userEvent.click(await dialog.findByTestId(`restock-line-2-picker-store-${CAHAYA_STORE}`, {}, { timeout: 4000 }));
    await userEvent.click(dialog.getByTestId("restock-line-2-picker-confirm"));

    const shown = canvas.getByTestId("restock-line-2-supplier-shown");
    await waitFor(() => expect(shown).toHaveTextContent(CAHAYA.name), { timeout: 4000 });
    await waitFor(() => expect(shown).toHaveTextContent("cahayaabadi.co.id"), { timeout: 4000 });

    // a-line-may-name-a-supplier-without-a-channel — line 1 is a stall.
    await expect(canvas.getByTestId("restock-line-1-supplier-shown")).toHaveTextContent("No store — bought offline");

    // Cleared, line 0 is connected to nothing again.
    await userEvent.click(canvas.getByTestId("restock-line-0-supplier-clear"));
    await expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent("Not chosen yet");
  },
};

// THE SUPPLIER LEADS THE CARD, FROM THE START (owner: *"supplier jadikan semacam div sendiri, 1 section pilih produk dan
// supplier, supplier di atas dan muncul dari awal"*, the-supplier-leads-the-produk-card) — and THEN the products, under a
// rule, with Pilih Produk in their own title (the-card-is-supplier-then-produk). The supplier's line — optional, for all or
// per product — stays when one is picked. Two steps: Pilih Supplier → a pick; products picked after follow it, and so do
// lines already there.
export const OneSupplierForAllInTwoSteps: Story = {
  name: "One for all",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const block = canvas.getByTestId("restock-all-supplier");

    // On screen with nothing picked, ABOVE the rule, and the rule above the products and their Pilih Produk.
    const after = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const rule = canvas.getByTestId("restock-supplier-products-rule");
    await expect(block).toBeVisible();
    await expect(canvas.getByTestId("restock-all-supplier-none")).toBeVisible();
    await expect(canvas.getByTestId("restock-all-supplier-help")).toHaveTextContent(/^Every product needs a supplier/);
    await expect(after(block, rule)).toBe(true);
    await expect(after(rule, canvas.getByTestId("restock-no-products"))).toBe(true);
    await expect(after(rule, canvas.getByTestId("restock-pick-products"))).toBe(true);

    // A product already there follows the pick …
    await pickProducts(canvas, [BERAS]);
    await canvas.findByTestId("restock-line-0");

    // Step one, step two.
    const field = canvas.getByTestId("restock-all-supplier-field");
    const emptyHeight = field.getBoundingClientRect().height;
    await userEvent.click(canvas.getByTestId(`${ALL_OPEN}-trigger`));
    await connectSupplier(ALL_OPEN, "Cahaya", CAHAYA.id, CAHAYA_STORE);

    await waitFor(() => expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent(CAHAYA.name), {
      timeout: 4000,
    });
    await expect(canvas.queryByTestId(`${ALL_OPEN}-trigger`)).toBeNull();
    // ONE HEIGHT, PICKED OR NOT (owner: *"buat tingginya sama ketika select dan tidak suppliernya"*) — and the picked
    // supplier's two lines fit inside it.
    await expect(field.getBoundingClientRect().height).toBe(emptyHeight);
    const shown = canvas.getByTestId("restock-all-supplier-shown").getBoundingClientRect();
    const box = field.getBoundingClientRect();
    await expect(shown.top).toBeGreaterThanOrEqual(box.top);
    await expect(shown.bottom).toBeLessThanOrEqual(box.bottom);
    // The line that says what the choice does is still there.
    await expect(canvas.getByTestId("restock-all-supplier-help")).toBeVisible();
    await expect(after(rule, canvas.getByTestId("restock-pick-products"))).toBe(true);
    await expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent(CAHAYA.name);
    await expect(canvas.getByTestId("restock-line-0-supplier-follows")).toHaveTextContent("Same as all");

    // … and so does every product picked after.
    await pickProducts(canvas, [TEPUNG, KECAP]);
    for (const i of [1, 2]) {
      await waitFor(() => expect(canvas.getByTestId(`restock-line-${i}-supplier-shown`)).toHaveTextContent(CAHAYA.name));
      await expect(canvas.getByTestId(`restock-line-${i}-supplier-follows`)).toBeInTheDocument();
    }
  },
};

// A LINE CAN STILL PICK ITS OWN — and keeps it when the supplier for all changes; Ikut Semua takes it back, and clearing
// the supplier for all leaves the lines that followed it connected to nothing.
export const ALineKeepsItsOwnSupplierUnderTheOneForAll: Story = {
  name: "A line keeps its own",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await pickProducts(canvas, [BERAS, TEPUNG, KECAP]);
    await canvas.findByTestId("restock-line-2");
    await userEvent.click(canvas.getByTestId(`${ALL_OPEN}-trigger`));
    await connectSupplier(ALL_OPEN, "Cahaya", CAHAYA.id, CAHAYA_STORE);
    await waitFor(() => expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(CAHAYA.name));

    // Kecap was bought at a stall.
    await userEvent.click(canvas.getByTestId("restock-line-2-picker-trigger"));
    await connectSupplier("restock-line-2-picker", "Sinar", SINAR.id);
    await waitFor(() => expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(SINAR.name));
    await expect(canvas.queryByTestId("restock-line-2-supplier-follows")).toBeNull();

    // The supplier for all changes: the lines that follow it move, Kecap stays at the stall.
    await userEvent.click(canvas.getByTestId("restock-all-supplier-change-trigger"));
    await connectSupplier("restock-all-supplier-change", "Sumber", SUMBER.id, SUMBER_SHOPEE);
    await waitFor(() => expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent(SUMBER.name));
    await expect(canvas.getByTestId("restock-line-1-supplier-shown")).toHaveTextContent(SUMBER.name);
    await expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(SINAR.name);

    // Ikut Semua takes it back.
    await userEvent.click(canvas.getByTestId("restock-line-2-supplier-follow"));
    await waitFor(() => expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(SUMBER.name));
    await expect(canvas.getByTestId("restock-line-2-supplier-follows")).toBeInTheDocument();

    // Cleared, the lines that followed it are connected to nothing, and Pilih Supplier is back.
    await userEvent.click(canvas.getByTestId("restock-all-supplier-clear"));
    await expect(canvas.getByTestId("restock-all-supplier-none")).toBeVisible();
    for (const i of [0, 1, 2]) {
      await expect(canvas.getByTestId(`restock-line-${i}-supplier-shown`)).toHaveTextContent("Not chosen yet");
    }
    await expect(canvas.getByTestId(`${ALL_OPEN}-trigger`)).toBeVisible();
  },
};

// AN EDIT WHOSE LINES SHARE ONE SUPPLIER OPENS WITH IT as the supplier for all, every line following; lines that differ
// open without one, each keeping its own.
export const AnEditFromOneSupplierOpensWithIt: Story = {
  name: "Edit · one supplier",
  render: () => <EditOngoing />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent(CAHAYA.name), {
      timeout: 4000,
    });
    for (const i of [0, 1, 2]) {
      await expect(canvas.getByTestId(`restock-line-${i}-supplier-follows`)).toBeInTheDocument();
    }
  },
};

export const AnEditFromSeveralSuppliersOpensWithout: Story = {
  name: "Edit · several suppliers",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await canvas.findByTestId("restock-line-2");
    await expect(canvas.getByTestId("restock-all-supplier-none")).toBeVisible();
    await expect(canvas.queryByTestId("restock-line-0-supplier-follows")).toBeNull();
    await expect(canvas.getByTestId(`${ALL_OPEN}-trigger`)).toBeVisible();
  },
};

/** 501 cut to its first product — Beras, bought from PT Sumber Makmur's Shopee store. */
function ongoingWithOneProduct() {
  const saved = ONGOING.items;
  ONGOING.items = saved.slice(0, 1);
  resetRestockStub();

  return () => {
    ONGOING.items = saved;
    resetRestockStub();
  };
}

// AN EDIT OF ONE PRODUCT OPENS WITH ITS SUPPLIER on top (owner: *"aku lihat di dev belum begitu … maksudku untuk supplier
// paling atas sendiri"*, an-edit-opens-with-its-one-supplier) — one product is "all of them", so the supplier part is not
// left empty; the product follows it.
export const AOneProductEditOpensWithItsSupplier: Story = {
  name: "Edit · one product",
  render: () => <EditOngoing />,
  beforeEach: ongoingWithOneProduct,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent(SUMBER.name), {
      timeout: 4000,
    });
    await expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent("Sumber Makmur Official");
    await expect(canvas.getByTestId("restock-line-0-supplier-follows")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-line-1")).toBeNull();
  },
};
