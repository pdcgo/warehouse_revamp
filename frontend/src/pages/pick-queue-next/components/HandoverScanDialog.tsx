import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, CloseButton, Dialog, Flex, Portal, Stack, Switch, Text } from "@chakra-ui/react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { useOrders } from "../../../features/orders/queries";
import { mockReceiptCode } from "../../../features/orders/rowMock";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { beep } from "../../../lib/beep";
import { WAREHOUSE_ORDERS_PENDING } from "../pending";
import { stepLabelKey, stepOfStatus } from "../steps";
import { useStepMove } from "../useStepMove";
import { ScanInput } from "./ScanInput";

// HANDING PARCELS TO THE COURIER, ONE SCAN AT A TIME (owner — `scanning-is-the-crews-hands`).
//
// Only a Dikemas order may be handed over; the end state is Sudah diserahkan (SHIPPED in the build).
//
//   Ambil massal OFF  every good scan is handed over at once
//   Ambil massal ON   scans collect into the list; one button hands them over together
//
// Rules the owner gave, each a line below:
//   • a parcel at another step is marked as an ERROR, with the wrong sound
//   • the same label scanned twice is not added twice — only the fulfilled sound
//   • the mass button is off while the list holds no parcel that can be handed over
//   • no proof or manifest is printed
type EntryState = "ready" | "wrongStep" | "notFound" | "handedOver" | "failed";

interface Entry {
  code: string;
  order?: Order;
  state: EntryState;
  /** The step a wrong-step parcel is at, named. */
  stepKey?: string;
}

const STATE_PALETTE: Record<EntryState, string> = {
  ready: "primary",
  handedOver: "success",
  wrongStep: "error",
  notFound: "error",
  failed: "error",
};

export function HandoverScanDialog({
  open,
  warehouseId,
  onClose,
}: {
  open: boolean;
  warehouseId: bigint | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { move } = useStepMove(warehouseId);
  const [mass, setMass] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ⚠ WHERE A LABEL IS LOOKED UP (`resiLookup`): no RPC finds an order by its tracking number, so the
  // dialog reads the warehouse's orders once and matches the label against them.
  const lookup = useOrders({
    teamId: open ? warehouseId : undefined,
    page: 1,
    pageSize: 200,
    status: OrderStatus.UNSPECIFIED,
  });
  const byLabel = useMemo(() => {
    const map = new Map<string, Order>();
    for (const order of lookup.data?.orders ?? []) {
      map.set(mockReceiptCode(order.id, order.status), order);
      if (order.orderExternalRefId) map.set(order.orderExternalRefId, order);
    }
    return map;
  }, [lookup.data]);

  const ready = entries.filter((entry) => entry.state === "ready");

  function close() {
    setEntries([]);
    onClose();
  }

  async function scan(code: string) {
    // The same label twice is not a second parcel.
    if (entries.some((entry) => entry.code === code)) {
      beep("fulfilled");
      return;
    }

    const order = byLabel.get(code);

    if (!order) {
      beep("wrong");
      setEntries((prev) => [{ code, state: "notFound" }, ...prev]);
      return;
    }

    if (order.status !== OrderStatus.PACKED) {
      beep("wrong");
      const step = stepOfStatus(order.status);
      setEntries((prev) => [
        { code, order, state: "wrongStep", stepKey: step ? stepLabelKey(step) : undefined },
        ...prev,
      ]);
      return;
    }

    if (mass) {
      beep("fulfilled");
      setEntries((prev) => [{ code, order, state: "ready" }, ...prev]);
      return;
    }

    const moved = await move(order, "handover", true);
    beep(moved ? "fulfilled" : "wrong");
    setEntries((prev) => [{ code, order, state: moved ? "handedOver" : "failed" }, ...prev]);
  }

  async function handOverAll() {
    setSubmitting(true);
    let done = 0;

    // ⚠ ONE CALL PER PARCEL (`bulkHandover`) — there is no bulk RPC yet.
    for (const entry of ready) {
      const moved = entry.order ? await move(entry.order, "handover", true) : false;
      if (moved) done += 1;
      setEntries((prev) =>
        prev.map((item) => (item.code === entry.code ? { ...item, state: moved ? "handedOver" : "failed" } : item)),
      );
    }

    setSubmitting(false);
    beep(done === ready.length ? "fulfilled" : "wrong");
    toaster.create({ type: done > 0 ? "success" : "error", title: t("warehouseOrders.handover.done", { count: done }) });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && close()} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="handover-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("warehouseOrders.handover.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="field">
                <Flex align="center" gap="3" wrap="wrap">
                  <Switch.Root checked={mass} onCheckedChange={(e) => setMass(e.checked)} data-testid="handover-mass">
                    <Switch.HiddenInput />
                    <Switch.Control />
                    <Switch.Label>{t("warehouseOrders.handover.mass")}</Switch.Label>
                  </Switch.Root>
                  <Text fontSize="xs" color="fg.muted">
                    {mass ? t("warehouseOrders.handover.massOn") : t("warehouseOrders.handover.massOff")}
                  </Text>
                </Flex>

                <Flex align="center" gap="1">
                  <ScanInput onScan={(code) => void scan(code)} testId="handover-scan" />
                  <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="resiLookup" />
                </Flex>

                {entries.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    {t("warehouseOrders.handover.empty")}
                  </Text>
                ) : (
                  <Stack gap="1" data-testid="handover-entries">
                    {entries.map((entry) => (
                      <Flex
                        key={entry.code}
                        align="center"
                        gap="3"
                        px="3"
                        py="2"
                        borderRadius="l2"
                        bg={STATE_PALETTE[entry.state] === "error" ? "error.subtle" : "bg.subtle"}
                        data-testid={`handover-entry-${entry.code}`}
                        data-state={entry.state}
                      >
                        <Text fontFamily="mono" fontSize="sm" flex="1" minW="0" lineClamp={1}>
                          {entry.code}
                        </Text>
                        <Badge colorPalette={STATE_PALETTE[entry.state]} variant="subtle">
                          {entry.state === "wrongStep"
                            ? t("warehouseOrders.handover.wrongStep", { step: entry.stepKey ? t(entry.stepKey) : "—" })
                            : t(`warehouseOrders.handover.${entry.state}`)}
                        </Badge>
                      </Flex>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Dialog.Body>

            {mass && (
              <Dialog.Footer>
                <Button
                  colorPalette="brand"
                  loading={submitting}
                  disabled={ready.length === 0}
                  data-testid="handover-submit"
                  onClick={() => void handOverAll()}
                >
                  {t("warehouseOrders.handover.submit", { count: ready.length })}
                  <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="bulkHandover" />
                </Button>
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
