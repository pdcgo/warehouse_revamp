import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { besideTheOpenSidebar } from "../../../../.storybook/pageStory";
import { restockAcceptScenario } from "../../../../.storybook/restockAcceptScenario";
import { dateInputToUnix, formatUnixDate } from "../../../lib/datetime";
import { addDays, jakartaToday } from "../../../lib/jakartaDay";
import { A_01_1, A_01_2, ACCEPT_META, COFFEE, RICE, acceptControl, count, countWhole, lineOf, loaded } from "./kit";

// THE WAREHOUSE TYPES THE EXPIRY AT THE ACCEPT (owner: *"A"*, the-warehouse-types-the-expiry-at-the-accept,
// docs/business/inventory/context_decision.md; accepted as shown, the-expiry-prototypes-are-accepted). Each product line
// has an OPTIONAL expiry date, read off the box by the person counting it — so it sits in *Yang tiba* (What arrived),
// under Diterima and Rusak. One date per line; a box mixing several printed dates takes the SOONEST (its hint says so).
// Once picked it reads as the batch screens read an expiry (an-expiry-says-how-long-is-left): *20 hari lagi* amber
// within 30 days, red once past, quiet beyond. × clears it. The confirm lists each line's date, or a dash.
//
// The accept SENDS it — `RestockRequestReceivedLine.expires_on`, recorded by the stub (`restockAcceptScenario`) — and
// the batch the line mints carries it. A line with no good unit mints no batch, so its date is not sent.
//
// A PAST DATE is allowed (the box says what it says); it reads red, and Terima still accepts.

const TODAY = jakartaToday();
const IN_20_DAYS = addDays(TODAY, 20);
const IN_90_DAYS = addDays(TODAY, 90);
const THREE_DAYS_AGO = addDays(TODAY, -3);

/** The 390px phone the line is judged at. */
const PHONE_VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
};

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept/Expiry",
  ...ACCEPT_META,
  parameters: { ...ACCEPT_META.parameters, viewport: { options: PHONE_VIEWPORTS } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── helpers, kept unexported (every named export is a story) ─────────────────────────────────────────────────────────

type Scope = ReturnType<typeof within>;

/** The line's expiry field, its picker and how long is left. */
function expiryOf(line: Scope, productId: bigint) {
  return {
    field: line.getByTestId(`accept-expiry-${productId}`),
    input: line.getByTestId(`accept-expiry-${productId}-input`),
    left: () => line.queryByTestId(`accept-expiry-${productId}-left`),
  };
}

/** Pick `day` in the line's calendar — month by month to it, by the date the cell carries (DatePicker stories). */
async function pickDay(canvasElement: HTMLElement, productId: bigint, day: string) {
  const line = await lineOf(canvasElement, productId);
  await userEvent.click(expiryOf(line, productId).input);
  const content = await screen.findByTestId(`accept-expiry-${productId}-input-content`);
  await waitFor(() => expect(content).toBeVisible());

  const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
  for (let step = 0; step < 6; step++) {
    const cell = Array.from(
      content.querySelectorAll<HTMLElement>(`[data-part="table-cell-trigger"][data-value="${day}"]`),
    ).find((el) => visible(el) && !el.hasAttribute("data-outside-range"));
    if (cell) {
      await userEvent.click(cell);
      break;
    }
    const towards = day > TODAY ? "next-trigger" : "prev-trigger";
    const move = Array.from(content.querySelectorAll<HTMLElement>(`[data-part="${towards}"]`)).find(visible);
    await expect(move).toBeDefined();
    await userEvent.click(move!);
  }

  await waitFor(() =>
    expect(expiryOf(line, productId).input).toHaveTextContent(formatUnixDate(dateInputToUnix(day, false))),
  );
}

async function confirmAccept(canvasElement: HTMLElement) {
  await userEvent.click(acceptControl(canvasElement));
  const confirm = await screen.findByTestId("confirm-action");
  await waitFor(() => expect(confirm).toBeVisible());
  await userEvent.click(confirm);
}

/** How long is left reads in its band — and in a colour of its own, not the text's. */
async function expectReading(line: Scope, productId: bigint, text: string, band: string) {
  const left = await waitFor(() => {
    const el = expiryOf(line, productId).left();
    expect(el).not.toBeNull();
    return el!;
  });
  await expect(left).toHaveTextContent(text);
  await expect(left).toHaveAttribute("data-band", band);
  return left;
}

// ── the stories ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * NO DATE — ACCEPTS AS TODAY. The field is there on every line, optional, empty, with its hint; nothing in the ready
 * line asks for it, and Terima accepts with no date — the batches mint with no expiry, as today.
 */
export const NoDate: Story = {
  name: "No date · accepts as today",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const coffee = await lineOf(canvasElement, COFFEE.productId);
    const { field, input, left } = expiryOf(coffee, COFFEE.productId);

    await expect(field).toHaveTextContent("Expiry date");
    await expect(field).toHaveTextContent("(optional)");
    await expect(field).toHaveTextContent("Several dates in the box? Pick the soonest.");
    await expect(input).toHaveTextContent("Choose a date");
    await expect(left()).toBeNull();
    // In What arrived, under the two counts — typed by the person counting.
    const counts = coffee.getByTestId(`accept-broken-${COFFEE.productId}`);
    await expect(counts.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    // Optional: the ready line never names it.
    await expect(canvas.getByTestId("accept-ready-line-ready")).toHaveTextContent("Ready to accept");

    await confirmAccept(canvasElement);
    await expect(await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();
    await expect(restockAcceptScenario.expiries).toEqual([{ [COFFEE.id.toString()]: "", [RICE.id.toString()]: "" }]);
  },
};

/** A DATE IN 20 DAYS — picked on the calendar; the picker shows the day, and beside it *20 days left*, in amber. */
export const In20Days: Story = {
  name: "In 20 days · amber",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    const coffee = await lineOf(canvasElement, COFFEE.productId);

    await pickDay(canvasElement, COFFEE.productId, IN_20_DAYS);
    const left = await expectReading(coffee, COFFEE.productId, "20 days left", "soon");
    await expect(getComputedStyle(left).color).not.toBe(getComputedStyle(expiryOf(coffee, COFFEE.productId).field).color);
    // One date per line: the rice is still empty.
    const rice = await lineOf(canvasElement, RICE.productId);
    await expect(expiryOf(rice, RICE.productId).input).toHaveTextContent("Choose a date");

    // THE ACCEPT SENDS IT — the coffee's day on its line, none on the rice's.
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    await confirmAccept(canvasElement);
    await expect(await within(canvasElement).findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();
    await expect(restockAcceptScenario.expiries).toEqual([{ [COFFEE.id.toString()]: IN_20_DAYS, [RICE.id.toString()]: "" }]);
  },
};

/** A DATE IN 90 DAYS — beyond the 30-day window: *90 days left*, quiet. */
export const In90Days: Story = {
  name: "In 90 days · quiet",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await pickDay(canvasElement, COFFEE.productId, IN_90_DAYS);
    const coffee = await lineOf(canvasElement, COFFEE.productId);
    await expect(expiryOf(coffee, COFFEE.productId).input).toHaveTextContent(
      formatUnixDate(dateInputToUnix(IN_90_DAYS, false)),
    );
    await expectReading(coffee, COFFEE.productId, "90 days left", "later");
  },
};

/**
 * A PAST DATE — allowed (the box says what it says): *expired 3 days ago*, red; Terima still accepts, and sends it.
 */
export const PastDate: Story = {
  name: "Past date · red, still accepts",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const coffee = await lineOf(canvasElement, COFFEE.productId);

    await pickDay(canvasElement, COFFEE.productId, THREE_DAYS_AGO);
    await expectReading(coffee, COFFEE.productId, "expired 3 days ago", "past");

    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    await confirmAccept(canvasElement);
    await expect(await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();
    await expect(restockAcceptScenario.expiries).toEqual([
      { [COFFEE.id.toString()]: THREE_DAYS_AGO, [RICE.id.toString()]: "" },
    ]);
  },
};

/** CLEARING — the picker's × takes the date away; the reading goes with it, and the line is back to no date. */
export const Clears: Story = {
  name: "Clears",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await pickDay(canvasElement, COFFEE.productId, IN_20_DAYS);
    const coffee = await lineOf(canvasElement, COFFEE.productId);
    await expectReading(coffee, COFFEE.productId, "20 days left", "soon");

    await userEvent.click(coffee.getByTestId(`accept-expiry-${COFFEE.productId}-input-clear`));
    await waitFor(() => expect(expiryOf(coffee, COFFEE.productId).input).toHaveTextContent("Choose a date"));
    await expect(expiryOf(coffee, COFFEE.productId).left()).toBeNull();
  },
};

/**
 * A PHONE (390px) — the line stacks; the field sits in What arrived under the counts, the picker and its reading on one
 * row, and nothing runs past the screen's edge.
 */
export const Phone: Story = {
  name: "Phone",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await pickDay(canvasElement, COFFEE.productId, IN_20_DAYS);
    const coffee = await lineOf(canvasElement, COFFEE.productId);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await expect(window.innerWidth).toBe(390);
    const card = canvasElement.querySelector<HTMLElement>(`[data-testid="accept-line-${COFFEE.productId}"]`)!;
    await expect(card).toHaveAttribute("data-layout", "stack");

    const { field, input } = expiryOf(coffee, COFFEE.productId);
    const left = await expectReading(coffee, COFFEE.productId, "20 days left", "soon");
    // The picker and how long is left share a row.
    const middle = (el: HTMLElement) => (el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2;
    await expect(Math.abs(middle(input) - middle(left))).toBeLessThan(6);
    // Inside the card, and the page never scrolls sideways.
    await expect(field.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right);
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/**
 * THE CONFIRM LISTS EACH LINE'S DATE — the coffee's day and how long is left, the rice's dash — under the figures and the
 * charge. Left open: the summary is what this story is about.
 */
export const Summary: Story = {
  name: "Summary · each line's date",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await pickDay(canvasElement, COFFEE.productId, IN_20_DAYS);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);

    await userEvent.click(acceptControl(canvasElement));
    const summary = await screen.findByTestId("accept-confirm-summary");
    await waitFor(() => expect(summary).toBeVisible());

    const list = within(summary).getByTestId("accept-confirm-expiry");
    await expect(list).toHaveTextContent("Expiry date");
    const coffee = within(list).getByTestId(`accept-confirm-expiry-${COFFEE.productId}`);
    await expect(coffee).toHaveTextContent("Kopi Arabika 250g");
    await expect(coffee).toHaveTextContent("20 days left");
    await expect(within(coffee).getByTestId(`accept-confirm-expiry-${COFFEE.productId}-day-left`)).toHaveAttribute(
      "data-band",
      "soon",
    );
    const rice = within(list).getByTestId(`accept-confirm-expiry-${RICE.productId}`);
    await expect(rice).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(within(rice).getByTestId(`accept-confirm-expiry-${RICE.productId}-day`)).toHaveTextContent("—");
    // The figures still come first (the-confirm-says-the-count).
    const good = within(summary).getByTestId("accept-confirm-good");
    await expect(good.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

/**
 * 1440 BESIDE THE OPEN SIDEBAR — the page area is ≈1141px, the lines' column ≈805 beside the 20rem info: each line in its
 * two-row arrangement, the expiry field inside What arrived, and nothing scrolls sideways.
 */
export const FitsBesideTheOpenSidebar: Story = {
  name: "1440 beside the sidebar · fits",
  globals: { viewport: { value: "desktop1440" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await pickDay(canvasElement, COFFEE.productId, IN_20_DAYS);
    const coffee = await lineOf(canvasElement, COFFEE.productId);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await expect(window.innerWidth).toBe(1440);
    await expectReading(coffee, COFFEE.productId, "20 days left", "soon");

    for (const id of [COFFEE.productId, RICE.productId]) {
      const card = canvasElement.querySelector<HTMLElement>(`[data-testid="accept-line-${id}"]`)!;
      await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
      const field = card.querySelector<HTMLElement>(`[data-testid="accept-expiry-${id}"]`)!;
      await expect(field.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right);
    }
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/**
 * NOTHING RECEIVED — the field stays open on a line whose box held none, but the date has no batch to land on: the
 * confirm reads a dash for it, and the accept does not send it.
 */
export const NothingReceivedSendsNoDate: Story = {
  name: "Nothing received · the date is not sent",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await pickDay(canvasElement, COFFEE.productId, IN_20_DAYS);
    await pickDay(canvasElement, RICE.productId, IN_90_DAYS);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await count(canvasElement, RICE.productId, "0");

    await userEvent.click(acceptControl(canvasElement));
    const summary = await screen.findByTestId("accept-confirm-summary");
    await waitFor(() => expect(summary).toBeVisible());
    const list = within(summary).getByTestId("accept-confirm-expiry");
    await expect(within(list).getByTestId(`accept-confirm-expiry-${COFFEE.productId}`)).toHaveTextContent("20 days left");
    await expect(within(list).getByTestId(`accept-confirm-expiry-${RICE.productId}-day`)).toHaveTextContent("—");

    await userEvent.click(screen.getByTestId("confirm-action"));
    await expect(await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();
    await expect(restockAcceptScenario.expiries).toEqual([{ [COFFEE.id.toString()]: IN_20_DAYS, [RICE.id.toString()]: "" }]);
  },
};
