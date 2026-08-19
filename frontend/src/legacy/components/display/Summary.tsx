import type { ElementType, ReactNode } from "react";
import { Box, Icon, SimpleGrid, Text } from "@chakra-ui/react";
import { palette, type Tone } from "../tone";
import { Card } from "./Card";

export interface SummaryItem {
  label: string;
  value: ReactNode;
  // A lucide component, shown in a tinted circle in the corner.
  icon?: ElementType;
  tone?: Tone;
}

// Summary is a ROW OF FIGURES that belong together — the band of totals above a table.
//
// It is a different thing from a set of `Statistic` cards, and the difference is the point:
//
//   Statistic — ONE number that matters on its own, sized to be read from across the room. A few of
//               them across the top of a dashboard.
//   Summary   — SEVERAL numbers that only mean something TOGETHER: paid / unpaid / overdue / total.
//               Reading one without the others tells you nothing, so they are laid out as a set,
//               equally weighted, and they wrap as a group.
//
// Laying a summary out as separate Statistic cards makes each figure look independently important
// and lets them wrap apart from each other, which is exactly the wrong reading for a breakdown.
export const description =
  "A band of related figures read together (paid / unpaid / overdue / total) — as opposed to Statistic, which is one number that matters on its own.";

export interface SummaryProps {
  items: SummaryItem[];
  loading?: boolean;
  // Cards per row at the widest breakpoint. They always collapse to one on a phone.
  columns?: number;
}

export function Summary({ items, loading, columns = 4 }: SummaryProps) {
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: Math.min(3, columns), xl: columns }} gap="2" data-testid="summary">
      {items.map((item, i) => (
        <Card key={i} position="relative" data-testid="summary-item">
          <Text fontSize="xs" color="fg.muted" pe="8" lineClamp={1}>
            {item.label}
          </Text>
          <Text
            fontSize="2xl"
            fontWeight="bold"
            // Every figure in a band is compared against its neighbours, so the digits must line up
            // vertically as well as horizontally.
            fontVariantNumeric="tabular-nums"
            opacity={loading ? 0.6 : 1}
          >
            {item.value}
          </Text>

          {item.icon && (
            <Box
              position="absolute"
              top="3"
              insetEnd="3"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxSize="8"
              borderRadius="full"
              colorPalette={palette(item.tone, "active")}
              bg="colorPalette.subtle"
              color="colorPalette.fg"
              aria-hidden
            >
              <Icon as={item.icon} boxSize="4" />
            </Box>
          )}
        </Card>
      ))}
    </SimpleGrid>
  );
}

// SummaryCompact is the same set of figures at roughly half the size.
//
// It is for a summary that sits INSIDE something else — a panel, a dialog, a card that already has a
// title — where the full-size band would out-shout the content it is summarising. The information is
// identical; only the weight changes, which is why it shares `SummaryItem` rather than defining its
// own shape.
export const compactDescription =
  "The same band of figures at half weight, for a summary that sits inside a panel or dialog where the full-size version would out-shout its own content.";

export function SummaryCompact({ items, loading, columns = 3 }: SummaryProps) {
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: columns }} gap="1.5" data-testid="summary-compact">
      {items.map((item, i) => (
        <Card key={i} position="relative" data-testid="summary-item">
          <Text fontSize="2xs" color="fg.muted" pe="7" lineClamp={1}>
            {item.label}
          </Text>
          <Text fontSize="md" fontWeight="bold" fontVariantNumeric="tabular-nums" opacity={loading ? 0.6 : 1}>
            {item.value}
          </Text>

          {item.icon && (
            <Box
              position="absolute"
              top="2"
              insetEnd="2"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxSize="6"
              borderRadius="full"
              colorPalette={palette(item.tone, "active")}
              bg="colorPalette.subtle"
              color="colorPalette.fg"
              aria-hidden
            >
              <Icon as={item.icon} boxSize="3" />
            </Box>
          )}
        </Card>
      ))}
    </SimpleGrid>
  );
}
