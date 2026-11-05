import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SUPPLIER_REPORT_META, loaded, rp } from "./kit";

// SUPPLIER REPORT — the title's row and its Export (the-report-export-is-marked), and the headline under it — every
// supplier together, Sales beside Restocked. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierReport/Header",
  ...SUPPLIER_REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// EXPORT IS ON THE TITLE'S ROW, NOT BUILT — its icon, and the ⚠ number pointing at the not-implemented list
// (the-report-export-is-marked).
export const ExportIsMarkedNotBuilt: Story = {
  name: "Export, marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exportButton = canvas.getByTestId("supplier-report-export");
    await expect(exportButton).toHaveTextContent("Export");
    await expect(exportButton.querySelector("svg.lucide-download")).not.toBeNull();
    await expect(within(exportButton).getByTestId("not-implemented-export")).toHaveTextContent("1");
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
  },
};

// A PHONE'S HEADER IS ONE ROW (the-report-export-folds-on-a-phone, the-phone-header-is-one-row) — the title and the
// export's ICON with its mark, on the title's row; one action, so no ⋯ (a-phone-header-action-is-an-icon). Wrapped under
// the subtitle, the button stood alone.
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
    await expect(within(exportIcon.parentElement!).getByTestId("not-implemented-export")).toHaveTextContent("1");
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
// a Penjualan column after Direstok; sample figures, marked 2 in THIS page's list (Ekspor is 1).
export const SalesSitBesideRestocked: Story = {
  name: "Sales beside Restocked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId("supplier-report-summary-sales");
    await expect(within(card).getByTestId("not-implemented-sales")).toHaveTextContent("2");

    const headers = within(canvas.getByTestId("supplier-report-table")).getAllByRole("columnheader");
    const restocked = headers.findIndex((h) => h.textContent === "Restocked");
    await expect(headers[restocked + 1]).toHaveTextContent(/^Sales/);
    await expect(within(headers[restocked + 1]!).getByTestId("not-implemented-sales")).toHaveTextContent("2");
  },
};
