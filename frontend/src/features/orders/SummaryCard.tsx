import { Children } from "react";
import type { ReactNode } from "react";
import { Box, Flex, Text, useBreakpointValue } from "@chakra-ui/react";

// ONE SUMMARY CARD, AND ONE STRIP OF THEM — shared by the order list's summary and the drafts page's, so
// every tab of the screen draws the same card (owner: *"gunakan referensi statistik
// dari list secara bentuk dan ukuran, biar kelihatan seragam"*).
//
// ⚠ A CARD IS NOT A CONTROL (owner). It does not navigate, filter or select, and every card draws the
// same — a highlight on something that cannot be pressed reads as a control that is broken.

/**
 * THE WIDEST A CARD MAY BE, as a share of the strip — 1/5 on a large screen (owner: *"di layar 2k
 * maksimal widthnya 1/5, dan untuk ukuran di bawahnya kamu sesuaikan"*), a larger share as the screen
 * narrows so a card never gets too thin to hold its figure.
 */
const MAX_SHARE = { base: 2, md: 3, lg: 4, "2xl": 5 } as const;

/**
 * THE STRIP — the cards fill the row, but no card is wider than its share.
 *
 * ⚠ TWO LAYOUTS, CHOSEN BY COUNT, because CSS grid alone cannot say "fill the row, but at most 1/5":
 *
 *   more cards than the share allows  →  `auto-fit` of 8.5rem — they fill the row and are already
 *                                         narrower than the cap (nine order cards, seven measures)
 *   as many or fewer                  →  exactly `cap` equal columns — each card IS the cap, and the
 *                                         rest of the row stays empty (three draft cards)
 *
 * History: `auto-fit` alone stretched three draft cards across the screen; `auto-fill` alone shrank
 * nine order cards on a large screen. The count is what separates the two cases.
 */
export function SummaryStrip({ children, testId }: { children: ReactNode; testId?: string }) {
  const cap = useBreakpointValue(MAX_SHARE) ?? MAX_SHARE.base;
  const count = Children.toArray(children).length;

  return (
    <Box
      display="grid"
      gap="3"
      gridTemplateColumns={
        count > cap ? "repeat(auto-fit, minmax(8.5rem, 1fr))" : `repeat(${cap}, minmax(0, 1fr))`
      }
      data-testid={testId}
    >
      {children}
    </Box>
  );
}

export function SummaryCard({
  label,
  badge,
  mark,
  value,
  line,
  note,
  muted = false,
  emphasis = false,
  wide = false,
  testId,
}: {
  /** The card's name. Given instead of a badge — for a pile that is not a status. */
  label?: string;
  /** A status badge naming the pile, in place of a label. */
  badge?: ReactNode;
  /** A ⚠ beside the label, for a figure that is not fully real. */
  mark?: ReactNode;
  /** The headline figure, one line. */
  value: ReactNode;
  /** The quiet line under it. */
  line?: ReactNode;
  /** A second quiet line, under `line` — how the figure is made, where it is not obvious. */
  note?: ReactNode;
  /** Grey the figure — a pile the contract cannot count. */
  muted?: boolean;
  /**
   * The ONE figure a strip leads with — a little louder, never a different shape: a full fill in pale
   * blue (the `lead.*` tokens) and its figure one size up. Use it once per strip, or it
   * means nothing.
   */
  emphasis?: boolean;
  /**
   * Span the whole strip — for the lead card on a phone, where two columns would leave it alone in half
   * a row as an afterthought.
   */
  wide?: boolean;
  testId?: string;
}) {
  return (
    // A GREY GROUND AND A THIN LINE (owner: *"background subtle / border tipis"*). `bg.subtle` is white in
    // this theme — the same as the page and the card it sits on — so the card read as an outline only.
    <Box
      borderWidth="1px"
      borderColor={emphasis ? "lead.border" : "border"}
      bg={emphasis ? "lead.bg" : "bg.muted"}
      gridColumn={wide ? "1 / -1" : undefined}
      borderRadius="l2"
      px="3"
      py="2.5"
      minW="0"
      data-testid={testId}
      data-emphasis={emphasis || undefined}
    >
      {label ? (
        <Flex gap="1" align="center">
          <Text fontSize="xs" fontWeight="bold" color="fg.label">
            {label}
          </Text>
          {mark}
        </Flex>
      ) : (
        badge
      )}

      <Text
        fontSize={emphasis ? "lg" : "md"}
        fontWeight="bold"
        mt="1.5"
        lineClamp={1}
        color={muted ? "fg.subtle" : emphasis ? "lead.fg" : undefined}
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </Text>

      {line !== undefined && (
        <Text fontSize="xs" color="fg.muted" lineClamp={1}>
          {line}
        </Text>
      )}

      {note !== undefined && (
        <Text fontSize="xs" color="fg.subtle" lineClamp={1} data-testid={testId ? `${testId}-note` : undefined}>
          {note}
        </Text>
      )}
    </Box>
  );
}
