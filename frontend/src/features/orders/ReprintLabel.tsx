import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Checkbox, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { Info, Printer } from "lucide-react";

import { FilterField } from "../../components/chrome/FilterBar";

// CETAK ULANG LABEL (a-changed-label-asks-the-warehouse-to-reprint, accepted as drawn in
// the-reprint-label-prototype-is-accepted): the seller changed an order's resi or label AFTER the warehouse printed it, so
// the parcel's label is old. The SERVER decides it — `Order.reprint_label` / `OrderPrint.reprint_label` /
// `OrderPick.reprint_label`: printed (the print page's Print records it, OrderLabels `record_print`), changed after (Edit
// Resi stamps it), and still in the building (pending, processed, picked). These pieces only draw that answer:
//
//   the badge          the seller list's *No settlement account* badge, copied (SellerOrders.tsx `rowBadgesFor`: warning,
//                      `sm`, a 3-sized icon) — beside the status on one line (a cell is at most two lines)
//   the phone block    a line of its own under the block's first line (a-phone-reads-each-line-as-a-block)
//   the pick page      a line under the title: the badge, why, and Cetak Resi — the print page with this one order
//   the print page     the badge under the order's label (Print clears it)
//   Daftar Ambil       the badge in each marked order's head, drawn as on the list
//   the filter         *Perlu cetak ulang*, a checkbox in a FilterField of its own (the seller list's *Settlement not opened*)
//   the seller         one line in Edit Resi when the warehouse already printed the label
//
// A marked parcel is not handed over (a-parcel-marked-for-reprint-is-not-handed-over) — the server refuses it, and the
// handover scan says *Cetak ulang label dulu* (HandoverScanDialog).

/** *Cetak ulang label* — drawn only when the server marks the order. */
export function ReprintLabelBadge({ on, orderId, testId }: { on: boolean; orderId: bigint; testId?: string }) {
  const { t } = useTranslation();
  if (!on) return null;

  return (
    <Badge
      colorPalette="warning"
      size="sm"
      flexShrink={0}
      title={t("orders.reprintLabel.badgeHint")}
      data-testid={testId ?? `order-reprint-label-${orderId}`}
    >
      <Icon as={Printer} boxSize="3" />
      {t("orders.reprintLabel.badge")}
    </Badge>
  );
}

/** A row's status cell — the status alone, or the status and the badge on one line that does not wrap. */
export function StatusWithReprint({ order, status }: { order: { id: bigint; reprintLabel: boolean }; status: ReactNode }) {
  if (!order.reprintLabel) return <>{status}</>;

  return (
    <HStack gap="1" wrap="nowrap" whiteSpace="nowrap">
      {status}
      <ReprintLabelBadge on orderId={order.id} />
    </HStack>
  );
}

/** A phone block's own line for the badge, under its first line. */
export function ReprintLabelBlockLine({
  order,
  testId,
}: {
  order: { id: bigint; reprintLabel: boolean };
  testId?: string;
}) {
  if (!order.reprintLabel) return null;

  return (
    <Flex align="center" gap="2" minW="0">
      <ReprintLabelBadge on orderId={order.id} testId={testId} />
    </Flex>
  );
}

/**
 * THE PICK PAGE'S LINE — under the title: the badge, why, and the one click that clears it (the print page with this one
 * order, as a row's ⋯ Print Label opens it — a-rows-print-label-opens-the-print-page). Printing is a read, so a monitor
 * has the button too.
 */
export function ReprintLabelPickLine({ order, onPrint }: { order: { id: bigint; reprintLabel: boolean }; onPrint: () => void }) {
  const { t } = useTranslation();
  if (!order.reprintLabel) return null;

  return (
    <Flex
      align="center"
      gap="2"
      wrap="wrap"
      px="3"
      py="2"
      borderWidth="1px"
      borderColor="warning.emphasized"
      bg="warning.subtle"
      borderRadius="l2"
      data-testid="pick-reprint-label-line"
    >
      <ReprintLabelBadge on orderId={order.id} testId="pick-reprint-label" />
      <Text fontSize="sm" flex="1" minW="12rem">
        {t("orders.reprintLabel.pickHint")}
      </Text>
      <Button size="xs" variant="outline" onClick={onPrint} data-testid="pick-reprint-label-print">
        <Icon as={Printer} boxSize="4" />
        {t("warehouseOrders.row.printLabel")}
      </Button>
    </Flex>
  );
}

/** The print page's mark under an order's label — before the print; gone once the print took it. */
export function ReprintLabelPrintMark({ on, orderId }: { on: boolean; orderId: bigint }) {
  if (!on) return null;

  return (
    <Box mt="1">
      <ReprintLabelBadge on orderId={orderId} testId={`print-receipts-reprint-${orderId}`} />
    </Box>
  );
}

/**
 * THE SELLER'S EDIT RESI on an order whose label the warehouse already printed (`label_printed_at_unix` > 0): saving asks
 * it to print again. A line of fact, not a warning — the edit is the seller's to make
 * (the-seller-edits-the-resi-until-handover).
 */
export function ReprintLabelSellerHint({ printedAtUnix }: { printedAtUnix: bigint }) {
  const { t } = useTranslation();
  if (printedAtUnix <= 0n) return null;

  return (
    <Flex
      align="flex-start"
      gap="2"
      px="3"
      py="2"
      borderRadius="l2"
      bg="info.subtle"
      color="info.fg"
      fontSize="sm"
      data-testid="edit-receipt-reprint-hint"
    >
      <Icon as={Info} boxSize="4" mt="0.5" flexShrink={0} />
      <Text>{t("orders.reprintLabel.sellerHint")}</Text>
    </Flex>
  );
}

/** THE LIST'S FILTER — *Perlu cetak ulang*: only the marked orders, so the crew ticks them all and prints with one Cetak Resi. */
export function ReprintLabelFilter({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation();

  return (
    <FilterField w="auto" testId="warehouse-orders-reprint-filter-field">
      <Checkbox.Root
        size="sm"
        checked={checked}
        onCheckedChange={(e) => onChange(e.checked === true)}
        data-testid="warehouse-orders-reprint-filter"
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label whiteSpace="nowrap">{t("orders.reprintLabel.filter")}</Checkbox.Label>
      </Checkbox.Root>
    </FilterField>
  );
}
