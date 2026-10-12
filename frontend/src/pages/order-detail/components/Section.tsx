import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Box, Card, Flex, Heading, Icon, Spacer, Stack, Text } from "@chakra-ui/react";

// ONE SECTION OF THE ORDER, AS A CARD.
//
// ⚠ SEVEN SECTIONS DOWN ONE PAGE, NOT THREE TABS (owner). The built detail page files the same facts
// under Info / Timeline / Settlement, and the owner described a single column: info, items, timeline,
// shipping, recipient, withdrawal. The difference is not cosmetic — a tab asks the reader to know
// which drawer a fact is in, and the question this screen answers ("what happened with this order")
// is usually answered by two sections at once: the money and the timeline, or the shipment and the
// recipient. Tabs put exactly those pairs on opposite sides of a click.
//
// ⚠ AN EMPTY SECTION STILL RENDERS, with a sentence saying what is absent. The shipping section is the
// case that settles this: the owner expects it to be empty most of the time (*"kebanyakan tidak ada"*),
// and a section that disappeared when empty would make "no tracking" indistinguishable from "this
// screen does not show tracking".
export function Section({
  id,
  icon,
  title,
  marks,
  action,
  children,
  testId,
}: {
  /** The DOM id the left navigation scrolls to — `sectionDomId(key)`. */
  id?: string;
  /** The section's icon — `sectionIcon(key)`, the same one its nav item shows. */
  icon?: LucideIcon;
  title: string;
  /**
   * The ⚠ build-status marks for this section — drawn RIGHT BESIDE the title, the way the order form
   * and the order list place them. Pushed to the card's far edge they read as belonging to nothing,
   * which is how a whole invented withdrawal table came to look unmarked (owner: *"wd dan sebagainya
   * tidak ada warningnya"*).
   */
  marks?: ReactNode;
  /** Trailing content at the far edge of the header — a button. */
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    // ⚠ `scrollMarginTop` CLEARS THE STICKY HEADER. Without it a jump from the nav lands the section's
    // title UNDER the header, so the click appears to have scrolled to the wrong place. The header's
    // height is measured by the page and published as `--order-header-h`, because it grows when the
    // actions wrap onto a second line.
    <Card.Root
      id={id}
      scrollMarginTop="calc(var(--order-header-h, 0px) + 1rem)"
      data-testid={testId}
    >
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" gap="2">
            {icon && <Icon as={icon} boxSize="4" color="fg.muted" />}
            <Heading size="sm">{title}</Heading>
            {marks}
            <Spacer />
            {action}
          </Flex>

          {children}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/** What a section says when it has nothing — a sentence, never a blank card. */
export function SectionEmpty({ children }: { children: ReactNode }) {
  return (
    <Text color="fg.muted" fontSize="sm" data-testid="empty-note">
      {children}
    </Text>
  );
}

/** A labelled fact. `—` when absent, because a missing value and an empty string read differently. */
export function Fact({
  label,
  children,
  full = false,
  mark,
}: {
  label: string;
  /** A ⚠ beside the label, for a fact that is invented. */
  mark?: ReactNode;
  children?: ReactNode;
  /** Span every column of the grid and never clamp — for text that must be read whole. */
  full?: boolean;
}) {
  const empty = children === undefined || children === null || children === "";

  return (
    <Stack gap="0.5" minW="0" gridColumn={full ? "1 / -1" : undefined}>
      <Flex gap="1" align="center">
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {label}
        </Text>
        {mark}
      </Flex>
      {/* ⚠ A BOX, NOT A Text. A fact's value is often a component — a marketplace badge, a copy
          button — and Chakra's Text renders a <p>, which cannot legally contain a <div>. React says so
          in the console and the browser silently reparents the markup, which breaks the layout in a
          way that looks like a styling bug. */}
      {empty ? (
        <Text color="fg.subtle">—</Text>
      ) : (
        <Box lineClamp={full ? undefined : 2} whiteSpace={full ? "pre-wrap" : undefined} minW="0">
          {children}
        </Box>
      )}
    </Stack>
  );
}
