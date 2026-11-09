import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  A_01_1,
  A_01_2,
  ACCEPT_META,
  B_02_1,
  COFFEE,
  PHOTO,
  RICE,
  count,
  countWhole,
  expectAccept,
  lineOf,
  loaded,
  place,
  typeInto,
} from "./kit";

// RESTOCK ACCEPT — a line's middle column: the two numbers typed, what they mean, and the broken units' note, photo and
// rack; a line's worth, filled by the system.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept/Count",
  ...ACCEPT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * a-short-unit-at-the-door-is-missing — MISSING IS WORKED OUT, never typed: 9 in a box of 12 is 3 missing, priced by
 * the system from the line (the-problem-price-is-filled-by-the-system). There is no picker for a kind of problem.
 */
export const MissingIsWorkedOutFromReceived: Story = {
  name: "Missing, worked out",
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    await count(canvasElement, id, "9");
    const line = await lineOf(canvasElement, id);

    await waitFor(() => expect(line.getByTestId(`accept-missing-${id}`)).toHaveTextContent("3"));
    await expect(line.getByTestId(`accept-good-${id}`)).toHaveTextContent("9");
    // The missing units get a block of their own, in the warning tone, apart from any broken
    // (the-broken-and-the-missing-are-blocks-of-their-own).
    const block = line.getByTestId(`accept-missing-block-${id}`);
    await expect(block).toHaveAttribute("data-tone", "warning");
    await expect(block).toHaveTextContent("3 pcs");
    await expect(line.queryByTestId(`accept-broken-block-${id}`)).toBeNull();
    // 3 × the landed price 34.215,69 (400.000 ÷ 12 + 15.000 ÷ 17), the same as a good unit (all-qty-is-every-unit-ordered).
    await expect(line.getByTestId(`accept-missing-value-${id}`)).toHaveTextContent("102.647");
    // The warehouse's optional word on the missing units appears beside them (three-notes-one-writer-each).
    await expect(line.getByTestId(`accept-missing-note-${id}`)).toBeInTheDocument();

    // No "broken / lost" picker, and no price field to type.
    await expect(line.queryByTestId(/accept-problem-type/)).toBeNull();
    await expect(line.queryByText(/^lost$/i)).toBeNull();
  },
};

/** accept-refuses-more-than-the-line-says — 13 in a box the line says 12 stops Accept and asks for the selling team. */
export const MoreThanOrderedBlocksAccept: Story = {
  name: "More than ordered",
  play: async ({ canvasElement }) => {
    await countWhole(canvasElement, RICE.productId, A_01_2);

    const id = COFFEE.productId;
    await count(canvasElement, id, "13");
    await place(canvasElement, id, 0, A_01_1);
    const line = await lineOf(canvasElement, id);

    await waitFor(() => expect(line.getByTestId(`accept-over-${id}`)).toBeInTheDocument());
    await expect(within(canvasElement).getByTestId(`accept-ready-line-missing-line-${id}`)).toHaveTextContent(
      "a count that fits · Kopi Arabika 250g",
    );
    await expectAccept(canvasElement, false);

    // The count goes back to what the line says — Accept presses.
    await typeInto(line.getByTestId(`accept-received-${id}`), "12");
    await waitFor(() => expect(line.queryByTestId(`accept-over-${id}`)).toBeNull());
    await expectAccept(canvasElement, true);
  },
};

/**
 * RUSAK IS OFF WHILE NOTHING IS RECEIVED (owner: *"rusak disabled kalau diterima 0"*, broken-waits-for-something-received)
 * — blank or 0 in Diterima, Rusak cannot be typed; something received, it opens; back to 0, it empties and shuts again.
 */
export const BrokenWaitsForSomethingReceived: Story = {
  name: "Broken off at 0",
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    const line = await lineOf(canvasElement, id);
    const broken = line.getByTestId(`accept-broken-${id}`);

    await expect(broken).toBeDisabled();
    await typeInto(line.getByTestId(`accept-received-${id}`), "0");
    await expect(broken).toBeDisabled();

    await typeInto(line.getByTestId(`accept-received-${id}`), "3");
    await waitFor(() => expect(broken).toBeEnabled());
    await typeInto(broken, "1");
    await expect(line.getByTestId(`accept-broken-count-${id}`)).toHaveTextContent("1");

    await typeInto(line.getByTestId(`accept-received-${id}`), "0");
    await waitFor(() => expect(broken).toBeDisabled());
    await expect(broken).toHaveValue("");
    await expect(line.queryByTestId(`accept-broken-error-${id}`)).toBeNull();
  },
};

/** any-warehouse-member-counts-what-arrived — broken units are among those that arrived: 5 of 3 is invalid. */
export const BrokenAboveReceivedIsInvalid: Story = {
  name: "Broken above received",
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
 * all-qty-is-every-unit-ordered — the costs are spread over every unit ORDERED, so the landed price does not move when
 * units arrive broken or short, and a broken or missing unit is worth exactly what a good one costs. Coffee 12 with 1
 * broken, rice 4 of 5: the coffee's broken unit is worth 34.215,69 (dividing by the 15 good units would make it 37.363,64).
 * And NO PRICE PER PIECE (the-accept-line-shows-no-price): the worth is the only money on a line.
 */
export const ProblemUnitsCarryTheLandedPrice: Story = {
  name: "Worth, at the landed price",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await count(canvasElement, COFFEE.productId, "12", "1");
    await count(canvasElement, RICE.productId, "4");

    await expect(canvas.queryByTestId(`accept-hpp-${COFFEE.productId}`)).toBeNull();
    await expect(canvas.queryByTestId(`accept-goods-${COFFEE.productId}`)).toBeNull();
    // 400.000 ÷ 12 + 15.000 ÷ 17 — every unit ordered, not the good ones.
    const coffee = await lineOf(canvasElement, COFFEE.productId);
    await expect(coffee.getByTestId(`accept-broken-value-${COFFEE.productId}`)).toHaveTextContent("34.215,686");

    // 325.000 ÷ 5 + 15.000 ÷ 17 — the missing unit carries the rice's landed price.
    const rice = await lineOf(canvasElement, RICE.productId);
    await expect(rice.getByTestId(`accept-missing-value-${RICE.productId}`)).toHaveTextContent("65.882");
  },
};

// A PROBLEM'S NOTE IS A LABELLED TEXTAREA WITH AN EXAMPLE (every-form-field-shows-an-example) and its count
// (a-limited-field-shows-its-count) — the label was its placeholder, gone the moment somebody typed; two rows, as the
// charge's note (owner: *"catatan pakai textarea"*).
export const TheBrokenNoteShowsAnExample: Story = {
  name: "Broken note",
  play: async ({ canvasElement }) => {
    const pid = COFFEE.productId;
    await count(canvasElement, pid, "12", "1");
    const line = await lineOf(canvasElement, pid);

    const note = line.getByTestId(`accept-broken-note-${pid}`);
    await expect(note.tagName).toBe("TEXTAREA");
    await expect(note).toHaveAttribute("rows", "2");
    await expect(note).toHaveAttribute("placeholder", "e.g. torn sack, spilled inside");
    await expect(line.getByText("Note on the broken units")).toBeVisible();
    await expect(line.getByTestId(`accept-broken-note-${pid}-count`)).toHaveTextContent("0/200");

    await typeInto(note, "Sobek");
    await expect(line.getByTestId(`accept-broken-note-${pid}-count`)).toHaveTextContent("5/200");
  },
};

// A BROKEN LINE TAKES A PHOTO (owner: *"foto maksudku untuk produk rusak"*, a-broken-product-carries-a-photo) — under the
// broken note, only once something is broken; optional, one per line, replaced or removed. Not kept yet: the page's mark
// is beside it and its strip at the top.
export const ABrokenLineTakesAPhoto: Story = {
  name: "Broken photo",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const pid = COFFEE.productId;
    const line = await lineOf(canvasElement, pid);

    await count(canvasElement, pid, "12");
    await expect(line.queryByTestId(`accept-broken-photo-${pid}`)).toBeNull();

    await typeInto(line.getByTestId(`accept-broken-${pid}`), "1");
    const photo = within(await line.findByTestId(`accept-broken-photo-${pid}`));
    await expect(photo.getByTestId(`accept-broken-photo-${pid}-pick`)).toHaveTextContent("Add Photo");
    // The page's first mark — the lines lead the page; the charge's two marks are in the info after them.
    await expect(photo.getByTestId("not-implemented-brokenPhoto")).toHaveTextContent("1");
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();

    await userEvent.upload(photo.getByTestId(`accept-broken-photo-${pid}-input`), PHOTO());
    await waitFor(() => expect(photo.getByTestId(`accept-broken-photo-${pid}-shown`)).toHaveTextContent("rusak.png"));
    await expect(photo.getByTestId(`accept-broken-photo-${pid}-pick`)).toHaveTextContent("Replace Photo");

    await userEvent.click(photo.getByTestId(`accept-broken-photo-${pid}-remove`));
    await waitFor(() => expect(photo.queryByTestId(`accept-broken-photo-${pid}-shown`)).toBeNull());
    await expect(photo.getByTestId(`accept-broken-photo-${pid}-pick`)).toHaveTextContent("Add Photo");
  },
};

// BROKEN UNITS GO TWO WAYS (owner: *"ditaruh rak itu opsional, jadi ada 2 pilihan"*, a-broken-product-may-go-on-a-rack) —
// thrown away, as before and by default, or onto a rack, which then must be chosen: Terima waits for it. The rack is
// picked in Taruh ke penempatan, as a row marked Rusak (owner: *"rusak kalau ditaruh di rak kasih ke penempatan dan tanda
// penempatan rusak"*, the-broken-units-rack-is-a-marked-placement), holding all the broken units; a rack the good units
// hold is off there. Not kept yet: the mark is on the rack choice, the page's second.
export const BrokenUnitsCanGoOnARack: Story = {
  name: "Broken onto a rack",
  play: async ({ canvasElement }) => {
    const pid = COFFEE.productId;

    await count(canvasElement, pid, "12", "1");
    await place(canvasElement, pid, 0, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);

    const line = await lineOf(canvasElement, pid);
    const to = within(line.getByTestId(`accept-broken-to-${pid}`));
    await expect(to.getByTestId(`accept-broken-to-discard-${pid}`)).toHaveAttribute("data-state", "checked");
    await expect(line.queryByTestId(`accept-placement-broken-${pid}`)).toBeNull();
    await expectAccept(canvasElement, true);

    await userEvent.click(to.getByTestId(`accept-broken-to-rack-${pid}`));
    await expect(to.getByTestId("not-implemented-brokenRack")).toHaveTextContent("2");
    await expect(to.getByTestId(`accept-broken-to-hint-${pid}`)).toHaveTextContent("Put away to placements");

    // The marked row in the put-away panel: Rusak, its rack, 1 pcs — and Terima waits for the rack.
    const row = within(await line.findByTestId(`accept-placement-broken-${pid}`));
    await expect(row.getByTestId(`accept-placement-broken-tag-${pid}`)).toHaveTextContent("Broken");
    await expect(row.getByTestId(`accept-placement-broken-qty-${pid}`)).toHaveTextContent("1 pcs");
    await expect(row.getByTestId(`accept-broken-place-error-${pid}`)).toBeVisible();
    await expect(within(canvasElement).getByTestId(`accept-ready-line-missing-line-${pid}`)).toHaveTextContent(
      "rack for the broken units · Kopi Arabika 250g",
    );
    await expectAccept(canvasElement, false);

    const field = within(row.getByTestId(`accept-broken-place-${pid}`));
    await userEvent.click(field.getByTestId("rack-select"));
    // A-01-1 holds the good units — off for the broken ones (one-rack-once-per-line).
    await expect(await field.findByTestId(`rack-select-option-${A_01_1}`)).toHaveAttribute("data-disabled");
    const option = await field.findByTestId(`rack-select-option-${B_02_1}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(row.queryByTestId(`accept-broken-place-error-${pid}`)).toBeNull());
    await expectAccept(canvasElement, true);

    // The choice goes against a business decision, and the page's strip says which
    // (a-conflict-with-a-business-decision-is-said-in-its-mark).
    await userEvent.click(within(canvasElement).getByTestId("not-implemented-toggle"));
    const conflict = await within(canvasElement).findByTestId("pending-row-brokenRack-conflict");
    await waitFor(() => expect(conflict).toBeVisible());
    await expect(conflict).toHaveTextContent("a broken unit is thrown away");
  },
};
