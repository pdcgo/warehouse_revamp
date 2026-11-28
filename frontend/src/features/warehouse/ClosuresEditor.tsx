import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Field, Flex, Heading, HStack, Icon, IconButton, Input, Stack, Text } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

import { rpcError, warehouseInfoClient } from "../../api/clients";
import type { WarehouseClosure } from "../../gen/warehouse/warehouse/v1/warehouse_info_pb";
import { useInvalidateWarehouseInfo } from "./queries";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { DatePicker } from "../../components/datetime/DatePicker";
import { toaster } from "../../components/feedback/Toaster";

// ONE-OFF CLOSURES (a-warehouse-records-its-holidays) — a holiday, a stock-take: whole days, both inclusive, with the
// reason the order form's closed-day warning names. Edited by whoever edits the hours, one at a time — each is saved on
// its own, so it sits outside the hours form's Save. It refuses nothing: it only changes the warning. ONE editor for
// both doors (the-warehouse-sets-its-own-hours-in-settings): root's Teams → Edit warehouse, and the warehouse owner's and
// admin's own Settings.
//
// THE LIST IS THE PAGE'S READ — `closures` comes from the page's WarehouseInfoDetail (useWarehouseInfo), the one read of
// the warehouse's profile a load (#122; it used to ask for it again here). A write re-reads that profile AND the
// warehouse's receiving state — both under its `warehouseInfo` key — so the list and the order form's closed-day warning
// move together.
export function ClosuresEditor({ warehouseId, closures }: { warehouseId: bigint; closures: WarehouseClosure[] }) {
  const { t } = useTranslation();
  const invalidateWarehouseInfo = useInvalidateWarehouseInfo();

  const [firstDay, setFirstDay] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [reason, setReason] = useState("");

  const invalidate = () => invalidateWarehouseInfo(warehouseId);

  const add = useMutation({
    mutationFn: () => warehouseInfoClient.warehouseClosureAdd({ teamId: warehouseId, firstDay, lastDay, reason: reason.trim() }),
    onSuccess: () => invalidate(),
  });
  const remove = useMutation({
    mutationFn: (closureId: bigint) => warehouseInfoClient.warehouseClosureDelete({ teamId: warehouseId, closureId }),
    onSuccess: () => invalidate(),
  });

  const ready = firstDay !== "" && lastDay !== "" && firstDay <= lastDay && reason.trim() !== "";

  async function submit() {
    try {
      await add.mutateAsync();
      toaster.create({ type: "success", title: t("warehouseHours.closureAdded") });
      setFirstDay("");
      setLastDay("");
      setReason("");
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseHours.closureAddFailed"), description: rpcError(err) });
    }
  }

  async function del(closureId: bigint) {
    try {
      await remove.mutateAsync(closureId);
      toaster.create({ type: "success", title: t("warehouseHours.closureDeleted") });
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseHours.closureDeleteFailed"), description: rpcError(err) });
    }
  }

  return (
    <Card.Root data-testid="warehouse-closures">
      <Card.Body>
        <Stack gap="field">
          <Stack gap="0.5">
            <Heading size="sm">{t("warehouseHours.closuresTitle")}</Heading>
            <Text fontSize="xs" color="fg.muted">
              {t("warehouseHours.closuresHelp")}
            </Text>
          </Stack>

          {closures.length === 0 ? (
            <Text fontSize="sm" color="fg.muted" data-testid="warehouse-closures-empty">
              {t("warehouseHours.closuresEmpty")}
            </Text>
          ) : (
            <Stack gap="1">
              {closures.map((c) => (
                <HStack key={c.id.toString()} justify="space-between" data-testid={`warehouse-closure-${c.id}`}>
                  <Text fontSize="sm">
                    {c.firstDay === c.lastDay ? c.firstDay : `${c.firstDay} – ${c.lastDay}`} · {c.reason}
                  </Text>
                  <ConfirmDialog
                    title={t("warehouseHours.closureDeleteTitle")}
                    message={t("warehouseHours.closureDeleteMessage", { reason: c.reason })}
                    confirmLabel={t("warehouseHours.closureDeleteConfirm")}
                    onConfirm={() => del(c.id)}
                    trigger={
                      <IconButton size="xs" variant="ghost" aria-label={t("warehouseHours.closureDeleteTitle")} data-testid={`warehouse-closure-delete-${c.id}`}>
                        <Icon as={Trash2} boxSize="4" />
                      </IconButton>
                    }
                  />
                </HStack>
              ))}
            </Stack>
          )}

          <Flex gap="field" wrap="wrap" align="end">
            <Field.Root required w="auto">
              <Field.Label>{t("warehouseHours.firstDay")}</Field.Label>
              <DatePicker value={firstDay} onChange={setFirstDay} testId="closure-first-day" />
            </Field.Root>
            <Field.Root required w="auto">
              <Field.Label>{t("warehouseHours.lastDay")}</Field.Label>
              <DatePicker value={lastDay} onChange={setLastDay} testId="closure-last-day" />
            </Field.Root>
            <Field.Root required flex="1" minW="48">
              <Field.Label>{t("warehouseHours.reason")}</Field.Label>
              <Input
                value={reason}
                placeholder={t("warehouseHours.reasonPlaceholder")}
                onChange={(e) => setReason(e.target.value)}
                data-testid="closure-reason"
              />
            </Field.Root>
            <Button size="xs" colorPalette="brand" disabled={!ready} loading={add.isPending} onClick={submit} data-testid="closure-add">
              <Icon as={Plus} boxSize="4" />
              {t("warehouseHours.addClosure")}
            </Button>
          </Flex>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
