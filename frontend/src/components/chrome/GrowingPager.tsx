import { useEffect, useMemo, useState } from "react";
import {
  ButtonGroup,
  Flex,
  HStack,
  Icon,
  IconButton,
  Pagination as ChakraPagination,
  Select,
  Text,
  createListCollection,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export const description =
  "A pager for lists that know only whether ANOTHER page exists — no total. Every page already opened gets a number, so going back to any of them is one click; › at the end opens the next new page and the numbers grow (owner: `the-accounts-pager-grows-with-the-pages-opened`). The trail lives in the component, so a refresh or leaving the screen forgets it, and a `resetKey` change (a filter, a tab, a sort) starts it over. The current page is filled in the main tone. One page reads ‹ [1] › with both arrows off — it is always on screen, unless given the list's `total`: then on page 1 a list no longer than the smallest page size draws no pager at all. On a phone the buttons are centred and the per-page selector is not drawn. `compact` draws the current page alone, ‹ [2] › — a dialog's pager (`a-dialog-pager-is-one-number`).";

export interface GrowingPagerProps {
  /** The current page, 1-based. */
  page: number;
  onPageChange: (page: number) => void;
  /**
   * Whether a page AFTER `page` exists. `undefined` while it is not known yet — the next page still loading
   * behind the previous rows — and the trail is left as it is until it is.
   */
  hasNext: boolean | undefined;
  /** When this changes — a filter, a tab, a sort, the page size — the pages mean something else: start over. */
  resetKey: string;
  pageSize?: number;
  /** With both this and `onPageSizeChange`, a per-page selector sits on the left. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  /**
   * ONE NUMBER — the current page alone between the arrows, ‹ [2] ›, in the same boxes. For a list inside a dialog
   * (a-dialog-pager-is-one-number): a quick pass over a small window, where a trail of numbers is more than it needs.
   */
  compact?: boolean;
  /**
   * The list's TOTAL, when its read gives one. With it the pager STEPS ASIDE while it has nothing to do — on page 1, the
   * whole list no longer than the SMALLEST page size offered (`pageSizeOptions`, else `pageSize`): one page whatever the
   * size, so neither the numbers nor the size picker can change what is shown (owner, on a batch's page: *"sembunyikan
   * kalau pagenya page 1 dan itemnya tidak lebih dari samadengan yang terkecil di perpage"*,
   * the-batch-page-hides-a-pager-that-fits). Omit it and the pager is always on screen (the-pager-is-always-on-screen).
   */
  total?: number;
  testId?: string;
}

/**
 * Whether a pager told its `total` STEPS ASIDE — page 1, the whole list no longer than the smallest page size offered
 * (the-batch-page-hides-a-pager-that-fits). The pager asks it of itself; a page asks it too, to end its table bare.
 */
export function pagerStepsAside(args: {
  page: number;
  total: number | undefined;
  pageSize?: number;
  pageSizeOptions?: number[];
}): boolean {
  const { page, total, pageSize = 20, pageSizeOptions } = args;
  if (total === undefined || page !== 1) return false;
  const smallest = pageSizeOptions && pageSizeOptions.length > 0 ? Math.min(...pageSizeOptions) : pageSize;

  return total <= smallest;
}

/**
 * A TABLE WITH NO PAGER UNDER IT ENDS BARE — no rule under its last row (owner: *"tabel yang tidak ada paginasi, border
 * line paling bawah tidak perlu ada"*, the-batch-page-hides-a-pager-that-fits). The line closed the rows off from the
 * pager; with nothing under them it is a stray rule over the card's own edge. Spread on a `Table.Root`'s `css`.
 */
export const ENDS_BARE = { "& tbody tr:last-of-type td": { borderBottomWidth: "0" } } as const;

// THE PAGES OPENED SO FAR, AND WHETHER THE FURTHEST HAD MORE. Without a total, a page can only be reached by
// stepping onto it, so every page from 1 to the furthest one opened is known to exist — and one more, while
// the furthest still had a next. That count is all the numbers there are to show.
interface Trail {
  key: string;
  furthest: number;
  frontierHasNext: boolean;
}

export function GrowingPager({
  page,
  onPageChange,
  hasNext,
  resetKey,
  pageSize = 20,
  pageSizeOptions,
  onPageSizeChange,
  compact = false,
  total,
  testId = "growing-pager",
}: GrowingPagerProps) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<Trail>({ key: resetKey, furthest: page, frontierHasNext: !!hasNext });

  // A new question forgets the old pages — the render reads the reset trail at once, not one render late.
  const current = trail.key === resetKey ? trail : { key: resetKey, furthest: page, frontierHasNext: !!hasNext };

  useEffect(() => {
    setTrail((prev) => {
      const base = prev.key === resetKey ? prev : { key: resetKey, furthest: page, frontierHasNext: false };
      if (hasNext === undefined) return base;
      if (page > base.furthest) return { key: resetKey, furthest: page, frontierHasNext: hasNext };
      if (page === base.furthest && base.frontierHasNext !== hasNext) return { ...base, frontierHasNext: hasNext };
      return base;
    });
  }, [page, hasNext, resetKey]);

  const furthest = Math.max(current.furthest, page);
  // At the frontier, what this page says — and on a page just stepped onto and still loading, nothing is
  // promised past it yet, so no number appears and vanishes again.
  const frontierHasNext =
    page > current.furthest ? (hasNext ?? false) : page === current.furthest ? (hasNext ?? current.frontierHasNext) : current.frontierHasNext;
  const known = furthest + (frontierHasNext ? 1 : 0);

  const showSizePicker = !!(pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange);
  const sizeCollection = useMemo(
    () => createListCollection({ items: (pageSizeOptions ?? []).map((n) => ({ label: String(n), value: String(n) })) }),
    [pageSizeOptions],
  );

  // ONE ROW OF EQUAL BOXES (owner: *"kurang serasi antara page dan perpage"*) — the per-page selector and the page
  // buttons side by side on the right, all `xs` (32px), all outlined, one radius, one type size. They used to be a
  // 36px borderless row at one end and a 32px bordered box at the other, and read as two unrelated controls.
  //
  // ON A PHONE: the page buttons CENTRED, and no per-page selector (owner: *"tetap seperti yang sekarang saja, tapi
  // tengah, tetapi masalah di perpage dia memenuhi space"*, `a-phone-pager-is-centred-without-a-page-size`) — the
  // selector and its label filled the row and pushed the numbers to a second one; a phone keeps the list's page size.
  // The breakpoint is FilterBar's and the shells' (`md`).
  const phone = useBreakpointValue({ base: true, md: false }) ?? false;

  // The page you are on, in the main tone (a-chosen-option-is-in-the-main-tone) — its border too, so the filled box is
  // the same size as the outlined ones beside it.
  const onPage = { bg: "brand.solid", borderColor: "brand.solid", color: "brand.contrast", _hover: { bg: "brand.solid" } };

  // NOTHING TO DO, NOTHING DRAWN — given a total, page 1 holding the whole list at the smallest size offered. After every
  // hook, so the trail is kept while it is hidden.
  if (pagerStepsAside({ page, total, pageSize, pageSizeOptions })) return null;

  return (
    <Flex justify={phone ? "center" : "flex-end"} align="center" gap="3" wrap="wrap" w="full" data-testid={testId}>
      {showSizePicker && !phone && (
        <HStack gap="2">
          <Text fontSize="xs" color="fg.muted">
            {t("common.perPage")}
          </Text>
          <Select.Root
            collection={sizeCollection}
            size="xs"
            width="20"
            value={[String(pageSize)]}
            onValueChange={(e) => {
              const picked = e.value[0];
              if (picked !== undefined) onPageSizeChange?.(Number(picked));
            }}
          >
            <Select.HiddenSelect />
            <Select.Control>
              <Select.Trigger data-testid={`${testId}-size`} aria-label={t("common.perPage")}>
                <Select.ValueText />
              </Select.Trigger>
              <Select.IndicatorGroup>
                <Select.Indicator />
              </Select.IndicatorGroup>
            </Select.Control>
            <Select.Positioner>
              <Select.Content>
                {sizeCollection.items.map((item) => (
                  <Select.Item item={item} key={item.value}>
                    <Select.ItemText>{item.label}</Select.ItemText>
                    <Select.ItemIndicator />
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Positioner>
          </Select.Root>
        </HStack>
      )}

      {/* Chakra's own pager over the pages KNOWN so far — its ellipsis keeps a long trail to "1 … 7 [8] 9 … 15", and
          its › switches off on the last known number, which is the end of the data once the furthest had no next. */}
      <ChakraPagination.Root
        count={known * pageSize}
        pageSize={pageSize}
        page={page}
        siblingCount={1}
        onPageChange={(e) => onPageChange(e.page)}
      >
        <ButtonGroup variant="outline" size="xs" gap="1" alignItems="center">
          <ChakraPagination.PrevTrigger asChild>
            <IconButton aria-label={t("common.previousPage")} data-testid={`${testId}-prev`}>
              <Icon as={ChevronLeft} boxSize="4" />
            </IconButton>
          </ChakraPagination.PrevTrigger>

          {compact ? (
            // Not a button to press — the page you are on, said in the box the trail would fill.
            <IconButton as="span" aria-current="page" pointerEvents="none" data-testid={`${testId}-page-${page}`} {...onPage}>
              {page}
            </IconButton>
          ) : (
            <ChakraPagination.Items
              render={(item) => (
                <IconButton
                  aria-label={t("common.goToPage", { page: item.value })}
                  data-testid={`${testId}-page-${item.value}`}
                  _selected={onPage}
                >
                  {item.value}
                </IconButton>
              )}
            />
          )}

          <ChakraPagination.NextTrigger asChild>
            <IconButton aria-label={t("common.nextPage")} data-testid={`${testId}-next`}>
              <Icon as={ChevronRight} boxSize="4" />
            </IconButton>
          </ChakraPagination.NextTrigger>
        </ButtonGroup>
      </ChakraPagination.Root>
    </Flex>
  );
}
