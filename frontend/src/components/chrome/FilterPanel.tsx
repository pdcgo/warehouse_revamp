import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button, Card, HStack, Heading, Icon, Spacer, Stack, Text, useSlotRecipe } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";

export const description =
  "A list's filters as a column BESIDE it — for a browse with many filters, where a strip would hide most of them behind a button. A titled card that sticks as the page scrolls, one labelled FilterGroup per filter, top to bottom in reading order, and Hapus Filter in its header only while something narrows the list. A desktop's: below `lg` the same groups go into FilterBar's sheet (`sheetBelow=\"lg\"`).";

export interface FilterPanelProps {
  /** The FilterGroups, in reading order — the first is the one reached for first. */
  children: ReactNode;
  /** True when anything is narrowing the list right now — that is what puts Hapus Filter on screen. */
  active?: boolean;
  /** Reset every filter at once. With no handler there is no Hapus Filter, even when `active`. */
  onClear?: () => void;
  testId?: string;
}

// FILTER PANEL (owner, on Product Discover: *"filternya akan banyak"*, `discover-filters-in-a-side-panel`). FilterBar is
// the strip for a list with a few filters; a browse with many of them gets a column of its own, so every filter is on
// screen at once instead of most of them behind a Filter button:
//
//   ┌ ⚲ Filter      Hapus Filter ┐   [⌕ Cari …]            128 produk   [Terbaru ⌄]
//   │ Gudang ⚠                   │   ┌─────┐ ┌─────┐ ┌─────┐
//   │ [Semua gudang          ⌄]  │   │     │ │     │ │     │
//   │ Tim pemilik                │
//   │ [Semua tim             ⌄]  │
//   └────────────────────────────┘
//
// FilterBar's rules hold here too: reading order is the caller's order, Hapus Filter exists only while filtering and is
// RED and BOLD (`clear-filters-is-red-and-bold`), fading in as it arrives (`a-filter-answers-as-it-changes`). It STICKS
// as the window scrolls (sticky-sticks-to-the-window), so the filters are in reach from the bottom of a long grid.
//
// NEVER PAST THE WINDOW'S FOOT (owner: *"filternya tenggelam di bawah, kudu scroll produk"*): with its range pills the
// panel outgrew a screen, and a sticky box taller than the window keeps its foot below the fold — the last filters were
// reached only by scrolling the products. So the card ends a gutter above the window's bottom WHEREVER IT STANDS — lower
// at rest, under the page's title, and taller once it sticks — re-measured on every scroll and resize; its title and
// Hapus Filter stay put, and the GROUPS scroll inside it, the bar on the card's right edge (`scrollList`). A fixed
// `100dvh` cap was not enough: at rest the card starts ~175px down, so its last 135px were still off the screen.
// ⚠ A picker inside that is not portalled must position itself `fixed`, or the scroller cuts it off (CategorySelect's
// `positioningStrategy`).
//
// A DESKTOP'S ONLY. The page mounts it by a JS breakpoint, and below `lg` hands the SAME groups to FilterBar with
// `sheetBelow="lg"`, where they stand in the bottom sheet — one set of controls, two containers, never both mounted.
export function FilterPanel({ children, active = false, onClear, testId = "filter-panel" }: FilterPanelProps) {
  const { t } = useTranslation();
  const card = useRef<HTMLDivElement>(null);

  // The card's height, from where it stands to a gutter above the window's foot. The sticky `top` IS the gutter, so the
  // card has the same margin below as above once it sticks. The listener is captured on `window`, so it hears whichever
  // scroller is moving (sticky-sticks-to-the-window).
  useEffect(() => {
    const el = card.current;
    if (!el) return;

    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const gutter = parseFloat(getComputedStyle(el).top) || 0;
        const top = el.getBoundingClientRect().top;
        // Never below a usable height, however low the card starts.
        el.style.maxHeight = `${Math.max(240, window.innerHeight - top - gutter)}px`;
      });
    };

    fit();
    window.addEventListener("scroll", fit, { capture: true, passive: true });
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", fit, { capture: true });
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <Card.Root
      ref={card}
      as="aside"
      variant="outline"
      position="sticky"
      top="page"
      // ABOVE THE LIST BESIDE IT (owner: *"filter kategori ketutupan card produk"*). Sticky makes the card a stacking
      // context of its own, so a picker opening from inside it is layered WITH the card — at `auto` the list that comes
      // after it in the page was painted on top, and CategorySelect's columns, which grow toward the grid, went under it.
      zIndex="docked"
      alignSelf="start"
      maxH="calc(100dvh - 2 * var(--chakra-spacing-page))"
      overflow="hidden"
      aria-label={t("common.filters")}
      data-testid={testId}
      // The state is on the DOM, as FilterBar's is, so a test can ask "is this list narrowed" in one place.
      data-filtering={active ? "true" : undefined}
    >
      <Card.Body p="card" gap="section" minH="0">
        <HStack gap="2" minH="8" flexShrink={0}>
          <Icon as={SlidersHorizontal} boxSize="4" color="fg.muted" />
          <Heading size="sm">{t("common.filters")}</Heading>
          <Spacer />
          {onClear && active && (
            <Button
              size="xs"
              variant="ghost"
              colorPalette="error"
              fontWeight="bold"
              animationStyle="appear"
              data-testid={`${testId}-clear`}
              onClick={onClear}
            >
              {t("common.clearFilters")}
            </Button>
          )}
        </HStack>

        {/* The groups scroll; the scroller is pulled out through the body's right padding and given it back, so the bar
            rides the card's edge while every group stays where it was. */}
        <Stack
          gap="section"
          layerStyle="scrollList"
          flex="1"
          minH="0"
          me="calc(var(--chakra-spacing-card) * -1)"
          pe="card"
          data-testid={`${testId}-groups`}
        >
          {children}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

export interface FilterGroupProps {
  /** What the filter narrows by — a field label, sentence case. */
  label: string;
  /** Beside the label: a ⚠ pending mark, when the filter is not wired yet. */
  mark?: ReactNode;
  children: ReactNode;
  testId?: string;
}

// One filter in a FilterPanel — or in FilterBar's sheet, where the same group stands at the full width: its label
// above, in the field label's type (13px bold, `fg.label` — read from the field recipe, so the two cannot drift), then
// its control(s) at the full width of the column.
//
// ⚠ NOT A Field.Root. A group can hold TWO controls (Tim pemilik: a select and a checkbox), and a Field hands its one id
// to every control inside it — the checkbox's label then pointed at the select's input, and a click on "Sembunyikan
// produk saya" opened the team picker instead of ticking the box (owner: *"tidak bisa diklik malah ke selectnya"*).
export function FilterGroup({ label, mark, children, testId }: FilterGroupProps) {
  const field = useSlotRecipe({ key: "field" })({});

  return (
    <Stack gap="1.5" w="full" data-testid={testId}>
      <HStack gap="1">
        <Text as="span" css={field.label}>
          {label}
        </Text>
        {mark}
      </HStack>
      {children}
    </Stack>
  );
}
