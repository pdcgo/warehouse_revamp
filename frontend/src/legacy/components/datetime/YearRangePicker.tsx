import { useState } from "react";
import { Button, Grid, HStack, Icon, Popover, Portal, Text } from "@chakra-ui/react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

/** A year window, inclusive. `yyyy`; `""` is an open end. */
export interface YearRange {
  from: string;
  to: string;
}

export const ALL_YEARS: YearRange = { from: "", to: "" };

// A decade at a time. Twelve years fits the same three-column grid the month picker uses, so the two
// controls are the same size and shape — they sit in the same slot of the same toolbar.
const PAGE = 12;

// YearRangePicker picks a window of whole YEARS.
//
// The coarsest grain, and the one with the smallest range of plausible answers: this system has a
// handful of years of history and nobody is reporting on 1998. So it pages by a DECADE rather than
// offering a free-text year, which removes the typo class entirely — you cannot pick 2062 by
// fat-fingering a digit.
//
// Same order-insensitive two-click selection as MonthRangePicker, for the same reason.
export const description =
  "A window of whole YEARS, paged a decade at a time. No free-text year, so a mistyped digit cannot produce a range a century away.";

export interface YearRangePickerProps {
  value: YearRange;
  onChange(range: YearRange): void;
  disabled?: boolean;
  placeholder?: string;
}

export function YearRangePicker({
  value,
  onChange,
  disabled,
  placeholder = "All years",
}: YearRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [pageStart, setPageStart] = useState(() => {
    const current = Number(value.from || value.to) || new Date().getFullYear();
    // Align the page so the current year is on it rather than at an arbitrary offset.
    return current - (current % PAGE);
  });

  const label = value.from || value.to ? `${value.from || "…"} – ${value.to || "…"}` : placeholder;

  function pick(year: string) {
    if (anchor === null) {
      setAnchor(year);
      onChange({ from: year, to: year });
      return;
    }

    const [from, to] = anchor <= year ? [anchor, year] : [year, anchor];
    setAnchor(null);
    onChange({ from, to });
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={(e) => { setOpen(e.open); if (!e.open) setAnchor(null); }}>
      <Popover.Trigger asChild>
        <Button variant="outline" fontWeight="normal" disabled={disabled} data-testid="year-range-trigger">
          <Icon as={Calendar} boxSize="4" />
          <Text truncate>{label}</Text>
          <Icon as={ChevronDown} boxSize="4" />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Positioner>
          <Popover.Content data-testid="year-range-panel">
            <Popover.Body>
              <HStack justify="space-between" mb="2">
                <Button size="xs" variant="ghost" aria-label="Previous decade" onClick={() => setPageStart((y) => y - PAGE)}>
                  <Icon as={ChevronLeft} boxSize="4" />
                </Button>
                <Text fontWeight="medium" data-testid="year-range-page">
                  {pageStart}–{pageStart + PAGE - 1}
                </Text>
                <Button size="xs" variant="ghost" aria-label="Next decade" onClick={() => setPageStart((y) => y + PAGE)}>
                  <Icon as={ChevronRight} boxSize="4" />
                </Button>
              </HStack>

              <Grid templateColumns="repeat(3, 1fr)" gap="1">
                {Array.from({ length: PAGE }, (_, i) => String(pageStart + i)).map((year) => {
                  const inRange = Boolean(value.from && value.to && year >= value.from && year <= value.to);
                  const isEnd = year === value.from || year === value.to;

                  return (
                    <Button
                      key={year}
                      size="xs"
                      variant={isEnd ? "solid" : inRange ? "subtle" : "ghost"}
                      colorPalette={inRange || isEnd ? "brand" : "gray"}
                      onClick={() => pick(year)}
                      data-testid={`year-${year}`}
                      data-in-range={inRange ? "true" : undefined}
                    >
                      {year}
                    </Button>
                  );
                })}
              </Grid>

              <Button
                size="xs"
                variant="ghost"
                w="full"
                mt="2"
                onClick={() => {
                  setAnchor(null);
                  onChange(ALL_YEARS);
                  setOpen(false);
                }}
                data-testid="year-range-clear"
              >
                All years
              </Button>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
