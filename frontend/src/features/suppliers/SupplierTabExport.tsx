import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Icon } from "@chakra-ui/react";
import { Download } from "lucide-react";

import { useIsMobile } from "../../layouts/shell";

export const description =
  "A supplier page tab's Export — the table under it, as filtered: a grey outline with its download icon at the right end of the tab's filter strip, left of the tab's own primary action. On a phone it is a full-width button inside the Filter sheet — the strip's row already holds the search, Filter and that action. Nothing builds a file yet, so it carries the page's ⚠ mark.";

// ONE EXPORT PER TAB (owner, on the supplier page: *"di detail ada export untuk table di bawah, di taruh mana?"* — on the
// proposal: *"oke"*, `each-supplier-tab-exports-its-own-table`). In the tab's filter strip, not the page header: the
// header sits over three tabs and could not say which table it takes out; in the strip it is beside the table it takes,
// and what it takes is what the strip has narrowed — the search, the filters, the period and grain, the warehouse chip.
//
//   Toko       [Cari …] [Semua jenis toko ⌄]                    [⬇ Ekspor ⚠7]  [+ Tambah Toko]
//   Produk     [Cari …] [Semua tim ⌄] [Semua toko ⌄]                          [⬇ Ekspor ⚠7]
//   Statistik  [Semua tim ⌄] [30 hari ⌄] [Harian|Bulanan|Tahunan]             [⬇ Ekspor ⚠7]
//
// The Supplier Report's Ekspor, the same way (the-report-export-is-marked) — a grey outline, its icon, the mark inside.
//
// ⚠ WHERE IT GOES IS THE CALLER'S: the strip's `actions` on a desktop, a CHILD of the FilterBar on a phone — which puts
// it in the Filter sheet. An icon beside the search, Filter and Tambah Toko squeezed the search to "Cari nar…".
export function SupplierTabExport({ mark, testId }: { mark: ReactNode; testId: string }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  return (
    <Button variant="outline" colorPalette="gray" w={isMobile ? "full" : undefined} data-testid={testId}>
      <Icon as={Download} boxSize="4" />
      {t("suppliers.tabExport")}
      {mark}
    </Button>
  );
}
