import type { ReactNode } from "react";
import { Box, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { NotImplemented } from "../../../features/pending/NotImplemented";
import { CopyText } from "../../orders/components/CopyText";
import { ORDER_DETAIL_PENDING } from "../pending";

// THE TWO NUMBERS THAT LEAVE THE APP — first thing in the first card (owner: *"resi lumayan penting di
// atas agar kelihatan"*, and *"jangan di sticky"*).
//
// The resi is pasted into a courier's site and quoted by a buyer chasing a parcel; the marketplace order
// id is pasted into the platform's dashboard. They are the references somebody opened this page to
// carry somewhere else, so they are a pair, and they sit a size above the facts that are only context.
//
// ⚠ NOT IN THE STICKY HEADER. The header stays short and holds only what the order IS and what can be
// done to it; the references are read once on arrival and are allowed to scroll away.
//
// ⚠ THE RETURN RESI ONLY WHEN A RETURN EXISTS. Most orders never return, and an empty "Resi retur —" on
// every one of them would be a field people learn to skip. The outbound resi always shows, `—` if empty:
// *"resi pasti ada"*, so its absence is worth seeing.
export function OrderReferences({
  courier,
  receiptCode,
  orderRefId,
  returnLeg,
  returnMark,
}: {
  courier?: string;
  receiptCode?: string;
  /** `order_external_ref_id`. "" on a phone order. */
  orderRefId: string;
  returnLeg?: { courier: string; receiptCode: string };
  /** ⚠ for the return resi — the return leg is invented whole. */
  returnMark?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="3" data-testid="order-references">
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
        <Reference
          label={t("orders.receiptColumn")}
          mark={<NotImplemented list={ORDER_DETAIL_PENDING} id="receiptCode" />}
          testId="order-reference-receipt"
        >
          {receiptCode ? (
            <Flex gap="2" align="center" wrap="wrap">
              {courier && (
                <Text color="fg.muted" fontSize="sm">
                  {courier.toUpperCase()}
                </Text>
              )}
              <CopyText value={receiptCode} mono fontSize="md" />
            </Flex>
          ) : undefined}
        </Reference>

        <Reference label={t("orders.orderExternalRefId")} testId="order-reference-mp">
          {orderRefId.trim() ? <CopyText value={orderRefId.trim()} fontSize="md" /> : undefined}
        </Reference>
      </SimpleGrid>

      {returnLeg && (
        <Flex gap="2" align="center" wrap="wrap" data-testid="order-reference-return">
          <Text fontSize="xs" fontWeight="bold" color="fg.label">
            {t("orderDetail.info.returnReceipt")}
          </Text>
          {returnMark}
          <Text color="fg.muted" fontSize="sm">
            {returnLeg.courier.toUpperCase()}
          </Text>
          <CopyText value={returnLeg.receiptCode} mono />
        </Flex>
      )}
    </Stack>
  );
}

/** A reference, a size larger than an ordinary fact. `—` when absent. */
function Reference({
  label,
  mark,
  children,
  testId,
}: {
  label: string;
  mark?: ReactNode;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <Stack gap="1" minW="0" data-testid={testId}>
      <Flex gap="1" align="center">
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {label}
        </Text>
        {mark}
      </Flex>
      <Box fontSize="md" fontWeight="bold" minW="0">
        {children ?? <Text color="fg.subtle">—</Text>}
      </Box>
    </Stack>
  );
}
