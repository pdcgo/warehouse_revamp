import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Group, HStack, Icon, IconButton, Popover, Portal, Stack, Text } from "@chakra-ui/react";
import { ChevronDown, X } from "lucide-react";

import { useIsMobile } from "../../layouts/shell";
import { FilterChips } from "../../components/chrome/FilterChips";
import { NotImplemented } from "../pending/NotImplemented";
import { SUPPLIER_LIST_PENDING } from "./listPending";
import { FIGURE_RANGES, type FigureRangeKind, rangeLabel } from "./figureRanges";
import { oneOfCodec, useUrlState } from "../../lib/urlState";

export const description =
  "A supplier figure's range filter — Terjual or Siap — as a trigger of its own opening a narrow panel of range pills, Semua first. The trigger reads the picked band in the main tone, with an × attached to it that clears the band without opening the panel, its ⚠ mark beside it; a pick closes the panel. On a phone, inside the Filter sheet, it is a label over its pills instead. Nothing narrows a list by it yet (`dropped`).";

/** The band picked per figure — "" for all. */
export type FigureRangePicks = Record<FigureRangeKind, string>;

export const NO_FIGURE_RANGES: FigureRangePicks = { sold: "", ready: "" };

/** How many of the two have a band picked — what a FilterBar counts, and what makes Clear appear. */
export const rangesOn = (picks: FigureRangePicks) => Object.values(picks).filter((key) => key !== "").length;

const SOLD_CODEC = oneOfCodec(["", ...FIGURE_RANGES.sold.map((range) => range.key)]);
const READY_CODEC = oneOfCodec(["", ...FIGURE_RANGES.ready.map((range) => range.key)]);

/**
 * Terjual and Siap, kept in the URL as `sold` and `ready` (a-lists-filters-live-in-the-url) — the supplier list's and
 * Discover's. A band the URL names that no longer exists is read as Semua.
 */
export function useUrlFigureRanges(): [FigureRangePicks, (next: FigureRangePicks) => void] {
  const [sold, setSold] = useUrlState("sold", "", SOLD_CODEC);
  const [ready, setReady] = useUrlState("ready", "", READY_CODEC);
  const set = (next: FigureRangePicks) => {
    setSold(next.sold);
    setReady(next.ready);
  };
  return [{ sold, ready }, set];
}

/** Terjual, then Siap — the pair as a filter strip carries them. */
export function SupplierRangeFilters({
  value,
  onChange,
}: {
  value: FigureRangePicks;
  onChange: (next: FigureRangePicks) => void;
}) {
  return (
    <>
      {(["sold", "ready"] as const).map((kind) => (
        <SupplierRangeFilter
          key={kind}
          kind={kind}
          value={value[kind]}
          onChange={(key) => onChange({ ...value, [kind]: key })}
        />
      ))}
    </>
  );
}

// ONE FIGURE'S RANGE FILTER — a trigger of its own and a narrow panel of range pills (owner: *"pisahkan aja panelnya,
// terlalu lebar juga panelnya"*, `the-figure-filters-are-two-panels`). Terjual and Siap are two of these, side by side —
// on the supplier list and on Discover (`discover-shows-the-same-figures-and-filters`).
//
//   [Terjual: 500–1.000 ⌄] ⚠3   [Siap ⌄] ⚠4
//   ┌──────────────────────────────────────┐
//   │ (Semua) (< 500) (500–1.000) (1.000–2.500) │
//   │ (2.500–5.000) (≥ 5.000)                │
//   └──────────────────────────────────────┘
//
// The trigger names its figure and, once a band is picked, the band — pale rose, as a chosen pill is
// (a-chosen-option-is-in-the-main-tone). A pick closes the panel: one choice, as a select's. Nothing narrows the list by
// it yet, so the trigger carries its `dropped` mark, beside it where it is seen without opening anything.
//
// AN × CLEARS IT (owner: *"panel ada closablenya untuk filter, misal marketplace terjual dan siap"*,
// `every-filter-clears-from-its-own-x`) — once a band is picked, an × attached to the trigger's end sets it back to
// Semua without opening the panel, as a select's × does. Attached, not inside: a button nested in the trigger is a
// button inside a button.
//
//   [Terjual: 500–1.000 ⌄][×] ⚠3
//
// ON A PHONE the FilterBar has already put every control in its bottom sheet, so the figure stands there as a label over
// its pills — a popover inside a sheet is a panel inside a panel. A JS breakpoint, never CSS.
export function SupplierRangeFilter({
  kind,
  value,
  onChange,
}: {
  kind: FigureRangeKind;
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const ranges = FIGURE_RANGES[kind];
  const picked = ranges.find((range) => range.key === value);
  const label = t(`suppliers.table.${kind}`);
  const mark = <NotImplemented list={SUPPLIER_LIST_PENDING} id={kind === "sold" ? "soldRange" : "readyRange"} />;

  const pills = (
    <FilterChips
      value={value}
      onChange={(key) => {
        onChange(key);
        setOpen(false);
      }}
      all=""
      allLabel={t("suppliers.rangeAll")}
      options={ranges.map((range) => ({ value: range.key, label: rangeLabel(range) }))}
      ariaLabel={label}
      testId={`supplier-range-${kind}-chips`}
    />
  );

  if (isMobile) {
    return (
      <Stack gap="2" data-testid={`supplier-range-${kind}`}>
        <HStack gap="1">
          <Text fontSize="sm" fontWeight="bold" color="fg.label">
            {label}
          </Text>
          {mark}
        </HStack>
        {pills}
      </Stack>
    );
  }

  return (
    <HStack gap="1" flexShrink="0" data-testid={`supplier-range-${kind}`}>
      <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: "bottom-start" }}>
        <Group attached>
          <Popover.Trigger asChild>
            <Button
              variant={picked ? "subtle" : "outline"}
              colorPalette={picked ? "brand" : "gray"}
              borderWidth="1px"
              borderColor={picked ? "brand.solid" : "border"}
              fontWeight="normal"
              data-testid={`supplier-range-${kind}-trigger`}
            >
              {picked ? `${label}: ${rangeLabel(picked)}` : label}
              <Icon as={ChevronDown} boxSize="4" />
            </Button>
          </Popover.Trigger>
          {picked && (
            <IconButton
              variant="subtle"
              colorPalette="brand"
              borderWidth="1px"
              borderColor="brand.solid"
              aria-label={t("suppliers.rangeClear", { figure: label })}
              // It fades in when a band is picked (`a-filter-answers-as-it-changes`).
              animationStyle="appear"
              onClick={() => onChange("")}
              data-testid={`supplier-range-${kind}-clear`}
            >
              <Icon as={X} boxSize="3.5" />
            </IconButton>
          )}
        </Group>
        <Portal>
          <Popover.Positioner>
            {/* Narrow — the pills wrap to a second line rather than the panel spreading across the page. */}
            <Popover.Content w="auto" maxW="xs" data-testid={`supplier-range-${kind}-panel`}>
              <Popover.Body>{pills}</Popover.Body>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
      {mark}
    </HStack>
  );
}
