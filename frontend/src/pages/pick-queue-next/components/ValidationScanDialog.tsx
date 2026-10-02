import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, CloseButton, Dialog, Flex, Portal, Spinner, Stack, Text } from "@chakra-ui/react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { useOrder } from "../../../features/orders/queries";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { beep } from "../../../lib/beep";
import { WAREHOUSE_ORDERS_PENDING } from "../pending";
import type { WarehouseStep } from "../steps";
import { rpcFor, stepLabelKey, stepOfStatus } from "../steps";
import { ScanInput } from "./ScanInput";

// PROVING EVERY LINE IS EXACT BEFORE THE ORDER MOVES ON (owner — `scanning-is-the-crews-hands`).
//
// While the goods are taken off the shelves, every item is scanned. A line counts up to what was ordered
// and no further; an item that is not on the order, or one too many, is an error with the wrong sound.
// The step can move on only when every line is exact — the scan is the check, not a formality.
//
// ⚠ PRODUCTS HAVE NO BARCODE (`barcode`): an item is matched by its SKU until they do.
export function ValidationScanDialog({
  order,
  warehouseId,
  onClose,
  onNext,
}: {
  order: Order | null;
  warehouseId: bigint | undefined;
  onClose: () => void;
  onNext: (order: Order, to: WarehouseStep) => void;
}) {
  const { t } = useTranslation();
  // The lines are not in a list result — they are read for this one order.
  const detail = useOrder({ teamId: order ? warehouseId : undefined, orderId: order?.id ?? 0n });
  const items = detail.data?.items ?? [];

  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [problem, setProblem] = useState("");

  const from = order ? stepOfStatus(order.status) : undefined;
  // The next step forward: Sedang diambil → Sudah diambil, Sudah diambil → Dikemas.
  const next: WarehouseStep | undefined = from === "picking" ? "picked" : from === "picked" ? "packed" : undefined;

  const complete = useMemo(
    () => items.length > 0 && items.every((item) => (counts.get(String(item.id)) ?? 0) === item.quantity),
    [items, counts],
  );

  function scan(code: string) {
    const item = items.find((line) => line.sku.toLowerCase() === code.toLowerCase());

    if (!item) {
      beep("wrong");
      setProblem(t("warehouseOrders.validate.unknown", { code }));
      return;
    }

    const have = counts.get(String(item.id)) ?? 0;

    if (have >= item.quantity) {
      beep("wrong");
      setProblem(`${item.name} — ${t("warehouseOrders.validate.over")}`);
      return;
    }

    beep("fulfilled");
    setProblem("");
    setCounts((prev) => new Map(prev).set(String(item.id), have + 1));
  }

  function close() {
    setCounts(new Map());
    setProblem("");
    onClose();
  }

  return (
    <Dialog.Root open={order !== null} onOpenChange={(e) => !e.open && close()} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="validate-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("warehouseOrders.validate.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="field">
                <Flex align="center" gap="1">
                  <Text fontSize="sm" color="fg.muted">
                    {t("warehouseOrders.validate.help")}
                  </Text>
                  <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="barcode" />
                </Flex>

                <ScanInput onScan={scan} testId="validate-scan" />

                {problem && (
                  <Text color="error.fg" fontSize="sm" fontWeight="bold" data-testid="validate-problem">
                    {problem}
                  </Text>
                )}

                {detail.isPending ? (
                  <Flex align="center" gap="2" color="fg.muted">
                    <Spinner size="sm" />
                    <Text fontSize="sm">{t("warehouseOrders.validate.loading")}</Text>
                  </Flex>
                ) : (
                  <Stack gap="1" data-testid="validate-lines">
                    {items.map((item) => {
                      const have = counts.get(String(item.id)) ?? 0;
                      const exact = have === item.quantity;

                      return (
                        <Flex
                          key={String(item.id)}
                          align="center"
                          gap="3"
                          px="3"
                          py="2"
                          borderRadius="l2"
                          bg={exact ? "success.subtle" : "bg.subtle"}
                          data-testid={`validate-line-${item.sku}`}
                          data-exact={exact ? "true" : undefined}
                        >
                          <Stack gap="0" flex="1" minW="0">
                            <Text fontSize="sm" lineClamp={1}>
                              {item.name}
                            </Text>
                            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                              {item.sku}
                            </Text>
                          </Stack>
                          <Badge colorPalette={exact ? "success" : "gray"} variant="subtle" size="lg">
                            {have} / {item.quantity}
                          </Badge>
                        </Flex>
                      );
                    })}
                  </Stack>
                )}

                {complete && (
                  <Text color="success.fg" fontWeight="bold" data-testid="validate-complete">
                    {t("warehouseOrders.validate.complete")}
                  </Text>
                )}
              </Stack>
            </Dialog.Body>

            {next && from && (
              <Dialog.Footer>
                <Button
                  colorPalette="brand"
                  disabled={!complete}
                  data-testid="validate-next"
                  onClick={() => {
                    if (order) onNext(order, next);
                    close();
                  }}
                >
                  {t("warehouseOrders.validate.next", { step: t(stepLabelKey(next)) })}
                  {rpcFor(from, next) === undefined && <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="stepMove" />}
                </Button>
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
