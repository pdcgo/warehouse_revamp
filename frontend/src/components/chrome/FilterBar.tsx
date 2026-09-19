import type { ReactNode } from "react";
import { Box, Button, Flex, Input, Spacer } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

export const description =
  "The strip above a data list: search, then the narrowing pickers, then Clear — with page actions pushed to the right. One layout for every list screen, so the same control is in the same place on all of them. Controls WRAP rather than squeeze: only the search box flexes, each FilterField keeps its width. Clear is rendered ONLY while something is actually narrowing the list.";

export interface FilterBarProps {
  // The controls, in reading order: search first, then what narrows the list, then the date range.
  children: ReactNode;
  // True when anything is narrowing the list right now — that is what puts Clear on screen.
  active?: boolean;
  // Reset every filter at once. With no handler there is no Clear button, even when `active`.
  onClear?: () => void;
  // Page-level actions ("New Order"), pushed to the right so they never sit among the filters.
  actions?: ReactNode;
  testId?: string;
}

// FilterBar is the ONE layout for a list screen's filter strip.
//
// Every list page had hand-rolled the same `<Flex gap="card" wrap="wrap" align="center">` and then
// drifted: some put the search first and some the date, some kept a Clear button permanently on
// screen, some let a picker squash to half its width at a narrow viewport. The strip is the first
// thing somebody touches on a list, so it is exactly the wrong place for each screen to be a little
// different.
//
// Three rules are the component, not the caller's discipline:
//
//   1. ORDER IS READING ORDER — the caller's children, then Clear, then a Spacer, then the actions.
//      A page action can never end up between two filters, whatever the caller writes.
//   2. CONTROLS WRAP, THEY DO NOT SQUEEZE — the row wraps and each FilterField refuses to shrink, so
//      a narrow window gives a second row of full-size controls instead of one row of unusable ones.
//      Only FilterSearch flexes, because a search box is the one control that reads fine at any width.
//   3. CLEAR EXISTS ONLY WHILE FILTERING — a permanent Clear over an unnarrowed list is a control
//      that does nothing, and it makes an unfiltered list look filtered.
export function FilterBar({ children, active = false, onClear, actions, testId = "filter-bar" }: FilterBarProps) {
  const { t } = useTranslation();

  return (
    <Flex
      gap="card"
      align="center"
      wrap="wrap"
      w="full"
      data-testid={testId}
      // The state is on the DOM so a page's e2e can assert "this list is narrowed" without
      // re-deriving the answer from the individual controls.
      data-filtering={active ? "true" : undefined}
    >
      {children}

      {onClear && active && (
        <Button
          variant="ghost"
          colorPalette="gray"
          data-testid={`${testId}-clear`}
          onClick={onClear}
        >
          {t("common.clearFilters")}
        </Button>
      )}

      {/* Everything after this is right-aligned. It sits here rather than in the caller's JSX so the
          actions cannot be written into the middle of the filters by accident. */}
      <Spacer />
      {actions}
    </Flex>
  );
}

export interface FilterSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}

// The free-text box, and the only control in the bar that flexes: it grows into whatever space is
// left up to `sm`, and shrinks to 14rem before the row wraps. Debouncing belongs to the caller — the
// bar lays controls out, it does not decide when a query runs.
export function FilterSearch({ value, onChange, placeholder, testId }: FilterSearchProps) {
  const { t } = useTranslation();

  return (
    <Input
      flex="1 1 14rem"
      maxW="sm"
      placeholder={placeholder ?? t("common.searchPlaceholder")}
      value={value}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export interface FilterFieldProps {
  children: ReactNode;
  // Override only for a control that genuinely needs more room (a two-part date/field picker).
  w?: string;
  testId?: string;
}

// A picker's slot. One width for every dropdown so the strip reads as a row of equals, and
// `flexShrink=0` so a narrow viewport wraps the row instead of grinding every picker down to a
// truncated placeholder nobody can read.
export function FilterField({ children, w = "13rem", testId }: FilterFieldProps) {
  return (
    <Box w={w} flexShrink="0" data-testid={testId}>
      {children}
    </Box>
  );
}
