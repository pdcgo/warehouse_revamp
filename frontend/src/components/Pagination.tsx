import { ButtonGroup, IconButton, Icon, Pagination as ChakraPagination } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  // Total number of items across all pages (not the page count).
  count: number;
  pageSize: number;
  // Current page, 1-based.
  page: number;
  onPageChange: (page: number) => void;
}

// Pagination is the shared pager (Chakra's composable Pagination): previous, numbered pages, next.
// It renders nothing when everything fits on one page, so callers can drop it in unconditionally.
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
      <ButtonGroup variant="ghost" size="xs" data-testid="pagination">
        <ChakraPagination.PrevTrigger asChild>
          <IconButton aria-label="Previous page" data-testid="page-prev">
            <Icon as={ChevronLeft} boxSize="4" />
          </IconButton>
        </ChakraPagination.PrevTrigger>

        <ChakraPagination.Items
          render={(item) => (
            <IconButton
              variant={{ base: "ghost", _selected: "solid" }}
              colorPalette="brand"
              data-testid={`page-${item.value}`}
            >
              {item.value}
            </IconButton>
          )}
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
