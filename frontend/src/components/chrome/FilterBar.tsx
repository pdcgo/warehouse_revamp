import { Children, createContext, isValidElement, useContext, useState } from "react";
import type { ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Drawer,
  Flex,
  Icon,
  Input,
  Portal,
  Spacer,
  Stack,
  useBreakpointValue,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";

export const description =
  "The strip above a data list: search, then the narrowing pickers, then Clear — with page actions pushed to the right. One layout for every list screen, so the same control is in the same place on all of them. Controls WRAP rather than squeeze: only the search box flexes, each FilterField keeps its width. Clear is rendered ONLY while something is actually narrowing the list. On a phone the search stays in the row and every other control moves into a bottom sheet behind a Filter button, full width.";

export interface FilterBarProps {
  // The controls, in reading order: search first, then what narrows the list, then the date range.
  children: ReactNode;
  // True when anything is narrowing the list right now — that is what puts Clear on screen.
  active?: boolean;
  // Reset every filter at once. With no handler there is no Clear button, even when `active`.
  onClear?: () => void;
  // Page-level actions ("New Order"), pushed to the right so they never sit among the filters.
  actions?: ReactNode;
  // How many filters are narrowing the list — the number on the phone's Filter button. Omitted, the
  // button shows a dot while `active` instead of a count.
  count?: number;
  testId?: string;
}

// Whether the controls are being laid out inside the phone's sheet — where a FilterField takes the full
// width instead of its fixed slot.
const InSheet = createContext(false);

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
//      that does nothing, and it makes an unfiltered list look filtered. When it IS there it is RED and
//      BOLD (owner, `clear-filters-is-red-and-bold`): it throws away what somebody set, and it should be
//      found at a glance when a list looks emptier than expected.
//   4. A PHONE GETS A SHEET (owner: *"bentuk filter di order list cukup berantakan pada tampilan
//      mobile"*). Six controls wrapped into six ragged rows — 15rem, 13rem and `auto` wide, the ⚠ badges
//      pushing some narrower — and ~280px of a phone before the tabs. The search stays in the row,
//      because it is the one control used every visit; the rest open from a Filter button into a
//      bottom sheet, each at the full width. A JS breakpoint, never CSS: the controls must mount once.
export function FilterBar({
  children,
  active = false,
  onClear,
  actions,
  count,
  testId = "filter-bar",
}: FilterBarProps) {
  const { t } = useTranslation();
  const phone = useBreakpointValue({ base: true, md: false }) ?? false;
  const [open, setOpen] = useState(false);

  if (phone) {
    // The search is found by TYPE, so a caller writes one set of children for both layouts.
    const all = Children.toArray(children);
    const search = all.filter((child) => isValidElement(child) && child.type === FilterSearch);
    const rest = all.filter((child) => !(isValidElement(child) && child.type === FilterSearch));

    return (
      <Flex
        gap="2"
        align="center"
        w="full"
        data-testid={testId}
        data-filtering={active ? "true" : undefined}
      >
        {search}

        {rest.length > 0 && (
          <Button
            variant="outline"
            colorPalette="gray"
            flexShrink="0"
            data-testid={`${testId}-open`}
            onClick={() => setOpen(true)}
          >
            <Icon as={SlidersHorizontal} boxSize="4" />
            {t("common.filters")}
            {active && (
              <Badge colorPalette="brand" variant="solid" size="xs" data-testid={`${testId}-count`}>
                {count ?? "•"}
              </Badge>
            )}
          </Button>
        )}

        {actions}

        <Drawer.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="bottom">
          <Portal>
            <Drawer.Backdrop />
            <Drawer.Positioner>
              <Drawer.Content roundedTop="l3" data-testid={`${testId}-sheet`}>
                <Drawer.Header>
                  <Drawer.Title>{t("common.filters")}</Drawer.Title>
                </Drawer.Header>
                <Drawer.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>

                <Drawer.Body>
                  <InSheet.Provider value={true}>
                    <Stack gap="field">{rest}</Stack>
                  </InSheet.Provider>
                </Drawer.Body>

                <Drawer.Footer>
                  {onClear && active && (
                    <Button
                      variant="ghost"
                      colorPalette="error"
                      fontWeight="bold"
                      data-testid={`${testId}-clear`}
                      onClick={onClear}
                    >
                      {t("common.clearFilters")}
                    </Button>
                  )}
                  <Spacer />
                  {/* The filters apply as they change, so this only closes — it is not an Apply. */}
                  <Button colorPalette="brand" data-testid={`${testId}-done`} onClick={() => setOpen(false)}>
                    {t("common.done")}
                  </Button>
                </Drawer.Footer>
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root>
      </Flex>
    );
  }

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
          colorPalette="error"
          fontWeight="bold"
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
  // In the phone's sheet every field is a full-width row, whatever slot it asked for on a desktop —
  // and so is the control inside it. A trigger with its own minimum width (the date range's button)
  // would otherwise sit at that minimum in a full-width row.
  const inSheet = useContext(InSheet);

  return (
    <Box
      w={inSheet ? "full" : w}
      flexShrink="0"
      css={inSheet ? { "& > *": { width: "100%" } } : undefined}
      data-testid={testId}
    >
      {children}
    </Box>
  );
}
