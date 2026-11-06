import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LABELS_META, printedPaperMm, sheet, typeMeasure } from "./kit";

// RESTOCK LABELS — the label set up in mm (the-label-is-set-up-in-mm): the paper, the labels on it, the padding, the
// text, a long name, the run, and that it is all remembered on the device. The page's stories are grouped by the part
// of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockLabels/Settings",
  ...LABELS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE PAPER IN MM — 50 × 30 typed, the printed page is 50 × 30.
export const PaperSize: Story = {
  name: "Paper size",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await typeMeasure(canvas.getByTestId("labels-paper-width"), "50");
    await typeMeasure(canvas.getByTestId("labels-paper-height"), "30");
    await waitFor(() => expect(printedPaperMm()).toEqual({ width: 50, height: 30 }));
  },
};

// ONE PAPER, ROWS × COLUMNS OF LABELS — 2 × 3 with a 2 mm gap: six labels a paper, so 27 labels take 5 papers.
export const RowsAndColumns: Story = {
  name: "Rows and columns",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await typeMeasure(canvas.getByTestId("labels-rows"), "2");
    await typeMeasure(canvas.getByTestId("labels-columns"), "3");
    await typeMeasure(canvas.getByTestId("labels-gap"), "2");

    await waitFor(() => expect(within(canvas.getByTestId("labels-paper-0")).getAllByTestId("label-sku")).toHaveLength(6));
    await expect(canvas.getByTestId("labels-paper-0").style.gap).toBe("2mm");
    await expect(canvas.getByTestId("labels-run")).toHaveTextContent("5 papers");
  },
};

// PADDING — the same all round, or each side its own.
export const Padding: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const label = () => canvas.getByTestId("labels-paper-0").querySelector<HTMLElement>(".print-label")!;

    // 2 mm all round by default.
    await expect(label().style.padding).toBe("2mm");
    await userEvent.click(canvas.getByTestId("labels-padding-sides"));
    await typeMeasure(canvas.getByTestId("labels-padding-left"), "3");
    await waitFor(() => expect(label().style.padding).toBe("2mm 2mm 2mm 3mm"));
  },
};

// THE TEXT — the date on (today, in the app's language); the SKU off; centred; not bold; condensed; each text its own size.
export const Text: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const first = () => within(canvas.getByTestId("labels-paper-0"));

    await userEvent.click(canvas.getByTestId("labels-show-date"));
    await waitFor(() => expect(first().getByTestId("label-date")).toHaveTextContent(/\w{3} \d{1,2}, \d{4}/));
    await userEvent.click(canvas.getByTestId("labels-show-sku"));
    await waitFor(() => expect(first().queryByTestId("label-sku")).toBeNull());

    await typeMeasure(canvas.getByTestId("labels-show-placement-size"), "9");
    await waitFor(() => expect(first().getByTestId("label-placement").style.fontSize).toBe("9pt"));

    await userEvent.click(canvas.getByTestId("labels-bold"));
    await userEvent.click(canvas.getByTestId("labels-center"));
    await userEvent.click(canvas.getByTestId("labels-condensed"));
    const cell = canvas.getByTestId("labels-paper-0").querySelector<HTMLElement>(".print-label")!;
    await waitFor(() => expect(cell.style.fontWeight).toBe("400"));
    await expect(cell.style.alignItems).toBe("center");
    await expect(cell.style.fontFamily).toContain("Arial Narrow");

    await typeMeasure(canvas.getByTestId("labels-qr-gap"), "3");
    await waitFor(() => expect(cell.style.gap).toBe("3mm"));
  },
};

// A LONG NAME IS CUT AFTER N LINES — 2 by default, 1 here.
export const NameLines: Story = {
  name: "Name lines",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const name = () => within(canvas.getByTestId("labels-paper-0")).getByTestId("label-name");

    await expect(name().style.webkitLineClamp).toBe("2");
    await typeMeasure(canvas.getByTestId("labels-name-lines"), "1");
    await waitFor(() => expect(name().style.webkitLineClamp).toBe("1"));
  },
};

// THE RUN — a limit of 10 labels: 3 pages; page 3 prints labels 21–27.
export const LimitAndPage: Story = {
  name: "Limit and page",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await typeMeasure(canvas.getByTestId("labels-limit"), "10");
    await waitFor(() => expect(canvas.getByTestId("labels-pages")).toHaveTextContent("of 3"));
    await expect(canvas.getByTestId("labels-run")).toHaveTextContent("labels 1–10 of 27");

    await typeMeasure(canvas.getByTestId("labels-run-page"), "3");
    await waitFor(() => expect(canvas.getByTestId("labels-run")).toHaveTextContent("labels 21–27 of 27 · 7 papers"));
    await expect(document.querySelectorAll("[data-testid='labels-print-root'] .label-paper")).toHaveLength(7);
  },
};

// REMEMBERED ON THIS DEVICE (the-label-settings-are-remembered) — a size typed is there on the next visit; Kembalikan
// Default puts every setting back.
export const Remembered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const stored = () => JSON.parse(window.localStorage.getItem("restock-labels.settings.v3") ?? "{}") as Record<string, unknown>;

    // An untouched page stores nothing — a default nobody changed follows the defaults.
    await expect(window.localStorage.getItem("restock-labels.settings.v3")).toBeNull();

    // Only what was changed is stored, at once.
    await typeMeasure(canvas.getByTestId("labels-paper-width"), "60");
    await waitFor(() => expect(stored()).toEqual({ paperWidth: 60 }));

    await userEvent.click(canvas.getByTestId("labels-reset"));
    await waitFor(() => expect(canvas.getByTestId("labels-paper-width")).toHaveValue("35"));
    await expect(printedPaperMm()).toEqual({ width: 35, height: 15 });
  },
};
