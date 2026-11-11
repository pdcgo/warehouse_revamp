import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { ACCEPT_META, COFFEE, RICE, acceptControl, lineOf, loaded } from "./stories/kit";

// RESTOCK ACCEPT — the screen as it opens: Default and Mobile sit FIRST, straight under RestockAccept (owner: *"default
// dan mobile taruh di depan saja"*). The same title also holds the folders below. Its rules are grouped by the part of
// the screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Accept   Terima — what it waits for, what it sends, where it returns
//   Charge   the courier's COD charge — asked first, its note, its slip, out of the total
//   Count    a line's count — missing worked out, broken units, their note, photo and rack
//   PutAway  a line's good units onto placements
//   States   the restock in each other status, as it opens

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept",
  ...ACCEPT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 502 at the door — THE SCREEN RULES (the-restock-accept-follows-the-screen-rules): Terima carries its icon, and the one
 * line by it names the first thing still missing (a-save-button-says-what-it-waits-for). The coffee line says 12, and
 * the selling team's note says why (extra-units-are-added-by-the-selling-teams-edit).
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const line = await lineOf(canvasElement, COFFEE.productId);

    // Nothing counted: Terima is off, and the line by it says what to do first — the coffee's count — with the rice
    // one click away.
    const accept = acceptControl(canvasElement);
    await expect(accept).toHaveAccessibleName(/Accept Delivery/);
    await expect(accept.querySelector("svg")).not.toBeNull();

    // Back is its icon alone, its words its name (the-accept-page-puts-the-box-left-and-the-info-right).
    const back = canvas.getByTestId("accept-back");
    await expect(back).toHaveAccessibleName("Back to the Restock");
    await expect(back).toHaveTextContent("");

    // THE BOX FIRST: every line, then the info — beside them where there is room, under them here.
    const lines = canvas.getByTestId("accept-lines");
    const info = canvas.getByTestId("accept-info");
    await expect(lines.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expect(within(info).getByTestId("accept-courier")).toBeInTheDocument();

    // THE BOX'S COUNT IN ITS COLOUR (the-box-count-says-its-state-in-colour) — nothing counted yet: info.
    await expect(canvas.getByTestId("accept-restock-count")).toHaveAttribute("data-tone", "info");
    await expect(canvas.getByTestId("accept-restock-count-pcs")).toHaveTextContent("0 of 17 pcs");
    await expect(canvas.getByTestId("accept-restock-count")).toHaveTextContent("in the box");

    // THE ORDER ID, BY THAT NAME (terima-keeps-the-order-id) — never "Invoice".
    await expect(canvas.getByTestId("accept-invoice")).toHaveTextContent("INV/2026/10/0987");
    await expect(within(canvas.getByTestId("accept-info")).getByText("Order ID")).toBeVisible();
    await expect(within(canvas.getByTestId("accept-info")).queryByText("Invoice")).toBeNull();

    // WHO, SIMPLY (the-accept-info-is-who-the-parcel-and-the-ongkir-it-paid) — the team and the person by name, small,
    // no type badge and no username.
    await waitFor(() => expect(canvas.getByTestId("accept-team")).toHaveTextContent("Toko Melati"));
    await expect(within(canvas.getByTestId("accept-team")).queryByText("Selling")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("accept-created-by")).toHaveTextContent("Ani Rahayu"));
    await expect(canvas.getByTestId("accept-created-by")).not.toHaveTextContent("@");
    await expect(canvas.getByTestId(`accept-ready-line-missing-line-${COFFEE.productId}`)).toHaveTextContent(
      "received · Kopi Arabika 250g",
    );
    await expect(canvas.getByTestId("accept-ready-line-missing-more")).toHaveTextContent("+1 more");

    // extra-units-are-added-by-the-selling-teams-edit — the counter sees why the line says 12, beside "ordered". The
    // count is in pcs, and only the pcs is HIGHLIGHTED, at the text's size (the-pcs-alone-is-highlighted).
    await expect(line.getByTestId(`accept-ordered-${COFFEE.productId}`)).toHaveTextContent("Ordered");
    const pcs = line.getByTestId(`accept-ordered-${COFFEE.productId}-pcs`);
    await expect(pcs).toHaveTextContent("12 pcs");
    await expect(getComputedStyle(pcs).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await expect(parseFloat(getComputedStyle(pcs).fontSize)).toBeLessThanOrEqual(14);
    // An empty count shows its 0 — the placeholder, never the value (a-quantity-field-shows-its-minimum-until-typed).
    const received = line.getByTestId(`accept-received-${COFFEE.productId}`);
    await expect(received).toHaveAttribute("placeholder", "0");
    await expect(received).toHaveValue("");
    await expect(line.getByTestId(`accept-line-note-${COFFEE.productId}`)).toHaveTextContent("extra stock");

    // THE LINE READS ORDERED, THEN WHAT IT CAME TO (the-line-reads-ordered-then-what-it-came-to): no supplier; good,
    // broken and missing under Dipesan, in the product's column — not counted yet, each a dash.
    await expect(line.queryByTestId(`accept-supplier-${COFFEE.productId}`)).toBeNull();
    await expect(line.queryByText("CV Cahaya Abadi")).toBeNull();
    const outcome = line.getByTestId(`accept-outcome-${COFFEE.productId}`);
    await expect(within(outcome).getByTestId(`accept-good-${COFFEE.productId}`)).toHaveTextContent("—");
    await expect(within(outcome).getByTestId(`accept-missing-${COFFEE.productId}`)).toHaveTextContent("—");
    const orderedRow = line.getByTestId(`accept-ordered-${COFFEE.productId}`);
    await expect(orderedRow.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expect(canvas.getByTestId(`accept-line-${RICE.productId}`)).toBeInTheDocument();
  },
};

// A PHONE (every-page-has-a-mobile-story) — the header is ONE row: back, the title, the status, and Terima as its icon,
// not a ⋯ holding one item (the-phone-header-is-one-row, a-phone-header-action-is-an-icon); what Terima waits for comes
// down under it; nothing runs past the screen's edge (nothing-runs-past-a-phones-edge); a card pads 16px
// (a-phone-card-is-padded-less).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await lineOf(canvasElement, COFFEE.productId);

    const accept = acceptControl(canvasElement);
    await expect(accept).toHaveAccessibleName("Accept Delivery");
    await expect(canvas.queryByRole("button", { name: "Actions" })).toBeNull();
    // On the back arrow's row — their middles level, not a row of its own.
    const middle = (el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    await expect(Math.abs(middle(accept) - middle(canvas.getByTestId("accept-back")))).toBeLessThan(4);

    await expect(canvas.getByTestId("accept-ready-line-missing")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    // A phone's card pads 16px, not Chakra's 24px (a-phone-card-is-padded-less).
    const body = canvas.getByTestId(`accept-line-${COFFEE.productId}`).querySelector<HTMLElement>(".chakra-card__body")!;
    await expect(getComputedStyle(body).paddingLeft).toBe("16px");
  },
};
