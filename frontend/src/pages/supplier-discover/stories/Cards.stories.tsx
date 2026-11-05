import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SUPPLIER_DISCOVER_META, SINAR, SUMBER, loaded } from "./kit";

// DISCOVER SUPPLIERS — a card — who, whose and where (a-discover-card-reads-who-whose-where), its contact and its
// figures (a-card-reads-its-figures-as-icons). The page's stories are grouped by the part of the screen they are
// about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers/Cards",
  ...SUPPLIER_DISCOVER_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A CARD says who the supplier is, whose it is and where it sells — and a store-less one says so in words.
export const ACardReadsTheRow: Story = {
  name: "Reads the row",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId(`discover-supplier-row-${SUMBER.id}`);
    await expect(card).toHaveTextContent(SUMBER.name);
    await expect(card).toHaveTextContent(SUMBER.address);
    await expect(card).toHaveTextContent("Toko Melati");
    await expect(card).toHaveTextContent("Shopee");
    await expect(card).toHaveTextContent(SUMBER.contact);

    await expect(canvas.getByTestId(`discover-supplier-row-${SINAR.id}`)).toHaveTextContent("No supplier stores yet");
  },
};

// THE CARD READS AS THE OWNER'S REFERENCE (a-discover-card-reads-who-whose-where): the name and where it is, a rule, whose
// it is and where it sells, then the contact with the ↗ at the bottom right — or words when there is no contact.
export const TheCardEndsWithItsContactAndAnArrow: Story = {
  name: "Contact and arrow last",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId(`discover-supplier-row-${SUMBER.id}`);
    const contact = within(card).getByTestId(`discover-card-contact-${SUMBER.id}`).getBoundingClientRect();
    const arrow = card.querySelector("svg.lucide-arrow-up-right")!.getBoundingClientRect();
    await expect(contact.top).toBeGreaterThan(within(card).getByTestId(`discover-card-address-${SUMBER.id}`).getBoundingClientRect().bottom);
    // The arrow closes the card, bottom right — on the figures' row, under the contact (a-card-reads-its-figures-as-icons).
    await expect(arrow.top).toBeGreaterThanOrEqual(contact.bottom);
    await expect(Math.abs(arrow.right - card.getBoundingClientRect().right)).toBeLessThan(32);

    await expect(canvas.getByTestId(`discover-card-contact-${SINAR.id}`)).toHaveTextContent("No contact yet");
  },
};

// A CARD CARRIES THE FIGURES AS ICONS, ONE ROW, UNDER THE CONTACT (a-card-reads-its-figures-as-icons) — a cart and a
// checked package, each with its units and its mark (1 and 2); no dates. A store-less supplier reads a dash for each,
// unmarked. The strip at the top names them.
export const ACardCarriesTheFigures: Story = {
  name: "Figures as icons",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    const row = canvas.getByTestId(`discover-card-figures-${SUMBER.id}`);
    const sold = within(row).getByTestId(`discover-card-figures-${SUMBER.id}-sold`);
    const ready = within(row).getByTestId(`discover-card-figures-${SUMBER.id}-ready`);
    await expect(sold.querySelector("svg.lucide-shopping-cart")).not.toBeNull();
    await expect(ready.querySelector("svg.lucide-package-check")).not.toBeNull();
    // A small pale badge each — the word only for a screen reader and on hover; no dates (a-card-figure-is-a-pale-badge).
    await expect(within(sold).getByTitle("Sold")).toBeVisible();
    await expect(within(ready).getByTitle("Ready")).toBeVisible();
    await expect(row).not.toHaveTextContent(/ordered|restocked/);
    await expect(within(sold).getByTestId("not-implemented-sold")).toHaveTextContent("1");
    await expect(within(ready).getByTestId("not-implemented-ready")).toHaveTextContent("2");
    // One row, under the contact.
    await expect(Math.abs(sold.getBoundingClientRect().top - ready.getBoundingClientRect().top)).toBeLessThan(2);
    const contact = canvas.getByTestId(`discover-card-contact-${SUMBER.id}`).getBoundingClientRect();
    await expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(contact.bottom);

    const none = canvas.getByTestId(`discover-card-figures-${SINAR.id}`);
    await expect(within(none).getByTestId(`discover-card-figures-${SINAR.id}-sold`)).toHaveTextContent("—");
    await expect(within(none).queryByTestId("not-implemented-sold")).toBeNull();
  },
};
