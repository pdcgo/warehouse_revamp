import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, CloseButton, Dialog, Flex, Icon, Portal, Stack, Text } from "@chakra-ui/react";
import { CircleCheck, CircleX } from "lucide-react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { mockReceiptCode } from "../../../features/orders/rowMock";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { beep } from "../../../lib/beep";
import { WAREHOUSE_ORDERS_PENDING } from "../pending";
import { ScanInput } from "./ScanInput";

// FINDING ONE PARCEL IN A SACK (owner — `scanning-is-the-crews-hands`).
//
// Packed parcels go straight into sacks and piles. When one has to come out again — to cancel it, check
// it, or move it to another courier's pile — the operator opens this for THAT order and scans labels in
// the pile until one sounds a match, instead of reading resi after resi.
//
// ⚠ NO API, ON PURPOSE (owner): the order is already on screen, so its resi and its order id are already
// known — every scan is compared here, instantly, with nothing to wait for.
export function FindParcelDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [last, setLast] = useState<{ code: string; match: boolean } | null>(null);

  const resi = order ? mockReceiptCode(order.id, order.status) : "";
  const targets = order ? [resi, order.orderExternalRefId, String(order.id)].filter((value) => value !== "") : [];

  function scan(code: string) {
    const match = targets.includes(code);
    beep(match ? "fulfilled" : "wrong");
    setLast({ code, match });
  }

  function close() {
    setLast(null);
    onClose();
  }

  return (
    <Dialog.Root open={order !== null} onOpenChange={(e) => !e.open && close()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="find-parcel-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("warehouseOrders.find.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="field">
                {/* WHAT IS BEING LOOKED FOR — the numbers printed on the label. */}
                <Box borderWidth="1px" borderColor="border" borderRadius="l2" p="3">
                  <Text fontSize="xs" color="fg.muted">
                    {t("warehouseOrders.find.lookingFor")}
                  </Text>
                  <Flex align="center" gap="1">
                    <Text fontFamily="mono" fontSize="lg" fontWeight="bold" data-testid="find-parcel-resi">
                      {resi}
                    </Text>
                    <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="receiptCode" />
                  </Flex>
                  <Text fontSize="sm" color="fg.muted">
                    {order?.orderExternalRefId || `#${order?.id ?? ""}`}
                  </Text>
                </Box>

                <Text fontSize="sm" color="fg.muted">
                  {t("warehouseOrders.find.help")}
                </Text>

                <ScanInput onScan={scan} testId="find-parcel-scan" />

                {last && (
                  <Flex
                    align="center"
                    gap="3"
                    p="4"
                    borderRadius="l2"
                    bg={last.match ? "success.subtle" : "error.subtle"}
                    color={last.match ? "success.fg" : "error.fg"}
                    data-testid="find-parcel-result"
                    data-match={last.match ? "true" : "false"}
                  >
                    <Icon as={last.match ? CircleCheck : CircleX} boxSize="8" />
                    <Stack gap="0">
                      <Text fontSize="lg" fontWeight="bold">
                        {last.match ? t("warehouseOrders.find.match") : t("warehouseOrders.find.noMatch")}
                      </Text>
                      <Text fontFamily="mono" fontSize="sm">
                        {last.code}
                      </Text>
                    </Stack>
                  </Flex>
                )}
              </Stack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
