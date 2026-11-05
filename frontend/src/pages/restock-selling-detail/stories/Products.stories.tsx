import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { At502, At503, SELLING_DETAIL_META, loaded, openTab, routedAt } from "./kit";

// RESTOCK SELLING DETAIL — the lines — the adjustment column and its dialog, the broken units' photo, where each was bought, and
// on a phone a block per line.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Products",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const At507 = routedAt(507n);

// a-short-unit-at-the-door-is-missing — the column is MISSING, never Lost. 503's rice: 10 ordered, 9 in the box, 2 of
// them broken — so 7 good, 2 broken worth 132.333,33 with the warehouse's note, 1 missing worth 66.166,67. Each is the
// landed price, 650.000 ÷ 10 + (30.000 shipping + 5.000 courier's charge) ÷ 30 ordered = 66.166,67
// (the-problem-price-is-filled-by-the-system, all-qty-is-every-unit-ordered).
//
// THE COUNT IS ONE COLUMN, PENYESUAIAN (the-count-is-one-adjustment-column) — the good units and what went wrong as
// badges; its detail, every figure, opens in a dialog. The problem is MISSING (Kurang), never Lost.
export const TheMissingColumn: Story = {
  name: "Adjustment column",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const table = canvas.getByTestId("restock-detail-items");
    const headings = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    await expect(headings).toEqual(["Product", "Supplier", "Ordered", "Adjustment", "Unit price", "Line total"]);

    const cell = canvas.getByTestId("restock-detail-adjustment-74");
    await expect(cell).toHaveTextContent(/Good 7.*Broken 2.*Missing 1/);
    await userEvent.click(cell);
    const dialog = await screen.findByTestId("restock-detail-adjustment-74-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(within(dialog).getByTestId("restock-detail-ordered-74")).toHaveTextContent("10");
    await expect(within(dialog).getByTestId("restock-detail-received-74")).toHaveTextContent("9");
    await expect(within(dialog).getByTestId("restock-detail-good-74")).toHaveTextContent("7");
    await expect(within(dialog).getByTestId("restock-detail-broken-74-count")).toHaveTextContent("2");
    await expect(within(dialog).getByTestId("restock-detail-broken-74-value")).toHaveTextContent("Rp 132.333");
    await expect(within(dialog).getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");
    await expect(within(dialog).getByTestId("restock-detail-missing-74-count")).toHaveTextContent("1");
    await expect(within(dialog).getByTestId("restock-detail-missing-74-value")).toHaveTextContent("Rp 66.167");
    await expect(canvas.getByTestId("restock-detail-missing")).toHaveTextContent("1 missing");
  },
};

// THE BROKEN UNITS' PHOTO (a-broken-product-carries-a-photo) — under the broken row in the Penyesuaian dialog, a SAMPLE
// marked as one (the page's second mark); a line with nothing broken shows none.
export const TheBrokenRowShowsItsPhoto: Story = {
  name: "Broken photo",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await userEvent.click(canvas.getByTestId("restock-detail-adjustment-74"));
    const dialog = await screen.findByTestId("restock-detail-adjustment-74-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    const photo = within(dialog).getByTestId("restock-detail-broken-photo-74");
    await expect(within(photo).getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
    await expect(within(photo).getByTestId("not-implemented-brokenPhoto")).toHaveTextContent("2");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("restock-detail-adjustment-74-dialog")).toBeNull());

    // The tea came as ordered — its cell opens nothing, and there is no photo for it anywhere.
    await expect(screen.queryByTestId("restock-detail-broken-photo-72")).toBeNull();
  },
};

// …and on a phone, a thumbnail in the line's block that opens the photo whole.
export const OnAPhoneTheBrokenPhotoIsAThumbnail: Story = {
  name: "Phone · photo thumbnail",
  render: () => <At503 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const rice = canvas.getByTestId("restock-detail-item-74");
    await userEvent.click(within(rice).getByTestId("restock-detail-broken-photo-74-open"));
    const whole = await screen.findByTestId("restock-detail-broken-photo-74-dialog");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(within(whole).getByRole("img")).toBeVisible();
  },
};

// Before the count, the adjustment is "—" — not counted yet — never the 0 the fields hold, and nothing to open.
export const NotCountedYetReadsAsADash: Story = {
  name: "Not counted, a dash",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await expect(canvas.getByTestId("restock-detail-adjustment-74")).toHaveTextContent("—");
    await expect(canvas.getByTestId("restock-detail-adjustment-74").tagName).not.toBe("BUTTON");
  },
};

// a-deleted-supplier-still-shows-with-a-badge — 507's line was bought from a store deleted since: still named, badged.
export const ADeletedStoreKeepsItsName: Story = {
  name: "Deleted store named",
  render: () => <At507 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const supplier = canvas.getByTestId("restock-detail-supplier-72");
    await waitFor(() => expect(within(supplier).getByTestId("deleted-badge")).toBeVisible());
    await expect(supplier).toHaveTextContent("PT Sumber Makmur");
  },
};

// Each line names its own supplier and store, or says it has none — a stall has a supplier and no store
// (a-line-may-name-a-supplier-without-a-channel).
export const EachLineNamesWhereItWasBought: Story = {
  name: "Where it was bought",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await waitFor(() => expect(canvas.getByTestId("restock-detail-supplier-74")).toHaveTextContent("PT Sumber Makmur"));
    await expect(canvas.getByTestId("restock-detail-supplier-71")).toHaveTextContent("Toko Grosir Sinar");
    await expect(canvas.getByTestId("restock-detail-supplier-72")).toHaveTextContent("Not connected to a supplier");
  },
};

// The line's own note — the selling team's word on why there are 12 (extra-units-are-added-by-the-selling-teams-edit).
export const TheLineNote: Story = {
  name: "Line note",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    // An icon at the end of the product — its words in its name and its tooltip, so the cell stays two lines.
    const note = canvas.getByTestId("restock-detail-line-note-71");
    await expect(note).toHaveAccessibleName(/^Note: extra stock/);
    await userEvent.hover(note);
    const text = await screen.findByTestId("restock-detail-line-note-71-text");
    await waitFor(() => expect(text).toBeVisible());
    await expect(text).toHaveTextContent("extra stock");
  },
};

// ON A PHONE EACH LINE IS A BLOCK (a-phone-reads-each-line-as-a-block) — 503's rice: the product, where it was bought,
// 10 × the unit price beside the line's total, what came and was good, and each problem with its worth and note.
export const OnAPhoneEachLineIsABlock: Story = {
  name: "Phone · a line, a block",
  render: () => <At503 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const items = canvas.getByTestId("restock-detail-items");
    await expect(within(items).queryAllByRole("columnheader")).toHaveLength(0);
    const rice = canvas.getByTestId("restock-detail-item-74");
    await expect(rice).toHaveTextContent(/10 × Rp/);
    await expect(within(rice).getByTestId("restock-detail-received-74")).toHaveTextContent("9");
    await expect(within(rice).getByTestId("restock-detail-good-74")).toHaveTextContent("7");
    await expect(within(rice).getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");
    await expect(within(rice).getByTestId("restock-detail-missing-74-value")).toHaveTextContent("Rp 66.167");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// A PRODUCT ROW LIGHTS UP UNDER THE POINTER, every cell (a-table-row-lights-up); a line that came as ordered says so,
// in the success tone (the-count-is-one-adjustment-column).
export const AProductRowLightsUpAndStaysTwoLines: Story = {
  name: "Lights up",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const row = canvas.getByTestId("restock-detail-item-74");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));

    // 503's tea came as ordered.
    await expect(canvas.getByTestId("restock-detail-adjustment-72")).toHaveTextContent("As ordered");
  },
};
