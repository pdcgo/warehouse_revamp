import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, CloseButton, Dialog, Flex, Portal, Stack, Switch, Text } from "@chakra-ui/react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { lookupLabel } from "../../../features/picking/labelLookup";
import { ScanInput } from "../../../features/picking/ScanInput";
import { beep } from "../../../lib/beep";
import { stepLabelKey, stepOfStatus } from "../steps";
import { useStepMove } from "../useStepMove";

// HANDING PARCELS TO THE COURIER, ONE SCAN AT A TIME (owner — `scanning-is-the-crews-hands`).
//
// Only a Sudah diambil (picked) order may be handed over; the end state is Sudah diserahkan (shipping).
//
//   Ambil massal OFF  every good scan is handed over at once
//   Ambil massal ON   scans collect into the list; one button hands them over together
//
// Rules the owner gave, each a line below:
//   • a parcel at another step is marked as an ERROR, with the wrong sound
//   • the same label scanned twice is not added twice — only the fulfilled sound
//   • the mass button is off while the list holds no parcel that can be handed over
//   • no proof or manifest is printed
//
// THE LABEL IS LOOKED UP ON THE SERVER, per scan, among this warehouse's orders (lookupLabel — the-warehouse-order-list-
// is-accepted closed `resiLookup`): no longer the 200 orders the dialog had loaded. A code that is SEVERAL live orders
// hands NONE over — each is shown and the crew asks the selling team or the warehouse admin
// (two-orders-on-one-label-are-shown-not-chosen); a cancelled one is skipped, so a live order beside its cancelled twin is
// handed over as the only one.
type EntryState = "ready" | "wrongStep" | "notFound" | "several" | "handedOver" | "failed";

interface Entry {
  code: string;
  order?: Order;
  state: EntryState;
  /** The step a wrong-step parcel is at, named. */
  stepKey?: string;
  /** Every live order a code of several is — shown, none handed over. */
  several?: Order[];
}

const STATE_PALETTE: Record<EntryState, string> = {
  ready: "primary",
  handedOver: "success",
  wrongStep: "error",
  notFound: "error",
  several: "warning",
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
  // The codes whose lookup is still on its way — a gun firing twice at one label must not hand it over twice.
  const asking = useRef(new Set<string>());

  const ready = entries.filter((entry) => entry.state === "ready");

  function close() {
    setEntries([]);
    asking.current.clear();
    onClose();
  }

  async function scan(code: string) {
    // The same label twice is not a second parcel.
    if (entries.some((entry) => entry.code === code) || asking.current.has(code) || warehouseId === undefined) {
      beep("fulfilled");
      return;
    }

    asking.current.add(code);
    try {
      await place(warehouseId, code);
    } finally {
      asking.current.delete(code);
    }
  }

  async function place(teamId: bigint, code: string) {
    let live: Order[];
    try {
      live = (await lookupLabel(teamId, code)).live;
    } catch {
      beep("wrong");
      setEntries((prev) => [{ code, state: "failed" }, ...prev]);
      return;
    }

    if (live.length === 0) {
      beep("wrong");
      setEntries((prev) => [{ code, state: "notFound" }, ...prev]);
      return;
    }

    // SEVERAL LIVE ORDERS ON ONE LABEL — every one shown, none handed over.
    if (live.length > 1) {
      beep("wrong");
      setEntries((prev) => [{ code, state: "several", several: live }, ...prev]);
      return;
    }

    const order = live[0]!;

    // The label's other barcode (its ref after its tracking number) is the same parcel, not a second one.
    if (entries.some((entry) => entry.order?.id === order.id)) {
      beep("fulfilled");
      return;
    }

    if (order.status !== OrderStatus.PICKED) {
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

    const [result] = await move([order], "handover", { quiet: true });
    const moved = result?.moved ?? false;
    beep(moved ? "fulfilled" : "wrong");
    setEntries((prev) => [{ code, order, state: moved ? "handedOver" : "failed" }, ...prev]);
  }

  async function handOverAll() {
    setSubmitting(true);
    // ONE CALL FOR THE BATCH (one-status-change-for-every-plain-move), each parcel with its own result.
    const batch = ready.filter((entry) => entry.order !== undefined);
    const results = await move(
      batch.map((entry) => entry.order!),
      "handover",
      { quiet: true },
    );
    const movedIds = new Set(results.filter((result) => result.moved).map((result) => String(result.orderId)));
    const done = movedIds.size;

    setEntries((prev) =>
      prev.map((item) =>
        batch.some((entry) => entry.code === item.code)
          ? { ...item, state: movedIds.has(String(item.order?.id)) ? "handedOver" : "failed" }
          : item,
      ),
    );

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

                <ScanInput onScan={(code) => void scan(code)} testId="handover-scan" label={t("warehouseOrders.handover.title")} />

                {entries.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    {t("warehouseOrders.handover.empty")}
                  </Text>
                ) : (
                  <Stack gap="1" data-testid="handover-entries">
                    {entries.map((entry) => (
                      <Stack
                        key={entry.code}
                        gap="1"
                        px="3"
                        py="2"
                        borderRadius="l2"
                        bg={
                          STATE_PALETTE[entry.state] === "error"
                            ? "error.subtle"
                            : STATE_PALETTE[entry.state] === "warning"
                              ? "warning.subtle"
                              : "bg.subtle"
                        }
                        data-testid={`handover-entry-${entry.code}`}
                        data-state={entry.state}
                      >
                        <Flex align="center" gap="3">
                          <Text fontFamily="mono" fontSize="sm" flex="1" minW="0" lineClamp={1}>
                            {entry.code}
                          </Text>
                          <Badge colorPalette={STATE_PALETTE[entry.state]} variant="subtle">
                            {entry.state === "wrongStep"
                              ? t("warehouseOrders.handover.wrongStep", { step: entry.stepKey ? t(entry.stepKey) : "—" })
                              : t(`warehouseOrders.handover.${entry.state}`)}
                          </Badge>
                        </Flex>
                        {/* Which orders the label is — the crew asks which one ships (two-orders-on-one-label-are-shown-not-chosen). */}
                        {entry.several && (
                          <Text fontSize="xs" color="fg.muted" data-testid={`handover-several-${entry.code}`}>
                            {t("warehouseOrders.handover.severalHint", {
                              orders: entry.several.map((order) => `#${order.id}`).join(", "),
                            })}
                          </Text>
                        )}
                      </Stack>
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
                </Button>
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
