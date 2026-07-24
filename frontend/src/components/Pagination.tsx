import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./ui/Button";
import { Select } from "./ui/Select";

export const description =
  "The shared pager (#96/#99): right-aligned, compact (previous · page-of-total · next), with an optional page-size selector (Select). One control on every list so paging looks and behaves the same app-wide.";

export interface PaginationProps {
  // Total number of items across all pages (not the page count).
  count: number;
  pageSize: number;
  // Current page, 1-based.
  page: number;
  onPageChange: (page: number) => void;
  // When both are given, a page-size selector is shown so the user can change the limit (#99).
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
}

// Pagination is the ONE shared pager for the whole app (#96/#99): right-aligned, a COMPACT previous /
// page-text / next (not numbered pages), optionally preceded by a page-size selector (Chakra's
// composable Select). Without a size selector it renders nothing when everything fits on one page, so
// callers can drop it in unconditionally. Icons are lucide via <Icon> (the app's icon system).
export function Pagination({
  count,
  pageSize,
  page,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
}: PaginationProps) {
  const { t } = useTranslation();
  const showSizePicker = !!(pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange);

  // Nothing to show for an empty list; and with no size picker, hide when it all fits on one page.
  if (count === 0 || (count <= pageSize && !showSizePicker)) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <div className="flex w-full items-center justify-end gap-4" data-testid="pagination-bar">
      {showSizePicker && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-fg-muted">{t("common.perPage")}</span>
          {/* Fixed-width wrapper so the (w-full) Select renders compact, the way the old size="xs"
              width="20" control did — without appending a conflicting width utility to the Select. */}
          <div className="w-20">
            <Select
              data-testid="page-size"
              aria-label={t("common.perPage")}
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
            >
              {pageSizeOptions?.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1" data-testid="pagination">
        <IconButton
          aria-label="Previous page"
          data-testid="page-prev"
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </IconButton>

        <span
          data-testid="page-text"
          className="min-w-16 text-center text-sm font-medium text-fg-muted"
        >
          {page} of {totalPages}
        </span>

        <IconButton
          aria-label="Next page"
          data-testid="page-next"
          size="sm"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
