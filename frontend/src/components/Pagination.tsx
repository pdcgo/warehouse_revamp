import {
  ButtonGroup,
  Flex,
  HStack,
  IconButton,
  Icon,
  NativeSelect,
  Pagination as ChakraPagination,
  Text,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export const description =
  "The shared pager (#96/#99): right-aligned, compact (previous · page-of-total · next), with an optional page-size selector. One control on every list so paging looks and behaves the same app-wide.";

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
// page-text / next (not numbered pages), optionally preceded by a page-size selector. Without a size
// selector it renders nothing when everything fits on one page, so callers can drop it in
// unconditionally. Icons are lucide via <Icon> (the app's icon system).
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

  return (
    <Flex justify="flex-end" align="center" gap="4" w="full" data-testid="pagination-bar">
      {showSizePicker && (
        <HStack gap="2">
          <Text fontSize="sm" color="fg.muted">
            {t("common.perPage")}
          </Text>
          <NativeSelect.Root size="xs" w="16">
            <NativeSelect.Field
              value={String(pageSize)}
              aria-label={t("common.perPage")}
              data-testid="page-size"
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
            >
              {pageSizeOptions?.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      )}

      <ChakraPagination.Root
        count={count}
        pageSize={pageSize}
        page={page}
        onPageChange={(e) => onPageChange(e.page)}
      >
        <ButtonGroup variant="ghost" size="sm" gap="1" alignItems="center" data-testid="pagination">
          <ChakraPagination.PrevTrigger asChild>
            <IconButton aria-label="Previous page" data-testid="page-prev">
              <Icon as={ChevronLeft} boxSize="4" />
            </IconButton>
          </ChakraPagination.PrevTrigger>

          <ChakraPagination.PageText
            data-testid="page-text"
            fontSize="sm"
            fontWeight="medium"
            color="fg.muted"
            minW="16"
            textAlign="center"
          />

          <ChakraPagination.NextTrigger asChild>
            <IconButton aria-label="Next page" data-testid="page-next">
              <Icon as={ChevronRight} boxSize="4" />
            </IconButton>
          </ChakraPagination.NextTrigger>
        </ButtonGroup>
      </ChakraPagination.Root>
    </Flex>
  );
}
