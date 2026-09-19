import { Stack, Table, Text } from "@chakra-ui/react";

export interface DamageCellProps {
  /** How many units failed this way. 0 renders a muted em dash, not "0". */
  quantity: bigint;
  /** Why, as the person at the door wrote it — already joined by `damageReasons`. */
  reasons: string;
  testId: string;
}

// ONE DAMAGE FIGURE AND WHY — the LOST cell and the BROKEN cell, which render identically and differ
// only in which number they carry.
//
// It lives in features/ because BOTH restock detail pages use it: the buyer's Product tab (the side
// that files the claim) and the warehouse's line table (the side that counted it at the door). Two
// inline copies is how one of them quietly loses its reason line — and the reason is the actionable
// half, since it is what somebody quotes back to the supplier.
//
// A zero is an em dash rather than "0": on a line where nothing went wrong, a row of zeroes draws the
// eye to the things that did NOT happen, and the numbers worth reading stop standing out.
export function DamageCell({ quantity, reasons, testId }: DamageCellProps) {
  if (quantity === 0n) {
    return (
      <Table.Cell textAlign="end" color="fg.muted" data-testid={testId}>
        —
      </Table.Cell>
    );
  }

  return (
    <Table.Cell textAlign="end" data-testid={testId}>
      <Stack gap="0" align="end">
        <Text as="span" fontWeight="semibold" color="red.fg">
          {quantity.toString()}
        </Text>
        {/* On the row rather than behind a hover — but CLAMPED, because a 200-char note must not make
            one line three rows tall. The full text stays available as the title attribute. */}
        {reasons && (
          <Text fontSize="xs" color="fg.muted" lineClamp={2} title={reasons}>
            {reasons}
          </Text>
        )}
      </Stack>
    </Table.Cell>
  );
}
