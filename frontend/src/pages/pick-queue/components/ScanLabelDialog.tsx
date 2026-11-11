import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Box, Button, CloseButton, Dialog, Flex, Icon, Portal, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowRight, PackageX, SearchX } from "lucide-react";

import { rpcError } from "../../../api/clients";
import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { lookupLabel } from "../../../features/picking/labelLookup";
import { ScanInput } from "../../../features/picking/ScanInput";
import { useShopsByIds } from "../../../features/shops/queries";
import { useIsMobile } from "../../../layouts/shell";
import { beep } from "../../../lib/beep";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { WarehouseStatusBadge } from "./WarehouseStatusBadge";

export const description =
  "Scan Label: the crew scans a parcel's label — its tracking number, marketplace ref or order id — and the code is looked up on the server among this warehouse's orders. One live order opens its pick page; several are listed and none opens; none, or only cancelled ones, is the wrong sound and a message.";

type Answer =
  | { state: "searching"; code: string }
  | { state: "none"; code: string }
  | { state: "cancelled"; code: string; cancelled: Order[] }
  | { state: "several"; code: string; live: Order[] }
  | { state: "failed"; code: string; error: string };

// SCAN LABEL OPENS THE PICK PAGE (scan-label-opens-the-pick-page) — the crew's way into an order, from the list's header:
//
//   scan ──▶ lookupLabel (this warehouse's orders: tracking number · marketplace ref · id, cancelled skipped)
//              ├ one live order       → its pick page opens: racks for the walk, then the item scans, then Set Picked
//              ├ several              → all listed, NONE opened — the crew asks the selling team or the warehouse
//              │                        admin (two-orders-on-one-label-are-shown-not-chosen), then opens the one to work
//              └ none / only cancelled → the wrong sound and a sentence; nothing opens
//
// The list's search box stays a search, not a scan field.
export function ScanLabelDialog({
  open,
  warehouseId,
  onClose,
}: {
  open: boolean;
  warehouseId: bigint | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [answer, setAnswer] = useState<Answer | null>(null);
  // The newest scan wins: an answer to an earlier one that lands late is dropped.
  const latest = useRef(0);

  const several = answer?.state === "several" ? answer.live : [];
  const shops = useShopsByIds({ shopIds: several.map((order) => order.shopId) }).data;

  function close() {
    latest.current += 1;
    setAnswer(null);
    onClose();
  }

  function openOrder(order: Order) {
    close();
    navigate(`/warehouse-orders/${order.id}`);
  }

  async function scan(code: string) {
    if (warehouseId === undefined) return;

    const ask = ++latest.current;
    setAnswer({ state: "searching", code });

    try {
      const { live, cancelled } = await lookupLabel(warehouseId, code);
      if (ask !== latest.current) return;

      if (live.length === 1) {
        beep("fulfilled");
        openOrder(live[0]!);
        return;
      }

      beep("wrong");
      if (live.length > 1) setAnswer({ state: "several", code, live });
      else if (cancelled.length > 0) setAnswer({ state: "cancelled", code, cancelled });
      else setAnswer({ state: "none", code });
    } catch (err) {
      if (ask !== latest.current) return;

      beep("wrong");
      setAnswer({ state: "failed", code, error: rpcError(err) });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && close()} size={isMobile ? "full" : "lg"} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="scan-label-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("warehouseOrders.scanLabel.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="field">
                <Text fontSize="sm" color="fg.muted">
                  {t("warehouseOrders.scanLabel.help")}
                </Text>

                <ScanInput onScan={(code) => void scan(code)} testId="scan-label-input" label={t("warehouseOrders.scanLabel.title")} />

                {answer && (
                  <Box data-testid="scan-label-result" data-state={answer.state}>
                    {answer.state === "searching" && (
                      <Flex align="center" gap="2" color="fg.muted">
                        <Spinner size="sm" />
                        <Text fontSize="sm">{t("warehouseOrders.scanLabel.searching", { code: answer.code })}</Text>
                      </Flex>
                    )}

                    {answer.state === "none" && (
                      <Flex align="flex-start" gap="3" py="2">
                        <Icon as={SearchX} boxSize="5" color="error.fg" flexShrink={0} />
                        <Text fontWeight="bold" color="error.fg">
                          {t("warehouseOrders.scanLabel.none", { code: answer.code })}
                        </Text>
                      </Flex>
                    )}

                    {answer.state === "cancelled" && (
                      <Flex align="flex-start" gap="3" py="2">
                        <Icon as={PackageX} boxSize="5" color="error.fg" flexShrink={0} />
                        <Text fontWeight="bold" color="error.fg">
                          {t("warehouseOrders.scanLabel.cancelledOnly", {
                            code: answer.code,
                            orders: answer.cancelled.map((order) => `#${order.id}`).join(", "),
                          })}
                        </Text>
                      </Flex>
                    )}

                    {answer.state === "failed" && (
                      <Text color="error.fg" fontSize="sm">
                        {t("warehouseOrders.scanLabel.failed")} {answer.error}
                      </Text>
                    )}

                    {answer.state === "several" && (
                      <Stack gap="card">
                        <Alert.Root status="warning" size="sm" data-testid="scan-label-several">
                          <Alert.Indicator />
                          <Alert.Title>{t("warehouseOrders.scanLabel.several", { code: answer.code })}</Alert.Title>
                        </Alert.Root>

                        {answer.live.map((order) => (
                          <Flex
                            key={order.id.toString()}
                            align="center"
                            gap="3"
                            wrap="wrap"
                            borderWidth="1px"
                            borderColor="border.muted"
                            rounded="md"
                            px="3"
                            py="2"
                            data-testid={`scan-label-match-${order.id}`}
                          >
                            <Stack gap="0.5" flex="1" minW="0">
                              <Flex align="center" gap="2" wrap="wrap">
                                <Text fontWeight="bold">#{order.id.toString()}</Text>
                                <WarehouseStatusBadge status={order.status} />
                              </Flex>
                              {/* What tells them apart: the shop, when it was written down, how many units. */}
                              <Text fontSize="sm" color="fg.muted" lineClamp={1}>
                                {[
                                  shops?.get(order.shopId.toString())?.name ?? "—",
                                  formatUnixDateTimeShort(order.createdAtUnix),
                                  t("warehouseOrders.scanLabel.units", { count: Number(order.itemQuantity) }),
                                ].join(" · ")}
                              </Text>
                            </Stack>
                            <Button
                              size="xs"
                              variant="outline"
                              data-testid={`scan-label-open-${order.id}`}
                              onClick={() => openOrder(order)}
                            >
                              {t("warehouseOrders.scanLabel.open")}
                              <Icon as={ArrowRight} boxSize="4" />
                            </Button>
                          </Flex>
                        ))}
                      </Stack>
                    )}
                  </Box>
                )}
              </Stack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
