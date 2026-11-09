import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { orders, teams } from "../../../.storybook/fixtures";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { withReturnWarehouse } from "../../../.storybook/returnConfigurationStub";
import { returnAcceptScenario, withOrdersInReturn } from "../../../.storybook/sessionScenario";
import { RETURN_ACCEPT_PATH } from "../../features/orders/returnAccept";
import { PickOrderPage } from "../pick-order";
import { PickQueuePage } from "../pick-queue";
import { OrderReturnAcceptPage, description } from "./index";

// THE RETURN ACCEPT WITH ITS STOCK HALF (inventory/return_decision.md the-return-accept-page-is-accepted, and
// order/context_decision.md only-the-return-warehouse-accepts-a-return), at `/warehouse-orders/:orderId/accept-return`.
//
// A PAGE, as Accept Delivery and a transfer's accept are (a-counted-line-is-three-columns): per line what it is · what
// came back (missing, broken — typed; sound — worked out) · where it goes (racks, split like Accept Delivery's).
//
//   | story                                   | the rule it pins                                                         |
//   | --------------------------------------- | ------------------------------------------------------------------------ |
//   | Default                                 | a whole parcel: every line sound, Accept waits for the racks             |
//   | Mobile                                  | the phone: one-row header, Accept as its icon, each line a block          |
//   | AWholeParcelGoesOnTheShelf              | a rack per line, Accept, the request carries the racks and no door rows  |
//   | AShortAndBrokenParcel                   | broken thrown away, missing named, both borne by the selling team        |
//   | ABrokenLineTakesANote                   | the optional note shows once broken/missing is above 0, and is sent     |
//   | BrokenAndMissingNeverExceedTheLine      | sound is never negative: above the line is said and holds Accept          |
//   | AcceptWaitsForEveryRack                 | one line without a rack holds Accept, counted in the header              |
//   | ASplitAcrossTwoRacks                    | the first row follows, a second row takes a share; a rack twice holds   |
//   | ABorrowedLineShowsTheCodeToPrint        | the own code on the line, one label per sound unit                       |
//   | TheCourierAskNeedsWhatItWasFor          | the courier's ask as today — a charge needs its note                     |
//   | TheWrongWarehouseIsRefused              | not the return warehouse: "this return goes to Gudang Cabang", no Accept |
//   | TheRefusalOpensTheOrder                 | its way on is the order, never an Accept                                 |
//   | ATeamWithNoReturnWarehouse              | nobody can accept it                                                     |
//   | AServerRefusalIsSaid                    | a refused put-away (a count running) is said, the order stays in return  |
//   | ReceiveOpensTheAcceptPage               | Receive a Return's Accept opens the page; Back returns to the queue      |
//   | ReceiveSaysWhereAnotherBuildingsGoes    | the search shows where it goes, no Accept                                 |
//   | ThePickPageOpensTheAcceptPage           | the pick page's Accept Return opens the page; Back returns to it          |

const WAREHOUSE = teams[0]!; // Gudang Pusat (11) — Toko Melati's return warehouse
const CABANG = teams[3]!; // Gudang Cabang (14)
const MELATI = teams[1]!; // Toko Melati (12)
const ORDER = orders.find((o) => o.id === 101n)!; // 2 × KPH-M, 1 × KPP-L, 1 × TOP-01 — read in `return`

const KAOS = 1n; // Kaos Polos Hitam — M × 2
const PUTIH = 2n; // Kaos Polos Putih — L × 1
const TOPI = 3n; // Topi Rajut × 1

const A_01_1 = 41n;
const A_01_2 = 42n;
const B_02_1 = 43n;

const AtAccept = routedPage(
  [
    { path: RETURN_ACCEPT_PATH, element: <OrderReturnAcceptPage /> },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  `/warehouse-orders/${ORDER.id}/accept-return`,
);

// Receive a Return opens the page — the pick queue and the page under one router, so the navigation is real. The pick
// page is the second way in (the order detail is the third: pages/order-detail's stories).
const AtQueue = routedPage(
  [
    { path: "/warehouse-orders", element: <PickQueuePage /> },
    { path: RETURN_ACCEPT_PATH, element: <OrderReturnAcceptPage /> },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  "/warehouse-orders",
);

const AtPickOrder = routedPage(
  [
    { path: "/warehouse-orders/:orderId", element: <PickOrderPage /> },
    { path: RETURN_ACCEPT_PATH, element: <OrderReturnAcceptPage /> },
  ],
  `/warehouse-orders/${ORDER.id}`,
);

const meta = {
  title: "Pages/Warehouse/OrderReturnAccept",
  component: AtAccept,
  parameters: { signedIn: true, dataRouter: true, docs: { description: { component: description } } },
  beforeEach: [asTeam(WAREHOUSE.id), withOrdersInReturn(ORDER.id)],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("return-accept-page", {}, { timeout: 4000 });
  return canvas;
}

async function lineOf(canvasElement: HTMLElement, itemId: bigint) {
  const canvas = await loaded(canvasElement);
  return within(await canvas.findByTestId(`return-accept-line-${itemId}`, {}, { timeout: 4000 }));
}

// A controlled field drops characters at machine speed — type with a delay.
async function typeInto(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  if (value !== "") await userEvent.type(el, value, { delay: 40 });
}

// RackSelect renders inline (no portal), so its options are found inside the row.
async function pickRack(canvasElement: HTMLElement, itemId: bigint, index: number, rackId: bigint) {
  const line = await lineOf(canvasElement, itemId);
  const field = within(line.getByTestId(`return-accept-rack-${itemId}-${index}`));

  await userEvent.click(field.getByTestId("rack-select"));
  const option = await field.findByTestId(`rack-select-option-${rackId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
  await waitFor(() => expect(field.getByTestId("rack-select")).not.toHaveTextContent(/select a rack/i));
}

async function submitButton(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  return canvas.getByTestId("return-accept-submit");
}

async function accept(canvasElement: HTMLElement) {
  await userEvent.click(await submitButton(canvasElement));
  const confirm = await screen.findByTestId("confirm-action");
  await waitFor(() => expect(confirm).toBeVisible());
  await userEvent.click(confirm);
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/**
 * A WHOLE PARCEL, nothing typed — the common case. Every line reads sound at its ordered quantity and asks for a rack;
 * Accept waits until each has one.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("return-accept-title")).toHaveTextContent("Accept Return #101");

    const kaos = await lineOf(canvasElement, KAOS);
    await expect(kaos.getByText("Kaos Polos Hitam — M")).toBeInTheDocument();
    await expect(kaos.getByTestId(`return-accept-ordered-${KAOS}`)).toHaveTextContent("Ordered 2");
    await expect(kaos.getByTestId(`return-accept-sound-${KAOS}`)).toHaveTextContent("2");
    await expect(kaos.getByTestId(`return-accept-unbalanced-${KAOS}`)).toHaveTextContent("Choose a rack");
    // The first row follows the sound units: the 2 are already in it, only the rack is asked.
    await expect(kaos.getByTestId(`return-accept-rack-qty-${KAOS}-0`)).toHaveValue("2");

    await expect(canvas.getByTestId("return-accept-summary-shelf")).toHaveTextContent("4");
    await expect(canvas.getByTestId("return-accept-summary-borne")).toHaveTextContent("Every unit is sound");
    await expect(canvas.getByTestId("return-accept-progress")).toHaveTextContent("3 lines to finish");
    await expect(await submitButton(canvasElement)).toBeDisabled();
  },
};

/** THE PHONE — the one-row header with Accept as its icon, the progress under it, each line a block. */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await lineOf(canvasElement, KAOS);
    await expect(await submitButton(canvasElement)).toBeDisabled();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** A WHOLE PARCEL GOES ON THE SHELF: a rack per line, Accept, and the request carries the racks and no door rows. */
export const AWholeParcelGoesOnTheShelf: Story = {
  play: async ({ canvasElement }) => {
    await pickRack(canvasElement, KAOS, 0, A_01_1);
    await pickRack(canvasElement, PUTIH, 0, A_01_2);
    await pickRack(canvasElement, TOPI, 0, B_02_1);

    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("return-accept-ready")).toBeInTheDocument());
    await expect(canvas.getByTestId("return-accept-summary-racks")).toHaveTextContent("A-01-1 × 2 · A-01-2 × 1 · B-02-1 × 1");

    await accept(canvasElement);

    await waitFor(() => expect(returnAcceptScenario.last).toBeDefined());
    await expect(returnAcceptScenario.last).toEqual({
      teamId: WAREHOUSE.id,
      orderId: ORDER.id,
      lines: [
        { orderItemId: KAOS, broken: 0, missing: 0, note: "", placements: [{ rackId: A_01_1, quantity: 2 }] },
        { orderItemId: PUTIH, broken: 0, missing: 0, note: "", placements: [{ rackId: A_01_2, quantity: 1 }] },
        { orderItemId: TOPI, broken: 0, missing: 0, note: "", placements: [{ rackId: B_02_1, quantity: 1 }] },
      ],
      courierCharge: 0,
      courierChargeNote: "",
    });

    // Accepted, the order is `return_completed` for every live read too — and the page goes back to the order.
    await expect((await screen.findAllByText("Return accepted")).length).toBeGreaterThan(0);
    await expect(returnAcceptScenario.accepted).toContain(ORDER.id);
    await waitFor(() => expect(within(canvasElement).getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

/**
 * A SHORT AND BROKEN PARCEL (a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door):
 * one Kaos torn, the Putih not in the box. The torn one is thrown away, the Putih is missing, and both are the selling
 * team's — named on the order's note for customer service. Only the sound units are racked.
 */
export const AShortAndBrokenParcel: Story = {
  play: async ({ canvasElement }) => {
    const kaos = await lineOf(canvasElement, KAOS);
    await typeInto(kaos.getByTestId(`return-accept-broken-${KAOS}`), "1");
    await waitFor(() => expect(kaos.getByTestId(`return-accept-sound-${KAOS}`)).toHaveTextContent("1"));
    await expect(kaos.getByTestId(`return-accept-thrown-${KAOS}`)).toHaveTextContent("1");

    const putih = await lineOf(canvasElement, PUTIH);
    await typeInto(putih.getByTestId(`return-accept-missing-${PUTIH}`), "1");
    await waitFor(() => expect(putih.getByTestId(`return-accept-sound-${PUTIH}`)).toHaveTextContent("0"));
    // Nothing sound on the line — nothing to rack, and nothing holding Accept.
    await expect(putih.getByTestId(`return-accept-nothing-to-place-${PUTIH}`)).toBeInTheDocument();
    await expect(putih.getByTestId(`return-accept-balanced-${PUTIH}`)).toHaveTextContent("Nothing to place");

    await pickRack(canvasElement, KAOS, 0, A_01_1);
    await pickRack(canvasElement, TOPI, 0, B_02_1);

    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("return-accept-summary-shelf")).toHaveTextContent("2");
    await expect(canvas.getByTestId("return-accept-summary-thrown")).toHaveTextContent("1");
    await expect(canvas.getByTestId("return-accept-summary-missing")).toHaveTextContent("1");
    await expect(canvas.getByTestId("return-accept-summary-borne")).toHaveTextContent(
      "2 units are borne by Toko Melati, not this warehouse",
    );
    await waitFor(() => expect(canvas.getByTestId("return-accept-ready")).toBeInTheDocument());

    await accept(canvasElement);

    await waitFor(() =>
      expect(returnAcceptScenario.last?.lines).toEqual([
        { orderItemId: KAOS, broken: 1, missing: 0, note: "", placements: [{ rackId: A_01_1, quantity: 1 }] },
        { orderItemId: PUTIH, broken: 0, missing: 1, note: "", placements: [] },
        { orderItemId: TOPI, broken: 0, missing: 0, note: "", placements: [{ rackId: B_02_1, quantity: 1 }] },
      ]),
    );
  },
};

/**
 * A BROKEN LINE TAKES A NOTE (a-return-door-row-carries-an-optional-note): a whole line has no note field; once something
 * is broken or missing it has one — optional, trimmed, sent with the line — and it goes again with the count.
 */
export const ABrokenLineTakesANote: Story = {
  play: async ({ canvasElement }) => {
    const kaos = await lineOf(canvasElement, KAOS);
    await expect(kaos.queryByTestId(`return-accept-note-${KAOS}`)).toBeNull();

    await typeInto(kaos.getByTestId(`return-accept-broken-${KAOS}`), "1");
    const note = await kaos.findByTestId(`return-accept-note-${KAOS}`);
    await userEvent.type(note, " sobek di jahitan ", { delay: 20 });

    // Missing on the Putih with no note — a blank note is fine.
    const putih = await lineOf(canvasElement, PUTIH);
    await typeInto(putih.getByTestId(`return-accept-missing-${PUTIH}`), "1");
    await expect(await putih.findByTestId(`return-accept-note-${PUTIH}`)).toHaveValue("");

    await pickRack(canvasElement, KAOS, 0, A_01_1);
    await pickRack(canvasElement, TOPI, 0, B_02_1);
    await accept(canvasElement);

    await waitFor(() =>
      expect(returnAcceptScenario.last?.lines.map((l) => [l.orderItemId, l.note])).toEqual([
        [KAOS, "sobek di jahitan"],
        [PUTIH, ""],
        [TOPI, ""],
      ]),
    );
  },
};

/** SOUND IS NEVER NEGATIVE: broken + missing above the line is said on it, its figures read —, and Accept holds. */
export const BrokenAndMissingNeverExceedTheLine: Story = {
  play: async ({ canvasElement }) => {
    const kaos = await lineOf(canvasElement, KAOS);
    await typeInto(kaos.getByTestId(`return-accept-missing-${KAOS}`), "2");
    await typeInto(kaos.getByTestId(`return-accept-broken-${KAOS}`), "1");

    await expect(await kaos.findByTestId(`return-accept-over-${KAOS}`)).toHaveTextContent("more than the 2 ordered");
    await expect(kaos.getByTestId(`return-accept-sound-${KAOS}`)).toHaveTextContent("—");
    await expect(kaos.getByTestId(`return-accept-unbalanced-${KAOS}`)).toHaveTextContent("Fix the count first");

    await pickRack(canvasElement, PUTIH, 0, A_01_2);
    await pickRack(canvasElement, TOPI, 0, B_02_1);
    await expect(await submitButton(canvasElement)).toBeDisabled();

    // Back to the line's size — the count is the line's again.
    await typeInto(kaos.getByTestId(`return-accept-broken-${KAOS}`), "0");
    await waitFor(() => expect(kaos.queryByTestId(`return-accept-over-${KAOS}`)).toBeNull());
    await expect(kaos.getByTestId(`return-accept-sound-${KAOS}`)).toHaveTextContent("0");
    await expect(await submitButton(canvasElement)).toBeEnabled();
  },
};

/** ACCEPT WAITS FOR EVERY RACK — two lines racked, the third not: held, and the header says how many are left. */
export const AcceptWaitsForEveryRack: Story = {
  play: async ({ canvasElement }) => {
    await pickRack(canvasElement, KAOS, 0, A_01_1);
    await pickRack(canvasElement, PUTIH, 0, A_01_2);

    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("return-accept-progress")).toHaveTextContent("1 line to finish");
    await expect(await submitButton(canvasElement)).toBeDisabled();

    await pickRack(canvasElement, TOPI, 0, B_02_1);
    await waitFor(() => expect(canvas.getByTestId("return-accept-ready")).toHaveTextContent("Every sound unit has a rack"));
    await expect(await submitButton(canvasElement)).toBeEnabled();
  },
};

/**
 * SPLIT ACROSS TWO RACKS, as Accept Delivery splits: the first row keeps the remainder, a second row takes its share.
 * The same rack twice holds the line until one is changed.
 */
export const ASplitAcrossTwoRacks: Story = {
  play: async ({ canvasElement }) => {
    const kaos = await lineOf(canvasElement, KAOS);
    await pickRack(canvasElement, KAOS, 0, A_01_1);

    await userEvent.click(kaos.getByTestId(`return-accept-add-rack-${KAOS}`));
    await typeInto(kaos.getByTestId(`return-accept-rack-qty-${KAOS}-1`), "1");
    await waitFor(() => expect(kaos.getByTestId(`return-accept-rack-qty-${KAOS}-0`)).toHaveValue("1"));

    await pickRack(canvasElement, KAOS, 1, A_01_1);
    await expect(kaos.getByTestId(`return-accept-unbalanced-${KAOS}`)).toHaveTextContent("A rack twice");

    await pickRack(canvasElement, KAOS, 1, B_02_1);
    await waitFor(() => expect(kaos.getByTestId(`return-accept-balanced-${KAOS}`)).toHaveTextContent("2 placed"));

    await pickRack(canvasElement, PUTIH, 0, A_01_2);
    await pickRack(canvasElement, TOPI, 0, B_02_1);
    await accept(canvasElement);

    await waitFor(() =>
      expect(returnAcceptScenario.last?.lines[0]).toEqual({
        orderItemId: KAOS,
        broken: 0,
        missing: 0,
        note: "",
        placements: [
          { rackId: A_01_1, quantity: 1 },
          { rackId: B_02_1, quantity: 1 },
        ],
      }),
    );
  },
};

/**
 * A BORROWED LINE SHOWS THE CODE TO PRINT (a-returned-borrowed-unit-is-relabelled-at-the-accept): the Kaos is Toko
 * Kenanga's product, coming back as Melati's own MLT-KAOS-01 — printed while the units are in hand, one label per SOUND
 * unit (a broken one is thrown away, a missing one is not here).
 */
export const ABorrowedLineShowsTheCodeToPrint: Story = {
  beforeEach: () => {
    returnAcceptScenario.labels = [
      {
        orderItemId: KAOS,
        borrowedProductId: 301n,
        borrowedProductCode: "KPH-M",
        ownProductId: 74n,
        ownProductCode: "MLT-KAOS-01",
        ownProductName: "Kaos Polos Hitam — M (Melati)",
        quantity: 2,
      },
    ];
  },
  play: async ({ canvasElement }) => {
    const kaos = await lineOf(canvasElement, KAOS);
    const relabel = kaos.getByTestId(`return-accept-relabel-${KAOS}`);
    await expect(relabel).toHaveTextContent("MLT-KAOS-01");
    await expect(relabel).toHaveTextContent("Kaos Polos Hitam — M (Melati)");
    await expect(kaos.getByTestId(`return-accept-relabel-count-${KAOS}`)).toHaveTextContent(
      "Print 2 labels and stick each over KPH-M",
    );
    // An own line has none.
    await expect((await lineOf(canvasElement, PUTIH)).queryByTestId(`return-accept-relabel-${PUTIH}`)).toBeNull();

    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("return-accept-summary-labels")).toHaveTextContent("2");

    await typeInto(kaos.getByTestId(`return-accept-broken-${KAOS}`), "1");
    await waitFor(() =>
      expect(kaos.getByTestId(`return-accept-relabel-count-${KAOS}`)).toHaveTextContent(
        "Print 1 label and stick it over KPH-M",
      ),
    );
    await expect(canvas.getByTestId("return-accept-summary-labels")).toHaveTextContent("1");
  },
};

/** THE COURIER'S ASK, AS TODAY (a-return-may-carry-the-couriers-ask): a charge with no note holds Accept; with one, both go. */
export const TheCourierAskNeedsWhatItWasFor: Story = {
  play: async ({ canvasElement }) => {
    await pickRack(canvasElement, KAOS, 0, A_01_1);
    await pickRack(canvasElement, PUTIH, 0, A_01_2);
    await pickRack(canvasElement, TOPI, 0, B_02_1);

    const canvas = await loaded(canvasElement);
    await userEvent.type(canvas.getByTestId("return-accept-charge"), "15000", { delay: 40 });
    await expect(await canvas.findByTestId("return-accept-charge-note-error")).toBeVisible();
    await expect(await submitButton(canvasElement)).toBeDisabled();

    await userEvent.type(canvas.getByTestId("return-accept-charge-note"), " ongkir retur J&T ", { delay: 20 });
    await waitFor(() => expect(canvas.queryByTestId("return-accept-charge-note-error")).toBeNull());

    await accept(canvasElement);
    await waitFor(() =>
      expect(returnAcceptScenario.last).toMatchObject({ courierCharge: 15_000, courierChargeNote: "ongkir retur J&T" }),
    );
  },
};

/**
 * NOT THE RETURN WAREHOUSE (only-the-return-warehouse-accepts-a-return): Toko Melati now returns to Gudang Cabang, and the
 * parcel came back to Gudang Pusat on an old label. Gudang Pusat is told where it goes — and has no Accept, no racks.
 */
export const TheWrongWarehouseIsRefused: Story = {
  beforeEach: withReturnWarehouse(MELATI.id, CABANG.id),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() =>
      expect(canvas.getByTestId("return-accept-refused-title")).toHaveTextContent("This return goes to Gudang Cabang"),
    );
    await expect(canvas.getByTestId("return-accept-refused")).toHaveTextContent("Only Toko Melati's return warehouse");
    await expect(canvas.queryByTestId("return-accept-submit")).toBeNull();
    await expect(canvas.queryByTestId(`return-accept-line-${KAOS}`)).toBeNull();
  },
};

/** …and its way on is the order itself — never an Accept. */
export const TheRefusalOpensTheOrder: Story = {
  beforeEach: withReturnWarehouse(MELATI.id, CABANG.id),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(await canvas.findByTestId("return-accept-open-order"));
    await waitFor(() => expect(within(canvasElement).getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

/** A TEAM WITH NO RETURN WAREHOUSE — nobody can accept it (create-refuses-a-team-with-no-return-warehouse keeps it rare). */
export const ATeamWithNoReturnWarehouse: Story = {
  beforeEach: withReturnWarehouse(MELATI.id, 0n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() =>
      expect(canvas.getByTestId("return-accept-refused-title")).toHaveTextContent("Toko Melati has no return warehouse"),
    );
    await expect(canvas.queryByTestId("return-accept-submit")).toBeNull();
  },
};

/** A REFUSED ACCEPT IS SAID — e.g. a stock count running here refuses the put-away; the order stays in `return`. */
export const AServerRefusalIsSaid: Story = {
  beforeEach: () => {
    returnAcceptScenario.refusal = "a stock count is running in this warehouse — racks are locked until it is posted";
  },
  play: async ({ canvasElement }) => {
    await pickRack(canvasElement, KAOS, 0, A_01_1);
    await pickRack(canvasElement, PUTIH, 0, A_01_2);
    await pickRack(canvasElement, TOPI, 0, B_02_1);
    await accept(canvasElement);

    const canvas = await loaded(canvasElement);
    await expect(await canvas.findByTestId("return-accept-submit-error")).toHaveTextContent("a stock count is running");
    await expect(returnAcceptScenario.inReturn).toContain(ORDER.id);
  },
};

// ── Where it opens from: Receive a Return ───────────────────────────────────────────────────────

/** Opens Receive a Return from the pick queue's header — an icon or the ⋯ menu's item, whichever this canvas has. */
async function openReceive(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("warehouse-orders-header", {}, { timeout: 4000 });

  const inline = canvas.queryByTestId("pick-queue-receive");
  if (inline) {
    await userEvent.click(inline);
  } else {
    await userEvent.click(canvas.getByTestId("warehouse-orders-actions"));
    const item = await screen.findByTestId("pick-queue-receive");
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);
  }

  const input = await screen.findByTestId("receive-return-input");
  await waitFor(() => expect(input).toBeVisible());
  return input;
}

/** RECEIVE A RETURN'S ACCEPT OPENS THE PAGE — the parcel found by its ref, Accept, the page; Back is the queue again. */
export const ReceiveOpensTheAcceptPage: Story = {
  render: () => <AtQueue />,
  play: async ({ canvasElement }) => {
    const input = await openReceive(canvasElement);
    await userEvent.type(input, `${ORDER.orderExternalRefId}{Enter}`, { delay: 10 });

    await userEvent.click(await screen.findByTestId(`receive-return-accept-${ORDER.id}`));

    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("return-accept-title")).toHaveTextContent("Accept Return #101");

    await userEvent.click(canvas.getByTestId("return-accept-back"));
    await canvas.findByTestId("warehouse-orders-header", {}, { timeout: 4000 });
  },
};

/** …and a return addressed to another building is shown with where it goes, and no Accept. */
export const ReceiveSaysWhereAnotherBuildingsGoes: Story = {
  render: () => <AtQueue />,
  beforeEach: withReturnWarehouse(MELATI.id, CABANG.id),
  play: async ({ canvasElement }) => {
    const input = await openReceive(canvasElement);
    await userEvent.type(input, `${ORDER.orderExternalRefId}{Enter}`, { delay: 10 });

    const elsewhere = await screen.findByTestId(`receive-return-elsewhere-${ORDER.id}`);
    await waitFor(() => expect(elsewhere).toHaveTextContent("This return goes to Gudang Cabang"));
    await expect(screen.queryByTestId(`receive-return-accept-${ORDER.id}`)).toBeNull();
  },
};

/** THE PICK PAGE'S ACCEPT RETURN OPENS THE PAGE — and its Back is the pick page again. */
export const ThePickPageOpensTheAcceptPage: Story = {
  render: () => <AtPickOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("pick-order-accept-return", {}, { timeout: 4000 }));

    await expect((await loaded(canvasElement)).getByTestId("return-accept-title")).toHaveTextContent("Accept Return #101");

    await userEvent.click(canvas.getByTestId("return-accept-back"));
    await canvas.findByTestId("pick-order-accept-return", {}, { timeout: 4000 });
  },
};
