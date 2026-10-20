import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { OpnameCountPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — counting at the shelf, on a phone (opname.md §How Staff Work On Session),
// laid out like Accept Delivery: rack tiles, then one three-column card per product.
//
// Count #15 at Gudang Pusat, as STAFF. Rak A-01-1 holds Beras (counted by Budi), Minyak (not counted — book 6) and
// Tepung (revealed short 2 — book 4, counted 2); A-01-2 holds Beras, Gula and a row at 0; B-02-1 holds nothing, and an
// `all` count lists it anyway.

const routed = (entry: string) =>
  routedPage([{ path: "/inventories/opname/sessions/:sessionId/count", element: <OpnameCountPage /> }], entry);

const Racks = routed("/inventories/opname/sessions/15/count");
const RackA1 = routed("/inventories/opname/sessions/15/count?rack=41");
const RackB1 = routed("/inventories/opname/sessions/15/count?rack=43");

const meta = {
  title: "Pages/Inventory/Opname/Count",
  component: Racks,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("opname-count-rack-41", {}, { timeout: 4000 });

    await expect(canvas.getByTestId("opname-count-rack-progress-41")).toHaveTextContent("1 of 3 counted");
    await expect(canvas.getByTestId("opname-count-rack-progress-42")).toHaveTextContent("2 of 3 counted");
    // An `all` count lists the empty rack too (an-all-count-visits-every-rack).
    await expect(canvas.getByTestId("opname-count-rack-progress-43")).toHaveTextContent("Nothing expected");
    // Each tile says its state at a glance.
    await expect(canvas.getByTestId("opname-count-rack-state-41")).toHaveTextContent("In progress");
    await expect(canvas.getByTestId("opname-count-rack-state-43")).toHaveTextContent("Empty");
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  render: () => <RackA1 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("opname-count-row-1504", {}, { timeout: 4000 });

    await expect(canvas.getByTestId("opname-count-rack-code")).toHaveTextContent("A-01-1");
    // The phone header is one row: Change Rack and Add Found fold into ⋯ (the-phone-header-is-one-row).
    await expect(canvas.getByTestId("opname-count-actions")).toBeInTheDocument();
    await expect(canvas.queryByTestId("opname-count-change-rack")).toBeNull();
  },
};

// BLIND, THEN REVEALED (a-count-is-blind-then-revealed): no book figure until the count is in — then a shortage gets
// the system's lost draft, and Mark Counted waits for its reason.
export const BlindThenRevealed: Story = {
  render: () => <RackA1 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("opname-count-row-1504", {}, { timeout: 4000 });

    // Blind: the book's 6 is nowhere on the card — the frame says "hidden", and the difference waits for the count.
    await expect(within(card).queryByTestId("opname-count-expected-1504")).toBeNull();
    await expect(within(card).getByTestId("opname-count-hidden-1504")).toBeInTheDocument();
    await expect(within(card).getByTestId("opname-count-count-first-1504")).toBeInTheDocument();
    await expect(card).not.toHaveTextContent("6");

    await userEvent.type(within(card).getByTestId("opname-count-input-1504"), "5", { delay: 40 });
    await userEvent.click(within(card).getByTestId("opname-count-submit-1504"));

    // Revealed: expected 6, counted 5, short 1 — the lost draft is the system's.
    await waitFor(() => expect(within(card).getByTestId("opname-count-expected-1504")).toHaveTextContent("6"));
    await expect(within(card).getByTestId("opname-count-difference-1504")).toHaveTextContent("−1");
    await expect(within(card).getByTestId("opname-count-mark-1504")).toBeDisabled();

    await userEvent.type(within(card).getByTestId("opname-count-lost-note-1504"), "Tidak ketemu", { delay: 20 });
    await userEvent.click(within(card).getByTestId("opname-count-mark-1504"));
    await waitFor(() => expect(within(card).getByTestId("opname-row-state-counted")).toBeInTheDocument());
  },
};

// ONE RECOUNT, and it replaces the count (a-row-keeps-only-its-latest-count).
export const RecountOnce: Story = {
  render: () => <RackA1 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("opname-count-row-1504", {}, { timeout: 4000 });

    await userEvent.type(within(card).getByTestId("opname-count-input-1504"), "5", { delay: 40 });
    await userEvent.click(within(card).getByTestId("opname-count-submit-1504"));
    await userEvent.click(await within(card).findByTestId("opname-count-recount-1504"));

    await userEvent.type(within(card).getByTestId("opname-count-input-1504"), "6", { delay: 40 });
    await userEvent.click(within(card).getByTestId("opname-count-submit-1504"));

    // The recount stands, the difference is gone, and no second recount is offered.
    await waitFor(() => expect(within(card).getByTestId("opname-count-counted-1504")).toHaveTextContent("6"));
    await expect(within(card).getByTestId("opname-count-difference-1504")).toHaveTextContent("0");
    await expect(within(card).queryByTestId("opname-count-recount-1504")).toBeNull();
    await expect(within(card).getByTestId("opname-count-mark-1504")).toBeEnabled();
  },
};

// BROKEN MOVES THE LOST (a-short-rack-gets-a-lost-draft-from-the-system): Tepung is short 2; one was torn and thrown away,
// so the lost draft becomes 1 — and each draft needs its reason.
export const BrokenMovesTheLost: Story = {
  render: () => <RackA1 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("opname-count-row-1505", {}, { timeout: 4000 });

    await expect(within(card).getByTestId("opname-count-difference-1505")).toHaveTextContent("−2");
    await userEvent.type(within(card).getByTestId("opname-count-broken-1505"), "1", { delay: 40 });

    await userEvent.type(await within(card).findByTestId("opname-count-broken-note-1505"), "Sobek, dibuang", { delay: 20 });
    await expect(within(card).getByTestId("opname-count-mark-1505")).toBeDisabled();
    await userEvent.type(within(card).getByTestId("opname-count-lost-note-1505"), "Tidak ketemu", { delay: 20 });
    await userEvent.click(within(card).getByTestId("opname-count-mark-1505"));

    const drafts = await within(card).findByTestId("opname-count-final-drafts-1505");
    await expect(drafts).toHaveTextContent("Broken1");
    await expect(drafts).toHaveTextContent("Lost1");
  },
};

// A counted row is read-only to its counter (a-counted-row-is-read-only-until-sent-back).
export const CountedIsReadOnly: Story = {
  render: () => <RackA1 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("opname-count-row-1501", {}, { timeout: 4000 });

    await expect(within(card).queryByTestId("opname-count-input-1501")).toBeNull();
    await expect(within(card).getByTestId("opname-count-final-drafts-1501")).toHaveTextContent("Karung sobek, dibuang");
  },
};

// AN EMPTY RACK: nothing expected — the counter adds what is really there.
export const EmptyRack: Story = {
  render: () => <RackB1 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("opname-count-nothing-expected", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("opname-count-add-found")).toBeInTheDocument();
  },
};

// A product its team never had here is not counted: take it off the rack, tell the team
// (a-unit-never-stocked-here-comes-in-by-restock).
export const FoundButNeverStockedHere: Story = {
  render: () => <RackA1 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("opname-count-row-1504", {}, { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("opname-count-add-found"));
    const dialog = await screen.findByTestId("opname-found-dialog");
    // The dialog animates in — until it is visible, a click and the keys typed after it go nowhere.
    await waitFor(() => expect(dialog).toBeVisible());
    const input = within(dialog).getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "gula merah", { delay: 20 });
    await waitFor(() => expect(input).toHaveValue("gula merah"));
    const option = await screen.findByTestId("product-select-option-SKU-ANG-006", {}, { timeout: 4000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await userEvent.click(within(dialog).getByTestId("opname-found-submit"));
    await within(dialog).findByTestId("opname-found-never-here");
  },
};
