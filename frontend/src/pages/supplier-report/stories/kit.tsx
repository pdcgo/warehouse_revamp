import { within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { teams } from "../../../../.storybook/fixtures";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiah } from "../../../lib/money";
import { SupplierReportPage } from "../index";

// WHAT EVERY SUPPLIER-REPORT STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// THE SUPPLIER REPORT (the-figures-are-a-statistics-tab-and-a-supplier-report, the-figures-screens-are-accepted) —
// suppliers ranked by what was restocked from them, or by how much of it arrived broken, over a period. The stub serves
// supplier_service's figures from supplierFigureFixtures.ts. The last month holds:
//
//   supplier                     units  restocked     broken  rate
//   31 PT Sumber Makmur   Melati   137   Rp 4.400.000    6     4,4%
//   34 UD Makmur Jaya     Kenanga  212   Rp 3.000.000   10     4,7%
//   36 PT Tekstil Nusantara        25   Rp 1.250.000    0     0%    — under the 50-unit minimum
//   38 CV Lama Tutup  (DELETED)    20   Rp 1.000.000    0     0%    — under the minimum, figures kept
//   37 Linen House                  5   Rp    30.000    2     40%   — under the minimum
//   ──────────────────────────────────────────────────────────────
//   the window — 378 good, Rp 9.680.000 restocked, 3 short (Rp 80.000), 18 broken (Rp 365.000)

export const MELATI = teams.find((t) => t.id === 12n)!;

export const rp = (amount: bigint) => formatRupiah(amount).replace(/\s/g, " ");

const Routed = routedPage(
  [
    { path: "/inventories/suppliers/report", element: <SupplierReportPage /> },
    marker("/inventories/suppliers/:supplierId", "at-own-supplier"),
    marker("/inventories/suppliers/discover/:supplierId", "at-discover-supplier"),
  ],
  "/inventories/suppliers/report",
);

/** Everything in a file's meta but its title. */
export const SUPPLIER_REPORT_META = {
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(MELATI.id)();
    asRole(Role.SELLING_OWNER)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("supplier-report-table", {}, { timeout: 4000 });
  return canvas;
}

/** The supplier ids down the table, top to bottom. */
export function order(canvas: ReturnType<typeof within>): string[] {
  return within(canvas.getByTestId("supplier-report-table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.getAttribute("data-testid")!.replace("supplier-report-row-", ""));
}
