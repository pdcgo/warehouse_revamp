import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { restockFixture } from "../../../.storybook/restockFixtures";
import { restockRequestService } from "../../../.storybook/restockStub";
import { asRole } from "../../../.storybook/sessionScenario";
import { RestockProblemType, RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockAcceptPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock rewrite (docs/business/inventory/restock_decision.md).
//
// The warehouse counts the box in (any-warehouse-member-counts-what-arrived): per line it types what is in the box and
// how many of those are broken; good and missing are worked out; the good units go onto placements; the courier's
// charge at the door is one amount with a note. The stub plays the accept handler's rules (restockStub.ts).
//
// Gudang Pusat (11), as WAREHOUSE STAFF — any member of the warehouse counts. Restock 502 has ARRIVED and its coffee
// line was edited 10 → 12 by the selling team, with a note; 501 is still ONGOING; 503 is already ACCEPTED.
//
// ⚠ THE RUNNER'S CANVAS IS PHONE-WIDTH, so the Accept control is the ⋯ menu's item there and a button on a desktop.
// `acceptControl` finds whichever this canvas has.

const ARRIVED = restockFixture(502n);
const COFFEE = ARRIVED.items[0]!; // 12 ordered — "extra stock"
const RICE = ARRIVED.items[1]!; // 5 ordered

const A_01_1 = 41n;
const A_01_2 = 42n;
const B_02_1 = 43n;

function routedAt(requestId: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId/accept", element: <RestockAcceptPage /> },
      marker("/inventories/restock/:requestId", "at-restock-detail"),
    ],
    `/inventories/restock/${requestId}/accept`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const AtArrived = routedAt(502n);
const AtOngoing = routedAt(501n);
const AtAccepted = routedAt(503n);

const meta = {
  title: "Pages/Restock/RestockAccept",
  component: AtArrived,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-accept-page", {}, { timeout: 4000 });
  return canvas;
}

async function lineOf(canvasElement: HTMLElement, productId: bigint) {
  const canvas = await loaded(canvasElement);
  return within(await canvas.findByTestId(`accept-line-${productId}`, {}, { timeout: 4000 }));
}

// A controlled field drops characters at machine speed — type with a delay.
async function typeInto(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  if (value !== "") await userEvent.type(el, value, { delay: 40 });
}

async function count(canvasElement: HTMLElement, productId: bigint, received: string, broken?: string) {
  const line = await lineOf(canvasElement, productId);
  await typeInto(line.getByTestId(`accept-received-${productId}`), received);
  if (broken !== undefined) await typeInto(line.getByTestId(`accept-broken-${productId}`), broken);
}

// RackSelect renders inline (no portal), so its options are found inside the row.
async function place(canvasElement: HTMLElement, productId: bigint, index: number, placementId: bigint) {
  const line = await lineOf(canvasElement, productId);
  const field = within(line.getByTestId(`accept-placement-${productId}-${index}`));

  await userEvent.click(field.getByTestId("rack-select"));
  const option = await field.findByTestId(`rack-select-option-${placementId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
  await waitFor(() => expect(field.getByTestId("rack-select")).not.toHaveTextContent(/select a placement/i));
}

// Count a whole line as it should be: all arrived, nothing broken, onto one placement.
async function countWhole(canvasElement: HTMLElement, productId: bigint, placementId: bigint) {
  const line = await lineOf(canvasElement, productId);
  await userEvent.click(line.getByTestId(`accept-all-arrived-${productId}`));
  await place(canvasElement, productId, 0, placementId);
  await waitFor(() => expect(line.getByTestId(`accept-balanced-${productId}`)).toBeInTheDocument());
}

// The Accept control: a button on a desktop canvas, the ⋯ menu's item on a phone (the menu portals).
async function acceptControl(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const button = canvas.queryByTestId("accept-submit");
  if (button) return button;

  await userEvent.click(canvas.getByTestId("accept-actions"));
  const item = await screen.findByTestId("accept-submit");
  await waitFor(() => expect(item).toBeVisible());
  return item;
}

function blocked(el: HTMLElement) {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");
}

async function expectAccept(canvasElement: HTMLElement, enabled: boolean) {
  const el = await acceptControl(canvasElement);
  await waitFor(() => expect(blocked(el)).toBe(!enabled));

  if (el.getAttribute("role") === "menuitem") {
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(el).not.toBeVisible());
  }
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** 502, at the door: the coffee line says 12, and the selling team's note says why. */
export const ArrivedWithAnEditedLine: Story = {
  play: async ({ canvasElement }) => {
    const line = await lineOf(canvasElement, COFFEE.productId);

    // extra-units-are-added-by-the-selling-teams-edit — the counter sees why the line says 12, beside "ordered".
    await expect(line.getByTestId(`accept-ordered-${COFFEE.productId}`)).toHaveTextContent("12");
    await expect(line.getByTestId(`accept-line-note-${COFFEE.productId}`)).toHaveTextContent("extra stock");

    // Where it was bought — per line (a-line-names-the-channel-it-was-bought-from).
    await waitFor(() =>
      expect(line.getByTestId(`accept-supplier-${COFFEE.productId}`)).toHaveTextContent("CV Cahaya Abadi"),
    );
  },
};

/** 501, still on its way — a box that turns up before anybody signed for it can still be counted in. */
export const OngoingRestock: Story = {
  render: () => <AtOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // accept-locks-the-restock: ongoing is acceptable — the form is here, three lines, nothing counted yet.
    await expect(await canvas.findByTestId("accept-line-74")).toBeInTheDocument();
    await expect(canvas.getByTestId("accept-line-71")).toBeInTheDocument();
    await expect(canvas.getByTestId("accept-line-72")).toBeInTheDocument();
    await expect(canvas.queryByTestId("accept-not-acceptable")).toBeNull();
    await expectAccept(canvasElement, false);
  },
};

/** 503 is already accepted — accept-locks-the-restock refuses it, so the page says so instead of offering a count. */
export const AlreadyAcceptedIsNotAcceptable: Story = {
  render: () => <AtAccepted />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("accept-not-acceptable")).toBeInTheDocument();
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ACCEPTED}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId("accept-submit")).toBeNull();
    await expect(canvas.queryByTestId("accept-actions")).toBeNull();
    await expect(canvas.queryByTestId(/^accept-line-/)).toBeNull();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * a-short-unit-at-the-door-is-missing — MISSING IS WORKED OUT, never typed: 9 in a box of 12 is 3 missing, priced by
 * the system from the line (the-problem-price-is-filled-by-the-system). There is no picker for a kind of problem.
 */
export const MissingIsWorkedOutFromReceived: Story = {
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    await count(canvasElement, id, "9");
    const line = await lineOf(canvasElement, id);

    await waitFor(() => expect(line.getByTestId(`accept-missing-${id}`)).toHaveTextContent("3"));
    await expect(line.getByTestId(`accept-good-${id}`)).toHaveTextContent("9");
    // 400.000 × 3 ÷ 12
    await expect(line.getByTestId(`accept-missing-value-${id}`)).toHaveTextContent("100.000");
    // The warehouse's optional word on the missing units appears beside them (three-notes-one-writer-each).
    await expect(line.getByTestId(`accept-missing-note-${id}`)).toBeInTheDocument();

    // No "broken / lost" picker, and no price field to type.
    await expect(line.queryByTestId(/accept-problem-type/)).toBeNull();
    await expect(line.queryByText(/^lost$/i)).toBeNull();
  },
};

/** accept-refuses-more-than-the-line-says — 13 in a box the line says 12 stops Accept and asks for the selling team. */
export const MoreThanOrderedBlocksAccept: Story = {
  play: async ({ canvasElement }) => {
    await countWhole(canvasElement, RICE.productId, A_01_2);

    const id = COFFEE.productId;
    await count(canvasElement, id, "13");
    await place(canvasElement, id, 0, A_01_1);
    const line = await lineOf(canvasElement, id);

    await waitFor(() => expect(line.getByTestId(`accept-over-${id}`)).toBeInTheDocument());
    await expectAccept(canvasElement, false);

    // The count goes back to what the line says — Accept presses.
    await typeInto(line.getByTestId(`accept-received-${id}`), "12");
    await waitFor(() => expect(line.queryByTestId(`accept-over-${id}`)).toBeNull());
    await expectAccept(canvasElement, true);
  },
};

/** any-warehouse-member-counts-what-arrived — broken units are among those that arrived: 5 of 3 is invalid. */
export const BrokenAboveReceivedIsInvalid: Story = {
  play: async ({ canvasElement }) => {
    await countWhole(canvasElement, RICE.productId, A_01_2);

    const id = COFFEE.productId;
    await count(canvasElement, id, "3", "5");
    const line = await lineOf(canvasElement, id);

    await waitFor(() => expect(line.getByTestId(`accept-broken-error-${id}`)).toBeInTheDocument());
    await expect(line.getByTestId(`accept-good-${id}`)).toHaveTextContent("—");
    await expectAccept(canvasElement, false);
  },
};

/**
 * there-is-no-unplaced-pile — every good unit goes onto a placement, and the placements hold EXACTLY received −
 * broken. 12 with 2 broken is 10 good: 6 on one placement leaves 4 to place, and Accept waits for them.
 */
export const GoodUnitsMustBeFullyPlaced: Story = {
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    await count(canvasElement, id, "12", "2");
    await countWhole(canvasElement, RICE.productId, A_01_2);
    const line = await lineOf(canvasElement, id);

    // Counted, nothing placed yet.
    await expect(line.getByTestId(`accept-good-${id}`)).toHaveTextContent("10");
    // 400.000 × 2 ÷ 12, filled by the system.
    await expect(line.getByTestId(`accept-broken-value-${id}`)).toHaveTextContent("66.666");
    await expect(line.getByTestId(`accept-unbalanced-${id}`)).toBeInTheDocument();
    await expectAccept(canvasElement, false);

    // There is no "unplaced" choice in the picker.
    const field = within(line.getByTestId(`accept-placement-${id}-0`));
    await userEvent.click(field.getByTestId("rack-select"));
    // The real options render first, so the unplaced pile's absence is not just the list still loading.
    await field.findByTestId(`rack-select-option-${A_01_1}`);
    await expect(field.queryByTestId("rack-select-option-unplaced")).toBeNull();
    await userEvent.keyboard("{Escape}");

    // 6 onto A-01-1 — 4 still to place.
    await place(canvasElement, id, 0, A_01_1);
    await typeInto(line.getByTestId(`accept-placement-qty-${id}-0`), "6");
    await waitFor(() => expect(line.getByTestId(`accept-unbalanced-${id}`)).toHaveTextContent("4"));
    await expectAccept(canvasElement, false);

    // The other 4 onto B-02-1 — every good unit placed.
    await userEvent.click(line.getByTestId(`accept-add-placement-${id}`));
    await place(canvasElement, id, 1, B_02_1);
    await typeInto(line.getByTestId(`accept-placement-qty-${id}-1`), "4");
    await waitFor(() => expect(line.getByTestId(`accept-balanced-${id}`)).toBeInTheDocument());
    await expectAccept(canvasElement, true);
  },
};

/** the-courier-is-paid-once-per-restock — the charge's note is required once it is above 0. */
export const ACourierChargeNeedsANote: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    await expectAccept(canvasElement, true);

    await typeInto(canvas.getByTestId("accept-courier-charge"), "5000");
    await expect(await canvas.findByTestId("accept-courier-note-error")).toBeInTheDocument();
    await expectAccept(canvasElement, false);

    await typeInto(canvas.getByTestId("accept-courier-note"), "Biaya COD");
    await waitFor(() => expect(canvas.queryByTestId("accept-courier-note-error")).toBeNull());
    await expectAccept(canvasElement, true);
  },
};

/**
 * the-couriers-charge-stays-out-of-total — the charge is shown on its own line, owed by the selling team, and the total
 * stays goods + shipping. It is still in the unit price: the HPP moves (the-couriers-ask-is-in-the-unit-price).
 */
export const TheChargeStaysOutOfTheTotal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);

    // 400.000 + 325.000 + 15.000 shipping.
    await expect(canvas.getByTestId("accept-grand-total")).toHaveTextContent("740.000");
    // 400.000 ÷ 12 + 15.000 ÷ 17 good units.
    await expect(canvas.getByTestId(`accept-hpp-${COFFEE.productId}`)).toHaveTextContent("34.215");

    await typeInto(canvas.getByTestId("accept-courier-charge"), "5000");

    await waitFor(() => expect(canvas.getByTestId("accept-courier-owed")).toHaveTextContent("5.000"));
    await expect(canvas.getByTestId("accept-grand-total")).toHaveTextContent("740.000");
    // (15.000 + 5.000) ÷ 17 — the charge is in the unit price.
    await expect(canvas.getByTestId(`accept-hpp-${COFFEE.productId}`)).toHaveTextContent("34.509");
  },
};

/**
 * Accepting sends the count and lands on the restock. The stub keeps what the handler would: received 12 with 1
 * broken on coffee, the rice 1 short (missing, worked out), the charge and its note.
 */
export const AcceptingCountsTheBoxIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await count(canvasElement, COFFEE.productId, "12", "1");
    await typeInto(canvas.getByTestId(`accept-broken-note-${COFFEE.productId}`), "Bungkus sobek");
    await place(canvasElement, COFFEE.productId, 0, A_01_1);

    await count(canvasElement, RICE.productId, "4");
    await place(canvasElement, RICE.productId, 0, A_01_2);

    await typeInto(canvas.getByTestId("accept-courier-charge"), "5000");
    await typeInto(canvas.getByTestId("accept-courier-note"), "Biaya COD");

    await userEvent.click(await acceptControl(canvasElement));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expect(await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();

    const stored = (
      await restockRequestService.restockRequestDetail!({ teamId: 11n, requestId: 502n } as never, {} as never)
    ).request!;
    await expect(stored.status).toBe(RestockRequestStatus.ACCEPTED);
    await expect(stored.warehouseAdditionalCost).toBe(5000n);

    const coffee = stored.items!.find((l) => l.productId === COFFEE.productId)!;
    await expect(coffee.receivedCount).toBe(12n);
    await expect(coffee.placements).toEqual([{ placementId: A_01_1, quantity: 11n }]);
    await expect(coffee.problems!.find((p) => p.type === RestockProblemType.BROKEN)?.note).toBe("Bungkus sobek");

    const rice = stored.items!.find((l) => l.productId === RICE.productId)!;
    await expect(rice.problems!.find((p) => p.type === RestockProblemType.MISSING)?.count).toBe(1n);
  },
};

export const WithoutTheMarks: Story = {
  globals: { pendingMarks: "off" },
};
