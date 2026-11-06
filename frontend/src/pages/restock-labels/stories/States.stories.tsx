import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { At501, At502, AtTheOldAddress, LABELS_META, printedLabels, sheet } from "./kit";

// RESTOCK LABELS — the page as it opens otherwise: a restock still on its way, one at the door, a selling team, and the
// old address. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockLabels/States",
  ...LABELS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// An ongoing restock has no labels — only an arrived or accepted one does (labels-print-from-arrived); it says so, as
// Terima says a restock it cannot take, with the way to the restock, instead of asking the server for a refusal.
export const OngoingHasNoLabels: Story = {
  name: "Ongoing, no labels",
  render: () => <At501 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const alert = await canvas.findByTestId("labels-not-printable", {}, { timeout: 4000 });
    await expect(alert).toHaveTextContent("Restock #501 has no labels yet");
    await expect(canvas.queryByTestId("labels-sheet")).toBeNull();
    await userEvent.click(canvas.getByTestId("labels-open-restock"));
    await canvas.findByTestId("at-restock-detail");
  },
};

// AN ARRIVED RESTOCK PRINTS TOO, WITHOUT PLACEMENTS (owner: *"halaman ini juga bisa diakses status tiba, tapi tanpa
// penempatan harusnya"*, labels-print-from-arrived) — 502 is signed for and not counted: one label per line, as many as
// ordered (coffee 12, rice 5), no placement on any, the SKU alone in the QR; the page says why.
export const ArrivedPrintsWithoutPlacement: Story = {
  name: "Arrived, no placement",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-arrived-note")).toHaveTextContent("only Arrived");
    await expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("17 labels of 2 kinds");
    await expect(canvas.getByTestId("labels-item-0-where")).toHaveTextContent("Ordered 12 pcs");
    await expect(canvas.queryAllByTestId("label-placement")).toHaveLength(0);
    await expect(printedLabels()).toBe(17);
    await expect(canvas.queryByTestId("labels-excluded")).toBeNull();
  },
};

// Warehouse-only: a selling team does not print the shelf labels of somebody else's building.
export const ASellingTeamCannotPrint: Story = {
  name: "Selling team cannot print",
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("labels-not-warehouse", {}, { timeout: 4000 })).toBeVisible();
  },
};

// ONE ADDRESS (owner: *"pakai 1 alamat saja"*, the-labels-have-one-address) — the old `/inventories/restock/503/labels`
// lands on `/inventories/restock/labels?ids=503`, 503's labels.
export const TheOldAddressRedirects: Story = {
  name: "Old address redirects",
  render: () => <AtTheOldAddress />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=503");
    await expect(canvas.getByTestId("labels-heading")).toHaveTextContent("Labels · Restock #503");
    await expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("27 labels of 3 kinds");
  },
};
