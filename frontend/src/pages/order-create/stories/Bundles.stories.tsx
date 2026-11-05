import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { bundleFixture } from "../../../../.storybook/bundleFixtures";
import { users } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { withProductState } from "../../../../.storybook/productScenario";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ORDER_CREATE_META } from "./kit";

// ORDER CREATE — the bundle card: its dialog, items OR bundles, a bundle's products as real lines.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Bundles",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ A BUNDLE'S PRODUCTS ARE REAL LINES. They are drawn from the same warehouse, judged by the same
// rule and SENT with the order — and nothing else is: the order keeps no trace of the bundle
// (the-order-keeps-only-product-lines). The short-line alert is the proof: a slot asking for more than
// the shelf holds blocks Create exactly as a hand-picked line does. If bundles were decorative, this
// would pass in silence and the totals would promise stock the order never draws.
//
// Toko Melati's own Paket Hemat (BundleList) — the CS places orders and reads the team's bundles.
const HEMAT = bundleFixture("Paket Hemat", users[0]!.id);
const DAPUR = bundleFixture("Paket Dapur");

async function addBundles(canvas: ReturnType<typeof within>, ids: string[]) {
  await userEvent.click(await canvas.findByTestId("bundle-add"));
  const dialog = await screen.findByTestId("bundle-picker-dialog");
  await waitFor(() => expect(dialog).toBeVisible());
  // The rows are the server's answer to the search, so they arrive after the dialog does.
  for (const id of ids) await userEvent.click(await within(dialog).findByTestId(`bundle-pick-${id}`, {}, { timeout: 4000 }));
  await userEvent.click(within(dialog).getByTestId("bundle-picker-confirm"));
  await waitFor(() => expect(screen.queryByTestId("bundle-picker-dialog")).toBeNull());
}

export const ABundlesProductsAreOrderedLikeAnyOther: Story = {
  name: "Real lines",
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));
    await addBundles(canvas, [HEMAT.id.toString()]);

    // Gula Pasir (73) has TWELVE on the shelf in the fixtures.
    const qty = await canvas.findByTestId("slot-qty-73");
    await userEvent.clear(qty);
    await userEvent.type(qty, "20", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("order-create-short")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// A BUNDLE'S PRODUCT ITS OWNER HAS SINCE LOCKED (a-borrowed-product-never-blocks-its-owner): the bundle still has the
// line, but an order cannot take it — so its slot starts EMPTY and says why, for the CS to fill with something else.
export const ALockedProductLeavesItsSlotEmpty: Story = {
  name: "Locked, slot empty",
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
    withProductState(73n, { crossLocked: true })();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));
    await addBundles(canvas, [HEMAT.id.toString()]);

    const note = await canvas.findByTestId(/^slot-unavailable-.*-73$/);
    await expect(note).toHaveTextContent("Locked by its owner");
    await expect(canvas.queryByTestId("slot-qty-73")).toBeNull();
    // The usable product still went in.
    await expect(canvas.getByTestId("slot-qty-74")).toBeInTheDocument();
  },
};

// A BORROWED PRODUCT MAPPED BEFORE ARRIVES LOCKED (the-return-map-is-selling-services-and-read-by-ids). Toko Melati
// mapped Toko Kenanga's Gula Pasir (73) to its own Beras (74) on an earlier order; Paket Hemat puts Gula on this one, and
// ProductReturnMapByIds hands the pair back — named from the product read, locked, and saying where it came from.
export const ABorrowedProductMappedBeforeArrivesLocked: Story = {
  name: "Mapped before, locked",
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));
    await addBundles(canvas, [HEMAT.id.toString()]);

    const locked = await canvas.findByTestId("return-map-locked-73", {}, { timeout: 4000 });
    await waitFor(() => expect(locked).toHaveTextContent("Beras Pandan Wangi 5kg"));
    await expect(canvas.getByTestId("return-map-remembered-73")).toBeInTheDocument();
    await expect(canvas.queryByTestId("return-map-needs-73")).toBeNull();
    // Its own Beras is not borrowed, so it has no row at all.
    await expect(canvas.queryByTestId("return-map-74")).toBeNull();
  },
};

// ── Items or bundles, and the bundle dialog (frada) ──────────────────────────────────────────────

// BUNDLES ARE ADDED THE WAY ITEMS ARE (owner: *"tambah bundle buat seperti item"*, bundles-are-added-like-items) — a
// Tambah Bundel button under the card's title opening a dialog: a search that also reads the slot labels, ticked rows,
// Kosongkan · Batal · Konfirmasi. Several at once; Confirm waits for a tick.
export const BundlesAreAddedLikeItems: Story = {
  name: "Added like items",
  // The bundles are Toko Melati's.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));

    await userEvent.click(await canvas.findByTestId("bundle-add"));
    const dialog = await screen.findByTestId("bundle-picker-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const inDialog = within(dialog);
    await expect(inDialog.getByTestId("bundle-picker-confirm")).toBeDisabled();

    // The search is the server's, and reads a bundle's products too — "tepung" finds Paket Dapur, not Paket Hemat.
    const height = dialog.getBoundingClientRect().height;
    await userEvent.type(inDialog.getByTestId("bundle-picker-search"), "tepung", { delay: 30 });
    await waitFor(() => expect(inDialog.queryByTestId(`bundle-pick-${HEMAT.id}`)).toBeNull());
    await expect(await inDialog.findByTestId(`bundle-pick-${DAPUR.id}`, {}, { timeout: 4000 })).toBeVisible();
    // A FIXED HEIGHT (a-picker-dialog-keeps-its-height) — the list narrowed, the panel did not.
    await expect(dialog.getBoundingClientRect().height).toBe(height);
    await userEvent.clear(inDialog.getByTestId("bundle-picker-search"));

    // Two at once.
    await userEvent.click(await inDialog.findByTestId(`bundle-pick-${HEMAT.id}`, {}, { timeout: 4000 }));
    await userEvent.click(await inDialog.findByTestId(`bundle-pick-${DAPUR.id}`, {}, { timeout: 4000 }));
    await userEvent.click(inDialog.getByTestId("bundle-picker-confirm"));

    await waitFor(() => expect(canvas.getAllByTestId(new RegExp(`^bundle-(${HEMAT.id}|${DAPUR.id})-\\d+$`))).toHaveLength(2));
  },
};

// AN ORDER HOLDS ITEMS OR BUNDLES, NEVER BOTH (owner: *"order create items dan bundle cuma boleh pilih salah satu"*,
// an-order-holds-items-or-bundles). One radio pill picks the card — Items first, and only that card shows. Leaving an
// empty card is immediate; leaving one that holds something asks first, and the confirm empties it.
export const AnOrderHoldsItemsOrBundles: Story = {
  name: "Items or bundles",
  // The bundles are Toko Melati's.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("order-items-help")).toBeVisible();
    await expect(canvas.queryByTestId("bundle-add")).toBeNull();

    // An empty items card — the switch is immediate.
    await userEvent.click(canvas.getByTestId("order-contents-bundles"));
    await expect(await canvas.findByTestId("bundle-add")).toBeVisible();
    await expect(canvas.queryByTestId("order-items-help")).toBeNull();

    await addBundles(canvas, [HEMAT.id.toString()]);
    await canvas.findByTestId("slot-qty-74");

    // A card holding a bundle — the switch asks, and Cancel keeps it.
    await userEvent.click(canvas.getByTestId("order-contents-items"));
    let dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("will be removed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(canvas.getByTestId("slot-qty-74")).toBeVisible();

    // …and the confirm empties it and switches.
    await userEvent.click(canvas.getByTestId("order-contents-items"));
    dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await expect(await canvas.findByTestId("order-items-help")).toBeVisible();

    await userEvent.click(canvas.getByTestId("order-contents-bundles"));
    await expect(await canvas.findByTestId("bundle-empty")).toBeVisible();
  },
};
