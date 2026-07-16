import { ButtonGroup, IconButton, Icon, Pagination as ChakraPagination } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const description =
  "The shared COMPACT pager (#96): previous · page-of-total · next. One control on every list, so paging looks and behaves the same app-wide. Renders nothing when everything fits on one page.";

export interface PaginationProps {
  // Total number of items across all pages (not the page count).
  count: number;
  pageSize: number;
  // Current page, 1-based.
  page: number;
  onPageChange: (page: number) => void;
}

// Pagination is the ONE shared pager for the whole app (#96): a COMPACT previous / page-text / next,
// not numbered pages. It renders nothing when everything fits on one page, so callers can drop it in
// unconditionally. Icons are lucide via <Icon> (the app's icon system) rather than the react-icons
// in the issue's sample.
export function Pagination({ count, pageSize, page, onPageChange }: PaginationProps) {
  if (count <= pageSize) {
    return null;
  }

  return (
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
  );
}
