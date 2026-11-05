import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { lastRackWrite, rackHistoryByForStory, rackShelf, rackStubScenario } from "../../../.storybook/rackStub";
import { FORMER_USER_ID } from "../../../.storybook/fixtures";
import { reportScenario } from "../../../.storybook/foundRequestStub";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RackDetailPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the placement decisions (docs/business/inventory/placement_decision.md).
// Rack detail as Gudang Pusat's staff read it, with its two writes: Move Goods and Record Sample. Both answer
// Unimplemented on the real server until design_accept; here rackStub.ts plays the decided rules.
//
// The shelves (rackStub.ts): A-01-1 (41) holds Kopi Arabika 71 ×12 (team 11), Gula Pasir 73 ×5 (Kenanga, 13) and
// Beras 74 ×8 (Melati, 12). A-01-2 (42) holds Kopi ×6 and Teh Melati 72 ×3, which a count is holding. B-02-1 (43) is
// empty.

function routedAt(rackId: bigint) {
  return routedPage(
    [
      { path: "/inventories/racks/:rackId", element: <RackDetailPage /> },
      marker("/inventories/racks", "at-rack-list"),
    ],
    `/inventories/racks/${rackId}`,
  );
}

const At41 = routedAt(41n);
const At42 = routedAt(42n);

const meta = {
  title: "Pages/Inventory/Racks/RackDetail",
  component: At41,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function type(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 40 });
}

// The dialog portals and every RackSelect in it renders its options inline, so an option is looked up inside ITS
// picker's root — a dialog with one picker per line has the same option ids several times over.
async function pickRack(triggerTestId: string, rackId: bigint) {
  const trigger = await screen.findByTestId(triggerTestId);
  const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
  await userEvent.click(trigger);
  const option = await within(root).findByTestId(`rack-select-option-${rackId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// The Products and Prices tabs mount the same table, so a row testid exists twice: read the Products one.
const stock = (canvas: ReturnType<typeof within>) => within(canvas.getByTestId("rack-detail-stock"));

async function openMove() {
  await userEvent.click(await screen.findByTestId("rack-action-move"));
  await screen.findByTestId("move-goods-dialog");
  await screen.findByTestId("move-line-71");
}

async function openSample() {
  await userEvent.click(await screen.findByTestId("rack-action-sample"));
  await screen.findByTestId("record-sample-dialog");
}

// The rack as staff read it: the code, each product's team and stock count (a-rack-shows-its-stock-count-for-now), and
// the two actions.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("rack-detail-code")).toHaveTextContent("A-01-1");
    await canvas.findByTestId("rack-detail-stock");
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12"));
    await expect(stock(canvas).getByTestId("rack-stock-onhand-73")).toHaveTextContent("5");
    await expect(stock(canvas).getByTestId("rack-stock-onhand-74")).toHaveTextContent("8");
    // WHOSE IT IS, in its own column: three teams' goods on one rack.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-team-74")).toHaveTextContent("Toko Melati"));
    await expect(stock(canvas).getByTestId("rack-stock-team-73")).toHaveTextContent("Toko Kenanga");
    await expect(stock(canvas).getByTestId("rack-stock-team-71")).toHaveTextContent("Gudang Pusat");
    await expect(canvas.getByTestId("rack-action-move")).toBeInTheDocument();
    await expect(canvas.getByTestId("rack-action-sample")).toBeInTheDocument();
  },
};

// Two teams' goods to one rack: the shelves change and the server writes one transaction per owning team
// (a-move-writes-one-transaction-per-owning-team). Every product starts at 0, so only what is typed moves.
export const MoveToOneRack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openMove();
    // ON A DESKTOP IT IS A DIALOG, NOT A SHEET — as tall as its lines, never held to the window's height (full screen
    // is the phone's, by the JS breakpoint; a responsive `size` once kept full's min-height here).
    await waitFor(() => {
      const box = screen.getByTestId("move-goods-dialog");
      expect(box.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.95);
      expect(parseFloat(getComputedStyle(box).minHeight) || 0).toBeLessThan(window.innerHeight * 0.5);
    });

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");
    await type(screen.getByTestId("move-qty-73-0"), "5");

    await expect(screen.getByTestId("move-to-default-71-0")).toHaveTextContent("A-01-2");
    await expect(screen.getByTestId("move-summary")).toHaveTextContent("9 units of 2 product(s) to 1 rack(s)");
    await userEvent.click(screen.getByTestId("move-submit"));

    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());
    await expect(rackShelf(41n, 71n)).toBe(8n);
    await expect(rackShelf(42n, 71n)).toBe(10n);
    await expect(rackShelf(42n, 73n)).toBe(5n);
    await expect(lastRackWrite()?.transactions.map((t) => t.teamId)).toEqual([11n, 13n]);

    // The page reads again: Gula has left this rack, Kopi is down to 8.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("8"));
    await expect(stock(canvas).queryByTestId("rack-stock-row-73")).toBeNull();
  },
};

// A to B and C: one product split over two racks (a-move-is-one-rack-to-one-or-more-racks). The first line keeps the
// default rack; the split line names its own.
export const SplitOverTwoRacks: Story = {
  play: async () => {
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-74-0"), "5");
    await userEvent.click(screen.getByTestId("move-split-74"));
    await pickRack("move-to-74-1", 43n);
    await type(screen.getByTestId("move-qty-74-1"), "3");

    await expect(screen.getByTestId("move-summary")).toHaveTextContent("8 units of 1 product(s) to 2 rack(s)");
    await userEvent.click(screen.getByTestId("move-submit"));

    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());
    await expect(rackShelf(41n, 74n)).toBe(0n);
    await expect(rackShelf(42n, 74n)).toBe(5n);
    await expect(rackShelf(43n, 74n)).toBe(3n);
    await expect(lastRackWrite()?.transactions.map((t) => t.teamId)).toEqual([12n]);
  },
};

// "Move Everything" fills each product up to its stock count — and until a rack is chosen, Move waits and says why.
export const MoveEverythingNeedsARack: Story = {
  play: async () => {
    await openMove();

    await userEvent.click(screen.getByTestId("move-everything"));

    await expect(screen.getByTestId("move-qty-71-0")).toHaveValue("12");
    await expect(screen.getByTestId("move-qty-73-0")).toHaveValue("5");
    await expect(screen.getByTestId("move-qty-74-0")).toHaveValue("8");
    await expect(screen.getAllByTestId("move-problem")[0]).toHaveTextContent(/choose where/i);
    await expect(screen.getByTestId("move-submit")).toBeDisabled();

    await pickRack("move-default-to", 43n);
    await waitFor(() => expect(screen.getByTestId("move-submit")).toBeEnabled());
  },
};

// The source rack is never a destination: it is not even offered.
export const TheSourceRackIsNotOffered: Story = {
  play: async () => {
    await openMove();

    const trigger = screen.getByTestId("move-default-to");
    const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
    await userEvent.click(trigger);
    await within(root).findByTestId("rack-select-option-42");

    await expect(within(root).queryByTestId("rack-select-option-41")).toBeNull();
  },
};

// One product to the same rack twice is one line, not two: Move waits and names it.
export const SameRackTwiceIsOneLine: Story = {
  play: async () => {
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-74-0"), "4");
    await userEvent.click(screen.getByTestId("move-split-74"));
    await pickRack("move-to-74-1", 42n);
    await type(screen.getByTestId("move-qty-74-1"), "2");

    await expect(screen.getByTestId("move-problem")).toHaveTextContent(/A-01-2 twice/);
    await expect(screen.getByTestId("move-submit")).toBeDisabled();
  },
};

// ALL OR NOTHING (a-move-is-all-or-nothing): somebody took two Gula a second before the click. The dialog allowed 5;
// the server refuses the WHOLE move and names the product — Kopi did not move either.
export const RefusedWholeWhenALineChanged: Story = {
  play: async () => {
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");
    await type(screen.getByTestId("move-qty-73-0"), "5");

    rackStubScenario.raceBeforeNextWrite = { rackId: 41n, productId: 73n, onHand: 3n };
    await userEvent.click(screen.getByTestId("move-submit"));

    await expect(await screen.findByTestId("move-error")).toHaveTextContent(/Gula Pasir 1kg: only 3 on A-01-1/);
    await expect(screen.getByTestId("move-goods-dialog")).toBeInTheDocument();
    await expect(rackShelf(41n, 71n)).toBe(12n);
    await expect(rackShelf(42n, 71n)).toBe(6n);
  },
};

// A product being counted is LOCKED AT 0 — shown, not hidden, and the server refuses moving it too (RackMove answers
// "being counted"; a-lock-stops-sales-and-cancels-too).
export const ACountedProductIsLocked: Story = {
  render: () => <At42 />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("rack-action-move"));

    await expect(await screen.findByTestId("move-counting-72")).toHaveTextContent(/being counted/i);
    await expect(screen.queryByTestId("move-qty-72-0")).toBeNull();
    await expect(screen.getByTestId("move-qty-71-0")).toBeInTheDocument();
  },
};

// A SAMPLE (a-sample-is-handed-over-at-the-warehouse): staff take it off this rack — never chosen
// (a-sample-names-the-rack-it-was-taken-from) — and say who received it. It lands in the rack's stock history.
export const RecordSample: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSample();
    // ON A DESKTOP IT IS A DIALOG, NOT A SHEET — as tall as its lines, never held to the window's height (full screen
    // is the phone's, by the JS breakpoint; a responsive `size` once kept full's min-height here).
    await waitFor(() => {
      const box = screen.getByTestId("record-sample-dialog");
      expect(box.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.95);
      expect(parseFloat(getComputedStyle(box).minHeight) || 0).toBeLessThan(window.innerHeight * 0.5);
    });

    await expect(screen.getByTestId("sample-final")).toHaveTextContent(/final/i);
    await type(await screen.findByTestId("sample-qty-71"), "2");
    await expect(screen.getByTestId("sample-submit")).toBeDisabled();

    await type(screen.getByTestId("sample-recipient"), "Pak Budi");
    await userEvent.click(screen.getByTestId("sample-submit"));

    await waitFor(() => expect(screen.queryByTestId("record-sample-dialog")).toBeNull());
    await expect(rackShelf(41n, 71n)).toBe(10n);
    await expect(lastRackWrite()).toMatchObject({ kind: "sample" });
    await expect(lastRackWrite()?.transactions.map((t) => t.teamId)).toEqual([11n]);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("10"));
    await userEvent.click(canvas.getByTestId("rack-tab-stock-history"));
    await expect(await canvas.findByTestId("rack-stock-history-table")).toHaveTextContent(/sample/i);
  },
};

// A sample cannot take a product a count is holding, either.
export const ASampleOfACountedProductIsLocked: Story = {
  render: () => <At42 />,
  play: async () => {
    await openSample();

    await expect(await screen.findByTestId("sample-counting-72")).toHaveTextContent(/being counted/i);
    await expect(screen.queryByTestId("sample-qty-72")).toBeNull();
  },
};

// WHO DID IT (any-warehouse-member-may-move-goods — every row names its person): after a move, Placement History shows
// the move with the product's name and the person who made it — the signed-in staff member, Ani Rahayu.
export const PlacementHistoryNamesWhoMovedIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");
    await userEvent.click(screen.getByTestId("move-submit"));
    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());

    await userEvent.click(canvas.getByTestId("rack-tab-placement-history"));
    const table = await canvas.findByTestId("rack-placement-history-table");

    await waitFor(() => expect(table).toHaveTextContent(/moved/i));
    await expect(table).toHaveTextContent("Kopi Arabika 250g");
    await expect(table).toHaveTextContent("Ani Rahayu");
    await expect(table).toHaveTextContent("-4");
  },
};

// A FORMER USER (erase-keeps-the-row): the history still names whoever moved the goods after their account was erased —
// as "Former user #69", never the synthetic username `erased69`.
export const HistoryNamesAFormerUser: Story = {
  beforeEach: () => rackHistoryByForStory(FORMER_USER_ID),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("rack-tab-stock-history", {}, { timeout: 4000 }));
    const table = await canvas.findByTestId("rack-stock-history-table");

    await waitFor(() => expect(table).toHaveTextContent("Former user #69"));
    await expect(table).not.toHaveTextContent("erased69");
  },
};

async function pickProduct(query: string, productCode: string) {
  const dialog = await screen.findByTestId("report-found-dialog");
  const input = within(dialog).getByRole("combobox");
  await userEvent.click(input);
  await userEvent.type(input, query, { delay: 20 });
  const option = await within(dialog).findByTestId(`product-select-option-${productCode}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// REPORT FOUND (staff-may-report-a-found): staff report units found on THIS shelf — the rack is set, they pick the
// product — and it waits for the Owner or Admin, posting nothing. Its place here was accepted 2026-11-03.
export const StaffReportFoundHere: Story = {
  render: () => <At41 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-action-report-found"));
    const dialog = await screen.findByTestId("report-found-dialog");
    await expect(dialog).toHaveTextContent("Report Found on A-01-1");
    await expect(within(dialog).getByTestId("report-found-waits")).toHaveTextContent("Nothing changes until one of them approves it");
    await expect(within(dialog).getByTestId("report-found-submit")).toBeDisabled();
    // ON A DESKTOP IT IS A DIALOG, NOT A SHEET — its own height, well short of the window (full screen is the phone's,
    // by the JS breakpoint; a responsive `size` once stretched it to the window).
    await waitFor(() => expect(dialog.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.8));

    await pickProduct("beras", "SKU-BERAS-5K");
    await type(within(dialog).getByTestId("report-found-amount"), "2");
    await userEvent.type(within(dialog).getByTestId("report-found-note"), "Behind the scale", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("report-found-submit"));

    await expect(await screen.findByText("2 × SKU-BERAS-5K sent for approval")).toBeInTheDocument();
    await expect(reportScenario.last).toEqual({ productId: 74n, rackId: 41n, quantity: 2n, note: "Behind the scale" });
  },
};

// The picker offers only what this warehouse holds or has held (a-warehouse-picks-only-what-it-has-held): "gula" finds
// Gula Pasir, with its owner beside it — and not Gula Merah's carton, whose team never had it in Gudang Pusat, so a found
// of it would be refused at the report (a-found-never-stocked-here-is-refused-at-the-report).
export const ReportFoundOffersOnlyWhatWasHeldHere: Story = {
  render: () => <At41 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-action-report-found"));
    const dialog = await screen.findByTestId("report-found-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Only products this warehouse holds or has held");

    const input = within(dialog).getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "gula", { delay: 20 });
    const option = await within(dialog).findByTestId("product-select-option-SKU-GULA-1K");
    await waitFor(() => expect(option).toBeVisible());
    await expect(option).toHaveTextContent("Gula Pasir 1kg · Toko Kenanga");
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
    await expect(within(dialog).queryByTestId("product-select-option-SL-03-ANG-006")).toBeNull();
  },
};

// The Owner and Admin report from the shelf too — the same request, approved by somebody else.
export const TheOwnerReportsFoundToo: Story = {
  render: () => <At41 />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("rack-action-report-found")).toBeInTheDocument();
  },
};
