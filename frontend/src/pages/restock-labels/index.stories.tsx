import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { type LoaderFunctionArgs, redirect } from "react-router-dom";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { labelsPath } from "../../features/restock/labelsPath";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockLabelsPage } from "./index";
import { clearSettings } from "./settings";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// The shelf labels for an ACCEPTED restock, printed by Gudang Pusat (11). 503 was counted in with 7 good rice on A-01-1
// and B-02-1 and 20 tea on A-01-2 — every good unit is on a placement (there-is-no-unplaced-pile), so every label
// carries a placement code, and the 3 broken or missing units have none. 27 labels a piece; 3 a placement.
//
// The settings are remembered on the device (the-label-settings-are-remembered) — every story starts from the defaults.

// `probe` puts the address's query beside the page — for a story that reads the restocks written to it. The labels have
// ONE address (the-labels-have-one-address); the old one redirects to it by a loader, as the app's router does.
function routes(probe = false) {
  const page = probe ? (
    <>
      <RestockLabelsPage />
      <LocationProbe />
    </>
  ) : (
    <RestockLabelsPage />
  );

  return [
    { path: "/inventories/restock/labels", element: page },
    {
      path: "/inventories/restock/:requestId/labels",
      loader: ({ params }: LoaderFunctionArgs) => redirect(labelsPath([params.requestId ?? ""])),
    },
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock", "at-restock-list"),
  ];
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const At503 = routedPage(routes(), "/inventories/restock/labels?ids=503");
const At501 = routedPage(routes(), "/inventories/restock/labels?ids=501");
const At502 = routedPage(routes(), "/inventories/restock/labels?ids=502");
const At503Probed = routedPage(routes(true), "/inventories/restock/labels?ids=503");
const At503And502 = routedPage(routes(true), "/inventories/restock/labels?ids=503,502");
const AtTheOldAddress = routedPage(routes(true), "/inventories/restock/503/labels");
const FromTheList = routedPage(routes(), {
  pathname: "/inventories/restock/labels",
  search: "?ids=503",
  state: { from: "/inventories/restock?status=accepted" },
});

const meta = {
  title: "Pages/Inventory/Restock/RestockLabels",
  component: At503,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    clearSettings();
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
    return () => clearSettings();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function sheet(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("labels-sheet", {}, { timeout: 4000 });
  return canvas;
}

/** A paper's size on the PRINTED page, in mm — read off the print root's first paper. */
function printedPaperMm(): { width: number; height: number } {
  const paper = document.querySelector<HTMLElement>("[data-testid='labels-print-root'] .label-paper")!;
  return { width: parseFloat(paper.style.width), height: parseFloat(paper.style.height) };
}

async function typeMeasure(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 30 });
  await userEvent.tab();
}

/**
 * 503, counted in — THE DEFAULTS (the-label-is-set-up-in-mm): a 35 × 15 mm paper, one label on it, no gap; the SKU, the
 * placement and the name on the label, bold, not centred; no date. And THE SCREEN RULES
 * (the-restock-labels-follow-the-screen-rules): back is its icon, Cetak carries its own — and is the one print button,
 * with no Unduh PDF beside it (cetak-is-the-one-print-button).
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-paper-width")).toHaveValue("35");
    await expect(canvas.getByTestId("labels-paper-height")).toHaveValue("15");
    await expect(canvas.getByTestId("labels-rows")).toHaveValue("1");
    await expect(canvas.getByTestId("labels-columns")).toHaveValue("1");
    await expect(canvas.getByTestId("labels-gap")).toHaveValue("0");
    await expect(printedPaperMm()).toEqual({ width: 35, height: 15 });

    const first = within(canvas.getByTestId("labels-paper-0"));
    await expect(first.getByTestId("label-sku")).toHaveTextContent("SKU-BERAS-5K");
    await expect(first.getByTestId("label-placement")).toHaveTextContent("A-01-1");
    await expect(first.getByTestId("label-name")).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(first.queryByTestId("label-date")).toBeNull();
    await expect(getComputedStyle(first.getByTestId("label-sku")).fontWeight).toBe("700");

    // THE PAGE IS SETTINGS, A PREVIEW AND WHAT PRINTS (the-label-page-is-settings-and-a-preview,
    // the-print-list-is-each-label-and-its-count) — one paper in the Pratinjau card, titled with its size; the labels in
    // Yang Dicetak.
    const preview = canvas.getByTestId("labels-preview");
    await expect(within(preview).getByTestId("labels-paper-0")).toBeInTheDocument();
    await expect(within(preview).getByTestId("labels-preview-size")).toHaveTextContent("paper 35 × 15 mm · 1 × 1 labels");
    await expect(within(canvas.getByTestId("labels-to-print")).getByTestId("labels-sheet")).toBeInTheDocument();

    await expect(canvas.getByTestId("labels-back")).toHaveTextContent("");
    await expect(canvas.getByTestId("labels-print").querySelector("svg")).not.toBeNull();
    await expect(canvas.queryByTestId("labels-download")).toBeNull();
    await expect(canvas.queryByText("Download PDF")).toBeNull();
    await expect(canvas.getByTestId("labels-run")).toHaveTextContent("labels 1–27 of 27 · 27 papers");
  },
};

// A PHONE (every-page-has-a-mobile-story) — the title's row is one row and Cetak is its icon, alone
// (a-phone-header-action-is-an-icon); the settings come before the preview; nothing runs past the screen's edge
// (nothing-runs-past-a-phones-edge).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    const print = canvas.getByTestId("labels-print");
    await expect(print).toHaveAccessibleName("Print");
    await expect(print).toHaveTextContent("");
    await expect(canvas.queryByTestId("labels-download")).toBeNull();
    const middle = (el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    await expect(Math.abs(middle(print) - middle(canvas.getByTestId("labels-back")))).toBeLessThan(4);
    await expect(
      canvas.getByTestId("labels-settings").compareDocumentPosition(canvas.getByTestId("labels-sheet")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

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

// there-is-no-unplaced-pile — one label per placement, each with its placement code; no holding pile. Per placement,
// each count starts at 1: three labels to print.
export const EveryLabelHasAPlacement: Story = {
  name: "Every label placed",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const list = within(canvas.getByTestId("labels-sheet"));

    await expect(list.getAllByTestId("label-placement").map((el) => el.textContent)).toEqual(["A-01-1", "B-02-1", "A-01-2"]);
    await userEvent.click(within(canvas.getByTestId("labels-mode")).getByText("Shelf"));
    await waitFor(() => expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("3 labels of 3 kinds"));
  },
};

/**
 * PRATINJAU ON TOP, THEN WHAT PRINTS (owner: *"kasih pratinjau di atas qrcodenya dan jumlahnya, bisa diedit jumlahnya,
 * semua qrcode yang sekarang bukan pratinjau jadi yang di print"*, the-print-list-is-each-label-and-its-count) — one
 * paper to look at; under it each label once, with its count: the rice on A-01-1 is 5 pieces, typed down to 2, so 24
 * labels print, and the printed run follows. Per placement starts every count over at 1.
 */
export const EditTheCount: Story = {
  name: "Edit the count",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const printed = () => document.querySelectorAll("[data-testid='labels-print-root'] .print-label").length;

    // The preview comes first — one paper.
    await expect(
      canvas.getByTestId("labels-preview").compareDocumentPosition(canvas.getByTestId("labels-to-print")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(within(canvas.getByTestId("labels-preview")).getAllByTestId("label-sku")).toHaveLength(1);

    // Each label once, its count from its units on the rack.
    await expect(canvas.getByTestId("labels-count-0")).toHaveValue("5");
    await expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("27 labels of 3 kinds");
    await expect(printed()).toBe(27);

    await typeMeasure(canvas.getByTestId("labels-count-0"), "2");
    await waitFor(() => expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("24 labels of 3 kinds"));
    await expect(printed()).toBe(24);
    await expect(canvas.getByTestId("labels-run")).toHaveTextContent("labels 1–24 of 24");

    // Per placement — every count back to 1.
    await userEvent.click(within(canvas.getByTestId("labels-mode")).getByText("Shelf"));
    await waitFor(() => expect(canvas.getByTestId("labels-count-0")).toHaveValue("1"));
    await expect(printed()).toBe(3);
  },
};

/**
 * CTRL+P IS OUR PRINT (owner: *"detect ctrl+P jadi cetak kita"*, ctrl-p-prints-the-labels) — the shortcut does what
 * Cetak does: the run's papers, through the print dialog. With every count at 0 there is nothing to print, and it says
 * so instead of sending a blank page.
 */
export const CtrlPPrintsTheLabels: Story = {
  name: "Ctrl+P prints",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const original = window.print;
    const print = fn();
    window.print = print;

    try {
      await expect(canvas.getByTestId("labels-print")).toHaveAttribute("title", "Print (Ctrl+P)");
      await userEvent.keyboard("{Control>}p{/Control}");
      await expect(print).toHaveBeenCalledTimes(1);

      // Every count to 0 — nothing to print: said, not printed.
      for (const i of [0, 1, 2]) await typeMeasure(canvas.getByTestId(`labels-count-${i}`), "0");
      await waitFor(() => expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("0 labels of 3 kinds"));
      await userEvent.keyboard("{Control>}p{/Control}");
      await expect(await screen.findByText("No labels to print — every count is 0.")).toBeInTheDocument();
      await expect(print).toHaveBeenCalledTimes(1);
    } finally {
      window.print = original;
    }
  },
};

// Broken and missing units never became stock, so they get no label — and the page says how many were left out.
export const BrokenAndMissingGetNoLabel: Story = {
  name: "Broken and missing, no label",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-excluded")).toHaveTextContent("3 units arrived broken or missing");
  },
};

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
    await expect(document.querySelectorAll("[data-testid='labels-print-root'] .print-label")).toHaveLength(17);
    await expect(canvas.queryByTestId("labels-excluded")).toBeNull();
  },
};

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
    await expect(document.querySelectorAll("[data-testid='labels-print-root'] .print-label")).toHaveLength(44);

    await userEvent.click(canvas.getByTestId("labels-restock-502-remove"));
    await waitFor(() => expect(canvas.queryByTestId("labels-restock-502")).toBeNull());
    await expect(canvas.getByTestId("labels-heading")).toHaveTextContent("Labels · Restock #503");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=503"));
    await expect(canvas.getByTestId("labels-restock-503-remove")).toBeDisabled();
    await expect(document.querySelectorAll("[data-testid='labels-print-root'] .print-label")).toHaveLength(27);
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

// ONE ADDRESS (owner: *"pakai 1 alamat saja"*, the-labels-have-one-address) — the old `/inventories/restock/503/labels`
// lands on `/inventories/restock/labels?ids=503`, 503's labels, and a restock added there stays on the same address.
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

// OPENED FROM THE LIST, BACK TO THE LIST (a-form-returns-where-it-was-opened) — the list with its filter.
export const FromTheListBackGoesToTheList: Story = {
  name: "From the list · back",
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await userEvent.click(canvas.getByTestId("labels-back"));
    await canvas.findByTestId("at-restock-list");
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
