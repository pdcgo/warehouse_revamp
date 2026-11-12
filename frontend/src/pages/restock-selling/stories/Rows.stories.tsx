import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { FORMER_USER_ID } from "../../../../.storybook/fixtures";
import { restockLogByForStory, restockRaisedByForStory, restockStepByForStory } from "../../../../.storybook/restockStub";
import { SELLING_META, loaded } from "./kit";

// RESTOCK SELLING — the screen's own rules and what a row shows — its columns, its references, its value, its badges, and who raised it. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Rows",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE SCREEN NAMES ITSELF (the-desktop-shell-has-no-top-bar) and its action carries its icon
// (an-action-button-carries-its-icon); the picked tab is bold (a-selected-tab-is-bold); the pager is on screen even on
// one page (the-pager-is-always-on-screen).
export const TheScreenRules: Story = {
  name: "Screen rules",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Restock" })).toBeVisible();
    await expect(canvas.getByTestId("open-create-restock").querySelector("svg")).not.toBeNull();
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-all")).fontWeight).toBe("700");
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-ongoing")).fontWeight).not.toBe("700");
    await expect(canvas.getByTestId("restock-pager")).toBeVisible();
    // Created: when, and by whom under it — two lines, never three.
    const created = canvas.getByTestId("restock-created-by-501");
    await expect(created).toHaveTextContent("by Ani Rahayu");
    await expect(created.parentElement).toHaveTextContent(/\d{2}:\d{2}by /);
  },
};

// A FORMER USER (erase-keeps-the-row): a restock raised by somebody since erased still names them — "by Former user
// #69", never the synthetic username `erased69`.
export const RaisedByAFormerUser: Story = {
  name: "Raised by a former user",
  beforeEach: () => restockRaisedByForStory(501n, FORMER_USER_ID),
  play: async ({ canvasElement }) => {
    const row = (await loaded(canvasElement)).getByTestId("restock-row-501");

    await waitFor(() => expect(row).toHaveTextContent("Former user #69"));
    await expect(row).not.toHaveTextContent("erased69");
  },
};

// THE OWNER'S COLUMN ORDER (the-restock-list-leads-with-its-references) — the reference first, then the supplier, the
// warehouse, the products, the total, the courier, the status, the two dates and the actions.
export const TheReferenceLeadsTheRow: Story = {
  name: "Columns",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headings = within(canvas.getByTestId("restock-requests-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());

    await expect(headings).toEqual([
      "Reference",
      "Supplier",
      "Warehouse",
      "Products",
      "Total",
      "Shipment",
      "Status",
      "Created",
      "Accepted",
      "Actions",
    ]);
    // Our own number is not on the row.
    await expect(canvas.getByTestId("restock-row-503")).not.toHaveTextContent("#503");
  },
};

// THE ORDER NUMBER AND THE TRACKING NUMBER ARE COPYABLE, and a long one is cut with its tooltip saying it whole (owner:
// *"order id dan resinya copyable … harus ada pembatasan tapi juga harus ada cara lihat fullnya"*). Copying never opens
// the restock under it.
export const TheReferencesCopyAndALongOneIsCut: Story = {
  name: "Copy, and a long one cut",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 504's tracking number runs long: cut on the row, whole in its tooltip and in what is copied.
    const shown = canvas.getByTestId("restock-receipt-504-shown");
    await expect(shown.scrollWidth).toBeGreaterThan(shown.clientWidth);
    await expect(canvas.getByTestId("restock-receipt-504")).toHaveAccessibleName("Copy: JNE-CGK-20260911-0000111122-REG");
    await userEvent.hover(canvas.getByTestId("restock-receipt-504"));
    const whole = await screen.findByTestId("restock-receipt-504-whole");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(whole).toHaveTextContent("JNE-CGK-20260911-0000111122-REG");
    await userEvent.unhover(canvas.getByTestId("restock-receipt-504"));

    // A short one is shown whole.
    const short = canvas.getByTestId("restock-receipt-503-shown");
    await expect(short.scrollWidth).toBeLessThanOrEqual(short.clientWidth);

    await userEvent.click(canvas.getByTestId("restock-invoice-503"));
    await waitFor(() => {
      const el = canvas.getByTestId("restock-invoice-503");
      expect(el.hasAttribute("data-copied") || el.hasAttribute("data-copy-failed")).toBe(true);
    });
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ARowLightsUp: Story = {
  name: "Lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-503");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// the-couriers-charge-stays-out-of-total — 503's Value is goods 950.000 + shipping 30.000, not the 5.000 the courier
// asked at the door.
export const TheValueIsGoodsPlusShipping: Story = {
  name: "Value",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-value-503")).toHaveTextContent("Rp 980.000");
    await expect(canvas.getByTestId("restock-value-501")).toHaveTextContent("Rp 2.080.000");
  },
};

// a-short-unit-at-the-door-is-missing — an accepted row with units short says MISSING.
export const MissingUnitsAreFlagged: Story = {
  name: "Missing badge",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await expect(canvas.queryByTestId("restock-missing-501")).toBeNull();
  },
};

// The supplier is read off the lines, and a deleted store still shows, badged (a-deleted-supplier-still-shows-with-a-
// badge). The invoice and the tracking number are labelled.
export const SupplierInvoiceAndCourier: Story = {
  name: "Supplier and references",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-supplier-503")).toHaveTextContent("PT Sumber Makmur"));
    await waitFor(() => expect(within(canvas.getByTestId("restock-supplier-507")).getByTestId("deleted-badge")).toBeVisible());
    // 501's lines name two suppliers — the first, and "+1 more".
    await expect(canvas.getByTestId("restock-supplier-501")).toHaveTextContent("+1 more supplier");
    await expect(canvas.getByTestId("restock-invoice-503")).toHaveTextContent("INV/2026/09/0412");
    await expect(canvas.getByTestId("restock-receipt-503")).toHaveTextContent("SCP5544332211");
  },
};

// RAISED BY ROOT FROM OUTSIDE (an-override-shows-a-platform-badge): Fajar, a Root, raised 501 inside Toko Melati, which he
// is not in — its Created cell names him with the "by Root team" badge, read from the create's trail row. No other row
// carries one: the badge is the override row's only.
const raisedByRoot = () => {
  restockRaisedByForStory(501n, 66n);
  restockLogByForStory(501n, 1n, 66n, true);
};

export const RaisedByRootFromOutside: Story = {
  name: "Raised by Root from outside",
  beforeEach: raisedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = canvas.getByTestId("restock-created-by-501");

    await waitFor(() => expect(created).toHaveTextContent("by Fajar Nugroho"));
    await expect(within(created).getByTestId("root-team-badge")).toHaveTextContent("by Root team");
    await expect(within(canvas.getByTestId("restock-requests-table")).getAllByTestId("root-team-badge")).toHaveLength(1);
    await expect(within(canvas.getByTestId("restock-row-502")).queryByTestId("root-team-badge")).toBeNull();
  },
};

// The same on a phone: the badge after the name on the block's when-and-who line, its sentence on a tap.
export const MobileRaisedByRootFromOutside: Story = {
  name: "Raised by Root from outside (phone)",
  globals: { viewport: { value: "mobile2" } },
  beforeEach: raisedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = canvas.getByTestId("restock-created-by-501");

    await waitFor(() => expect(created).toHaveTextContent("Fajar Nugroho"));
    const badge = within(created).getByTestId("root-team-badge");
    await expect(badge).toBeVisible();
    await expect(within(canvas.getByTestId("restock-requests-table")).getAllByTestId("root-team-badge")).toHaveLength(1);

    await userEvent.click(badge);
    const hint = await screen.findByTestId("root-team-badge-hint");
    await waitFor(() => expect(hint).toBeVisible());
    // The tap reads the sentence; it does not open the restock.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// COUNTED IN BY ROOT FROM OUTSIDE (an-override-shows-a-platform-badge): Fajar, a Root, counted 503 in at Gudang Pusat,
// which he is not in — its Accepted cell names him with the "by Root team" badge, read from the accept's own trail row.
// The create (Ani's) and 507's accept (Budi's) stay plain: the badge is that one step's.
const countedByRoot = () => {
  restockStepByForStory(503n, "accepted", 66n);
  restockLogByForStory(503n, 3n, 66n, true);
};

export const AcceptedByRootFromOutside: Story = {
  name: "Accepted by Root from outside",
  beforeEach: countedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const accepted = canvas.getByTestId("restock-accepted-by-503");

    await waitFor(() => expect(accepted).toHaveTextContent("by Fajar Nugroho"));
    await expect(within(accepted).getByTestId("root-team-badge")).toHaveTextContent("by Root team");
    await expect(within(canvas.getByTestId("restock-requests-table")).getAllByTestId("root-team-badge")).toHaveLength(1);
    await expect(within(canvas.getByTestId("restock-created-by-503")).queryByTestId("root-team-badge")).toBeNull();
    await expect(within(canvas.getByTestId("restock-accepted-by-507")).queryByTestId("root-team-badge")).toBeNull();
  },
};

// A phone block names only who raised it — the accepted date and its person are the detail page's, a tap away (the
// block's own comment) — so the accept's badge is not drawn on the list there, and the create's line stays plain.
export const MobileAcceptedByRootFromOutside: Story = {
  name: "Accepted by Root from outside (phone)",
  globals: { viewport: { value: "mobile2" } },
  beforeEach: countedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("restock-requests-table");

    await waitFor(() => expect(canvas.getByTestId("restock-created-by-503")).toHaveTextContent("Ani"));
    await expect(table.tagName).not.toBe("TABLE");
    await expect(canvas.queryByTestId("restock-accepted-by-503")).toBeNull();
    await expect(within(table).queryAllByTestId("root-team-badge")).toHaveLength(0);
  },
};
