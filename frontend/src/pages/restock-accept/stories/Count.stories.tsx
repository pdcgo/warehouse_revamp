import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  A_01_1,
  A_01_2,
  ACCEPT_META,
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

// RESTOCK ACCEPT — a line's middle column: the two numbers typed, what they mean, and the broken units' note and photo
// (no rack — a-restocks-broken-units-are-just-broken-for-now); a line's worth, filled by the system.
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
// broken note, only once something is broken; optional, one per line, replaced or removed. KEPT: picked, it is uploaded
// at once under this warehouse (the label photo's way), so it carries no pending mark any more.
export const ABrokenLineTakesAPhoto: Story = {
  name: "Broken photo",
  play: async ({ canvasElement }) => {
    const pid = COFFEE.productId;
    const line = await lineOf(canvasElement, pid);

    await count(canvasElement, pid, "12");
    await expect(line.queryByTestId(`accept-broken-photo-${pid}`)).toBeNull();

    await typeInto(line.getByTestId(`accept-broken-${pid}`), "1");
    const photo = within(await line.findByTestId(`accept-broken-photo-${pid}`));
    await expect(photo.getByTestId(`accept-broken-photo-${pid}-pick`)).toHaveTextContent("Add Photo");
    await expect(photo.queryByTestId("not-implemented-brokenPhoto")).toBeNull();

    await userEvent.upload(photo.getByTestId(`accept-broken-photo-${pid}-input`), PHOTO());
    await waitFor(() => expect(photo.getByTestId(`accept-broken-photo-${pid}-shown`)).toHaveTextContent("rusak.png"));
    // Uploaded: the stub's document came back, and the photo is the kept one.
    await waitFor(() => expect(photo.getByTestId(`accept-broken-photo-${pid}-shown`)).toHaveAttribute("data-state", "kept"));
    await expect(photo.getByTestId(`accept-broken-photo-${pid}-pick`)).toHaveTextContent("Replace Photo");

    await userEvent.click(photo.getByTestId(`accept-broken-photo-${pid}-remove`));
    await waitFor(() => expect(photo.queryByTestId(`accept-broken-photo-${pid}-shown`)).toBeNull());
    await expect(photo.getByTestId(`accept-broken-photo-${pid}-pick`)).toHaveTextContent("Add Photo");
  },
};

// BROKEN IS JUST BROKEN (owner: *"for now, broken is enough to be broken, no need placement where the broken good tracked
// and moved to rack"*, a-restocks-broken-units-are-just-broken-for-now) — the Rusak block holds the broken units' note
// and photo and asks nothing about where they go: no Dibuang / Ditaruh di rak, no rack, in the block or in Taruh ke
// penempatan. With every good unit placed the line is finished — Terima waits for no rack.
export const BrokenUnitsAreJustBroken: Story = {
  name: "Broken, no rack",
  play: async ({ canvasElement }) => {
    const pid = COFFEE.productId;
    await count(canvasElement, pid, "12", "1");
    const line = await lineOf(canvasElement, pid);

    // The block: its note and photo, nothing to choose.
    const block = within(await line.findByTestId(`accept-broken-block-${pid}`));
    await expect(block.getByTestId(`accept-broken-note-${pid}`)).toBeInTheDocument();
    await expect(block.getByTestId(`accept-broken-photo-${pid}`)).toBeInTheDocument();
    await expect(block.queryByRole("radio")).toBeNull();
    await expect(block.queryByText(/rack/i)).toBeNull();
    // …and no rack for them anywhere in the line — the put-away panel has the good units' row only.
    await expect(line.queryByTestId(/^accept-broken-(to|place)/)).toBeNull();
    await expect(line.queryByTestId(`accept-placement-broken-${pid}`)).toBeNull();

    // The 11 good units on A-01-1, the rice whole: the line is finished, and Terima is free.
    await place(canvasElement, pid, 0, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    await waitFor(() => expect(line.getByTestId(`accept-balanced-${pid}`)).toHaveTextContent("11 placed"));
    await expect(within(canvasElement).queryByTestId(`accept-ready-line-missing-line-${pid}`)).toBeNull();
    await expectAccept(canvasElement, true);
    // Nothing on the page is marked as not kept.
    await expect(within(canvasElement).queryByTestId("not-implemented-summary")).toBeNull();
  },
};
