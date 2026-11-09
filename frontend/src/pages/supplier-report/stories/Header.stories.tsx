import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { supplierExportScenario } from "../../../../.storybook/supplierExportScenario";
import { MELATI, SUPPLIER_REPORT_META, loaded, order, rp } from "./kit";

// SUPPLIER REPORT — the title's row and its Export (a-report-export-is-the-whole-view-as-a-file), and the headline under
// it — every supplier together, Sales beside Restocked, and when the figures are as of. The page's stories are grouped by
// the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierReport/Header",
  ...SUPPLIER_REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE REPORT AS A FILE (a-report-export-is-the-whole-view-as-a-file) — Export on the title's row, its icon, no ⚠ any more
// (the-report-export-is-marked placed it). It asks for the WHOLE ranking as narrowed: the window, the search typed, and
// the order on screen — here by broken rate — and the file downloads as the stream ends.
export const ExportsTheWholeRankingAsNarrowed: Story = {
  name: "Export, as narrowed",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exportButton = canvas.getByTestId("supplier-report-export");
    await expect(exportButton).toHaveTextContent("Export");
    await expect(exportButton.querySelector("svg.lucide-download")).not.toBeNull();
    await expect(canvas.queryByTestId("not-implemented-export")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();

    await userEvent.click(canvas.getByTestId("supplier-report-rank-by-rate"));
    await userEvent.type(canvas.getByTestId("supplier-report-search"), "makmur", { delay: 40 });
    await waitFor(() => expect(order(canvas)).toEqual(["34", "31"]), { timeout: 4000 });

    await userEvent.click(exportButton);
    await waitFor(() => expect(supplierExportScenario.reports).toHaveLength(1));

    const call = supplierExportScenario.reports[0]!;
    await expect(call.teamId).toBe(MELATI.id);
    await expect(call.sort).toMatchObject({ metricId: "metrics/suppliers", field: "broken_rate" });
    await expect(call.filters.map((f) => f.f.case)).toEqual(["dateRangeFilter", "supplierKeywordFilter"]);
    await expect(call.filters[1]!.f.value).toMatchObject({ q: "makmur" });
    // Every supplier the search finds, not the page on screen.
    await expect(call.rows).toBe(2);
    await expect((await screen.findAllByText("Export ready — the file is downloading")).length).toBeGreaterThan(0);
  },
};

// the-admin-team-monitors-read-only — the admin team READING the report: the ranking, but no Export, which stores a file.
export const MonitoringOffersNoExport: Story = {
  name: "Monitoring, no Export",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("supplier-report-export")).toBeNull();
  },
};

// A PHONE'S HEADER IS ONE ROW (the-report-export-folds-on-a-phone, the-phone-header-is-one-row) — the title and the
// export's ICON on the title's row; one action, so no ⋯ (a-phone-header-action-is-an-icon). Wrapped under the subtitle,
// the button stood alone. Tapped, it exports the whole ranking, as the desktop's button does.
export const APhoneFoldsTheExport: Story = {
  name: "Phone · Export icon",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("supplier-report-menu")).toBeNull();
    const exportIcon = canvas.getByRole("button", { name: "Export" });
    await expect(exportIcon).toHaveAttribute("data-testid", "supplier-report-export");
    await expect(exportIcon).not.toHaveTextContent("Export");
    const title = canvas.getByRole("heading", { name: "Supplier Report" });
    await expect(Math.abs(exportIcon.getBoundingClientRect().top - title.getBoundingClientRect().top)).toBeLessThan(12);
    await expect(canvas.queryByTestId("not-implemented-export")).toBeNull();

    await userEvent.click(exportIcon);
    await waitFor(() => expect(supplierExportScenario.reports).toHaveLength(1));
    await expect(supplierExportScenario.reports[0]!.sort).toMatchObject({ field: "restock_valuation" });
  },
};

// The headline is every ranked supplier together — the window, not the page.
export const TheHeadlineIsEverySupplier: Story = {
  name: "Headline, every supplier",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("supplier-report-summary-restocked-value")).toHaveTextContent(rp(9_680_000n));
    await expect(canvas.getByTestId("supplier-report-summary-lost-value")).toHaveTextContent(rp(80_000n));
    await expect(canvas.getByTestId("supplier-report-summary-broken-value")).toHaveTextContent(rp(365_000n));
  },
};

// SALES SIT BESIDE RESTOCKED, as on the Statistik tab (sales-sit-beside-restocked) — a Penjualan card after Direstok and
// a Penjualan column after Direstok. REAL since 2026-11-07 (penjualan-is-the-selling-value-on-the-order-day), unmarked:
// the window sold 100 + 150 + 10 + 1 = 261 units for Rp 7.813.000; Sumber's row 100 for Rp 4.225.000.
export const SalesSitBesideRestocked: Story = {
  name: "Sales beside Restocked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId("supplier-report-summary-sales");
    await expect(within(card).queryByTestId("not-implemented-sales")).toBeNull();
    await expect(canvas.getByTestId("supplier-report-summary-sales-value")).toHaveTextContent(rp(7_813_000n));
    await expect(canvas.getByTestId("supplier-report-summary-sales-units")).toHaveTextContent("261 units");

    const headers = within(canvas.getByTestId("supplier-report-table")).getAllByRole("columnheader");
    const restocked = headers.findIndex((h) => h.textContent === "Restocked");
    await expect(headers[restocked + 1]).toHaveTextContent(/^Sales$/);

    const sumber = canvas.getByTestId("supplier-report-row-31");
    await expect(within(sumber).getByTestId("figure-sales")).toHaveTextContent(`100${rp(4_225_000n)}`);
  },
};

// AS OF WHEN (a-money-metric-says-as-of-when): the figures are a fold, never live, so the report says when its service
// last claimed an event — in Jakarta time, under the headline.
export const SaysAsOfWhen: Story = {
  name: "As of when",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("supplier-report-as-of")).toHaveTextContent("14:04 WIB");
  },
};
