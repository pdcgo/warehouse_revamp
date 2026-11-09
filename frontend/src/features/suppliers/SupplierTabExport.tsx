import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Icon } from "@chakra-ui/react";
import { Download } from "lucide-react";

import { useIsMobile } from "../../layouts/shell";
import type { FileExportProgress } from "../../lib/useFileExport";

export const description =
  "A supplier page tab's Export — the table under it, as filtered: a grey outline with its download icon at the right end of the tab's filter strip, left of the tab's own primary action. On a phone it is a full-width button inside the Filter sheet — the strip's row already holds the search, Filter and that action. Pressed, it streams the file and reads its progress (Exporting 200 / 456) until the download starts; a tab whose rows are still invented (Produk) holds the place with the page's ⚠ mark and builds nothing.";

// ONE EXPORT PER TAB (owner, on the supplier page: *"di detail ada export untuk table di bawah, di taruh mana?"* — on the
// proposal: *"oke"*, `each-supplier-tab-exports-its-own-table`). In the tab's filter strip, not the page header: the
// header sits over three tabs and could not say which table it takes out; in the strip it is beside the table it takes,
// and what it takes is what the strip has narrowed — the search, the filters, the period and grain, the warehouse chip.
//
//   Toko       [Cari …] [Semua jenis toko ⌄]                    [⬇ Ekspor]  [+ Tambah Toko]
//   Produk     [Cari …] [Semua tim ⌄] [Semua toko ⌄]                       [⬇ Ekspor ⚠5]
//   Statistik  [Semua tim ⌄] [30 hari ⌄] [Harian|Bulanan|Tahunan]          [⬇ Ekspor]
//
// THE FILE IS THE TABLE (one-export-is-the-list-as-a-file): the tab's rows with its own filter, every page, its columns,
// .xlsx, streamed with progress, then a download. `onExport` starts it; `progress` is the stream's count while it runs.
// With no `onExport` the button only holds the place, its `mark` saying why (the Produk tab's rows are invented — a
// spreadsheet cannot carry the ⚠).
//
// ⚠ WHERE IT GOES IS THE CALLER'S: the strip's `actions` on a desktop, a CHILD of the FilterBar on a phone — which puts
// it in the Filter sheet. An icon beside the search, Filter and Tambah Toko squeezed the search to "Cari nar…".
export function SupplierTabExport({
  mark,
  testId,
  onExport,
  progress = null,
  disabled = false,
}: {
  /** The page's ⚠ mark, while the tab's file cannot be built. */
  mark?: ReactNode;
  testId: string;
  /** Starts the export; absent = nothing builds a file yet. */
  onExport?: () => void;
  /** The running export's count — null while none runs. */
  progress?: FileExportProgress | null;
  /** Nothing to ask yet (an invalid window). */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  return (
    <Button
      variant="outline"
      colorPalette="gray"
      w={isMobile ? "full" : undefined}
      data-testid={testId}
      disabled={disabled}
      loading={progress !== null}
      loadingText={progress ? t("common.export.running", { done: progress.done, total: progress.total }) : undefined}
      onClick={onExport}
    >
      <Icon as={Download} boxSize="4" />
      {t("suppliers.tabExport")}
      {mark}
    </Button>
  );
}
