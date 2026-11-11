import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { At503And502, At503Probed, AtFiftyTwo, LABELS_META, printedLabels, sheet, typeMeasure } from "./kit";

// RESTOCK LABELS — the Restok card: several restocks in one print, Tambah Restok, a restock's jump to its labels, and
// the one-by-one read that is marked (labels-print-several-restocks). The page's stories are grouped by the part of the
// screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockLabels/Restocks",
  ...LABELS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// SEVERAL RESTOCKS, ONE PRINT (owner: *"halaman labels bisa print banyak restock sekaligus"*,
// labels-print-several-restocks) — 503 counted in (27 labels a piece, its 3 broken or missing said) and 502 at the door
// (17, as ordered, no placement): one group each, in order, and the run is all 44. ✕ takes 502 off and the page is
// 503's again; the last restock cannot be taken off.
export const SeveralRestocks: Story = {
  name: "Several restocks",
  render: () => <At503And502 />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-heading")).toHaveTextContent("Labels · 2 Restocks");
    await expect(canvas.getByTestId("labels-restock-503-count")).toHaveTextContent("27 labels");
    await expect(canvas.getByTestId("labels-restock-502-count")).toHaveTextContent("17 labels");

    const accepted = within(canvas.getByTestId("labels-group-503"));
    const arrived = within(canvas.getByTestId("labels-group-502"));
    await expect(accepted.getByTestId("labels-excluded")).toBeVisible();
    await expect(accepted.queryByTestId("labels-arrived-note")).toBeNull();
    await expect(arrived.getByTestId("labels-arrived-note")).toBeVisible();
    await expect(arrived.queryAllByTestId("label-placement")).toHaveLength(0);

    await expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("44 labels of 5 kinds");
    await expect(printedLabels()).toBe(44);

    await userEvent.click(canvas.getByTestId("labels-restock-502-remove"));
    await waitFor(() => expect(canvas.queryByTestId("labels-restock-502")).toBeNull());
    await expect(canvas.getByTestId("labels-heading")).toHaveTextContent("Labels · Restock #503");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=503"));
    await expect(canvas.getByTestId("labels-restock-503-remove")).toBeDisabled();
    await expect(printedLabels()).toBe(27);
  },
};

// TAMBAH RESTOK — a search select of this warehouse's Tiba and Diterima restocks, newest first (507, 503, 502); 503 is
// already on the page, disabled; boxes on the road, lost or cancelled are not offered. A pick puts 502 on, the address
// follows, and the count typed for 503's first label stays — the page is not opened afresh. Typing narrows it: *teh*
// is on 507 and 503, not on 502.
export const AddARestock: Story = {
  name: "Add a restock",
  render: () => <At503Probed />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await typeMeasure(canvas.getByTestId("labels-count-0"), "3");
    await waitFor(() => expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("25 labels of 3 kinds"));

    const input = canvas.getByRole("combobox", { name: "Add a restock" });
    await userEvent.click(input);
    const option502 = await screen.findByTestId("labels-add-restock-option-502", {}, { timeout: 4000 });
    await waitFor(() => expect(option502).toBeVisible());
    await expect(screen.getByTestId("labels-add-restock-option-507")).toBeVisible();
    await expect(screen.getByTestId("labels-add-restock-option-503")).toHaveAttribute("data-disabled");
    for (const id of ["501", "504", "505", "506"]) {
      await expect(screen.queryByTestId(`labels-add-restock-option-${id}`)).toBeNull();
    }

    await userEvent.click(option502);
    await canvas.findByTestId("labels-restock-502", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("labels-restock-502-count")).toHaveTextContent("17 labels"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=503,502"));
    await expect(canvas.getByTestId("labels-heading")).toHaveTextContent("Labels · 2 Restocks");
    await expect(canvas.getByTestId("labels-count-0")).toHaveValue("3");
    await expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("42 labels of 5 kinds");

    // The box is empty again, ready for the next — and a search narrows it.
    const again = canvas.getByRole("combobox", { name: "Add a restock" });
    await expect(again).toHaveValue("");
    await userEvent.type(again, "teh", { delay: 40 });
    await screen.findByTestId("labels-add-restock-option-507", {}, { timeout: 4000 });
    await waitFor(() => expect(screen.queryByTestId("labels-add-restock-option-502")).toBeNull());
  },
};

// A RESTOCK TAKES YOU TO ITS LABELS (owner: *"restock navigasi ke labelnya"*, labels-a-restock-jumps-to-its-labels) —
// 502's row in the Restok card scrolls Yang Dicetak to 502's group, which blinks; the ✕ beside it is not part of it.
export const ARestockJumpsToItsLabels: Story = {
  name: "Restock jumps to its labels",
  render: () => <At503And502 />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("labels-restock-502-count")).toHaveTextContent("17 labels"));

    const jump = canvas.getByRole("button", { name: "Go to restock #502's labels" });
    await expect(jump).not.toContainElement(canvas.getByTestId("labels-restock-502-remove"));
    await userEvent.click(jump);
    await waitFor(() => expect(canvas.getByTestId("labels-group-502")).toHaveAttribute("data-flash"), { timeout: 2000 });
    await expect(canvas.getByTestId("labels-group-503")).not.toHaveAttribute("data-flash");

    // By the keyboard too.
    canvas.getByRole("button", { name: "Go to restock #503's labels" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(canvas.getByTestId("labels-group-503")).toHaveAttribute("data-flash"), { timeout: 2000 });
  },
};

// AT MOST 50 RESTOCKS A PRINT (at-most-fifty-restocks-a-print) — an address naming 52 holds the first 50; Tambah Restok
// is off and says why. (Past the seven fixtures the numbers name no restock, and their rows say so.)
export const AtMostFifty: Story = {
  name: "At most 50",
  render: () => <AtFiftyTwo />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-heading")).toHaveTextContent("Labels · 50 Restocks");
    await expect(canvas.getByTestId("labels-restock-942")).toBeInTheDocument();
    await expect(canvas.queryByTestId("labels-restock-943")).toBeNull();
    await expect(canvas.getByTestId("labels-restocks-full")).toHaveTextContent("At most 50 restocks a print");
    await expect(canvas.getByRole("combobox", { name: "Add a restock" })).toBeDisabled();
  },
};

// THE ONE-BY-ONE READ IS MARKED (owner: *"kasih unimplemented"*, an-interim-read-is-marked) — every restock is its own
// read until several can be read at once: the strip under the title says so, an interim read, and the Restok card
// carries its ⚠ 1.
export const TheOneByOneReadIsMarked: Story = {
  name: "One-by-one read, marked",
  render: () => <At503And502 />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toHaveTextContent("1 part of this screen is not implemented yet");
    await expect(within(canvas.getByTestId("labels-restocks")).getByTestId("not-implemented-byIds")).toHaveTextContent("1");
    await userEvent.click(canvas.getByTestId("not-implemented-toggle"));
    await waitFor(() => expect(canvas.getByTestId("pending-row-byIds")).toHaveTextContent("Restocks read one by one"));
    await expect(canvas.getByTestId("pending-row-byIds")).toHaveTextContent("interim read");
  },
};
