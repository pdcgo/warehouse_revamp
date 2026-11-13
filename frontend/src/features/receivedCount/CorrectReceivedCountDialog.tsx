import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  CloseButton,
  Dialog,
  Drawer,
  Field,
  Flex,
  HStack,
  Portal,
  Select,
  Stack,
  Text,
  Textarea,
  createListCollection,
} from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CharCount } from "../../components/inputs/CharCount";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { RackSelect } from "../../components/pickers/RackSelect";
import { useIsMobile } from "../../layouts/shell";
import { useRackCodes } from "../racks/queries";
import { type CountLine, type LineDraft, type LineEffect, defaultFromRack, lineEffect } from "./rules";

export const description =
  "Koreksi Jumlah Terima / Correct Received Count: the receiving warehouse's Owner or Admin (or Root) types the real count of each line of an accepted restock or transfer; units out leave the batch as Missing (correction), units in go into the same batch; a rack for the units; a required reason; refusals inline, then the server's own; units only, no money; a confirm before it posts. A bottom sheet on a phone.";

/** The reason's limit — as Koreksi Harga's (a-limited-field-shows-its-count), and the request's `max_len`. */
export const REASON_MAX = 200;

export type CorrectionSubject = "restock" | "transfer";

/** A line as the page reads it — its batch and racks from the detail's `correction_facts` (the receiving warehouse's). */
export type CorrectableLine = CountLine;

/** One changed line as the write takes it (ReceivedCountLine): the count the form SHOWED, the real one, the rack. */
export interface CorrectedLineInput {
  itemId: bigint;
  expectedReceivedCount: bigint;
  receivedCount: bigint;
  placementId: bigint;
}

// KOREKSI JUMLAH TERIMA (the-warehouse-corrects-a-wrong-stock-in-alone, a-stock-in-correction-keeps-the-batch-price,
// a-wrong-stock-in-is-a-received-count-correction) — the receiving warehouse says how many the box REALLY held, line by
// line, and why. Applied at once, no approval; never rolled back, so Simpan asks first (as Koreksi Harga does).
//
//   Koreksi Jumlah Terima                                                         ×
//   Restok SCP5544332211
//   Ketik berapa yang benar-benar ada di kotak. …
//   ┌ Teh Melati 100g · SKU-TEH-100 ────────────────────────────────────────────┐
//   │ Dipesan 20 · Diterima 20                    Jumlah sebenarnya [−][18][+]   │
//   │ Batch #5032 · masih 17 di gudang ini                                       │
//   │ 2 Kurang (koreksi) — keluar dari batch #5032   Diambil dari rak [A-01-2 ▾] │
//   └────────────────────────────────────────────────────────────────────────────┘
//   Alasan *  [                                                     ]  0/200
//                                                      [Batal] [Simpan Koreksi]
//
// UNITS ONLY — the batch's price is the selling team's money (a-warehouse-sees-no-seller-money); the units it moves are
// the warehouse's to say. Each refusal sits under its line, as typed (rules.ts); what only the server can judge (a stale
// form, a rack a running count holds) comes back as its own words, at the foot of the form.
//
// THE FORM IS A SNAPSHOT: the lines as they read when it opened. Each changed line is sent with that count as
// `expected_received_count`, so a line someone else corrected meanwhile is refused as stale, never overwritten unseen.
export function CorrectReceivedCountDialog({
  subject,
  warehouseId,
  subtitle,
  lines,
  open,
  onOpenChange,
  onSubmit,
}: {
  subject: CorrectionSubject;
  /** The receiving warehouse — whose racks. */
  warehouseId: bigint;
  subtitle: string;
  lines: CorrectableLine[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Posts the correction — the restock's or the transfer's RPC. Throws the server's refusal. */
  onSubmit: (lines: CorrectedLineInput[], reason: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const codes = useRackCodes({ warehouseId, enabled: open });

  const fresh = (from: CountLine[]) =>
    Object.fromEntries(
      from.map((l) => [l.lineId.toString(), { real: l.received.toString(), fromRack: defaultFromRack(l), toRack: "" }]),
    ) as Record<string, LineDraft>;

  const [countLines, setCountLines] = useState<CountLine[]>(lines);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() => fresh(lines));
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState("");

  // A fresh form each time it opens — the lines as they read NOW, never the last attempt's half-typed counts.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCountLines(lines);
      setDrafts(fresh(lines));
      setReason("");
      setReasonTouched(false);
      setRefusal("");
    }
  }

  const draftOf = (l: CountLine): LineDraft =>
    drafts[l.lineId.toString()] ?? { real: l.received.toString(), fromRack: defaultFromRack(l), toRack: "" };
  const effects = countLines.map((l) => ({ line: l, effect: lineEffect(l, draftOf(l)) }));
  const changed = effects.filter((e) => e.effect.out !== 0n);
  const refused = effects.some((e) => e.effect.refusal.kind !== "none");
  const reasonMissing = reason.trim() === "";
  const canSave = changed.length > 0 && !refused && !reasonMissing;

  const set = (l: CountLine, patch: Partial<LineDraft>) => {
    setRefusal("");
    setDrafts((prev) => ({ ...prev, [l.lineId.toString()]: { ...draftOf(l), ...patch } }));
  };
  const code = (rackId: bigint) => codes.data?.[rackId.toString()] ?? `#${rackId}`;
  const close = () => onOpenChange(false);

  // Only the CHANGED lines go (a line left as it was is not sent), each with the count this form showed.
  async function confirm() {
    const list: CorrectedLineInput[] = changed.map(({ line, effect }) => {
      const draft = draftOf(line);

      return {
        itemId: line.lineId,
        expectedReceivedCount: line.received,
        receivedCount: effect.real,
        placementId: BigInt(effect.out > 0n ? draft.fromRack : draft.toRack),
      };
    });

    try {
      await onSubmit(list, reason.trim());
    } catch (err) {
      // The server's own words, in the form — the confirm closes, the form stays as typed.
      setRefusal(rpcError(err));
      return;
    }

    toaster.create({ type: "success", title: t("receivedCount.saved") });
    close();
  }

  const refusalText = (e: LineEffect): string => {
    const r = e.refusal;
    switch (r.kind) {
      case "belowBroken":
        return t("receivedCount.error.belowBroken", { count: Number(r.broken) });
      case "overCeiling":
        return subject === "restock"
          ? t("receivedCount.error.overOrdered", { count: Number(r.ceiling) })
          : t("receivedCount.error.overSent", { count: Number(r.ceiling) });
      case "overBatch":
        return t("receivedCount.error.overBatch", { id: r.batchId.toString(), count: Number(r.holds) });
      case "overRack":
        return t("receivedCount.error.overRack", { code: code(r.rackId), count: Number(r.holds) });
      case "noRack":
        return t("receivedCount.error.noRack");
      default:
        return "";
    }
  };

  const lineBlock = ({ line, effect }: { line: CountLine; effect: LineEffect }) => {
    const id = line.lineId.toString();
    const draft = draftOf(line);
    const error = refusalText(effect);
    // The count itself is wrong (not the rack): the effect line would describe an act that cannot happen.
    const countRefused = ["belowBroken", "overCeiling", "overBatch"].includes(effect.refusal.kind);

    return (
      <Stack key={id} gap="2" borderWidth="1px" borderColor="border" borderRadius="md" p="card" data-testid={`rc-line-${id}`}>
        <Flex justify="space-between" align="start" gap="card" wrap="wrap">
          <Stack gap="0" minW="0" flex="1">
            <Text fontWeight="bold" lineClamp={2}>
              {line.name}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {line.productCode}
            </Text>
            <Text fontSize="sm" color="fg.muted" pt="1" data-testid={`rc-line-${id}-facts`}>
              {subject === "restock"
                ? t("receivedCount.ordered", { count: Number(line.ceiling) })
                : t("receivedCount.sent", { count: Number(line.ceiling) })}
              {" · "}
              {t("receivedCount.accepted", { count: Number(line.received) })}
              {line.broken > 0n && ` · ${t("receivedCount.broken", { count: Number(line.broken) })}`}
            </Text>
          </Stack>
          <Field.Root invalid={countRefused} w="auto" flexShrink={0}>
            <Field.Label fontSize="xs">{t("receivedCount.real")}</Field.Label>
            <QuantityInput
              value={draft.real}
              onChange={(v) => set(line, { real: v })}
              min={0}
              size="sm"
              width="16"
              aria-label={t("receivedCount.realOf", { name: line.name })}
              testId={`rc-line-${id}-real`}
            />
          </Field.Root>
        </Flex>

        {/* HOW MANY THE BATCH STILL HOLDS — the ceiling of units out (a-stock-in-correction-keeps-the-batch-price). A line
            that came in with no good unit has no batch yet: units in start one at the line's price. */}
        <Text fontSize="xs" color="fg.muted" data-testid={`rc-line-${id}-batch`}>
          {line.batchId === 0n
            ? t("receivedCount.noBatch")
            : t("receivedCount.batchHolds", { id: line.batchId.toString(), count: Number(line.batchHolds) })}
        </Text>

        {effect.out !== 0n && !countRefused && (
          <Flex justify="space-between" align={isMobile ? "stretch" : "center"} gap="2" direction={isMobile ? "column" : "row"}>
            <Text
              fontSize="sm"
              fontWeight="semibold"
              color={effect.out > 0n ? "warning.fg" : "success.fg"}
              data-testid={`rc-line-${id}-effect`}
            >
              {effect.out > 0n
                ? t("receivedCount.effect.out", { count: Number(effect.out), id: line.batchId.toString() })
                : line.batchId === 0n
                  ? t("receivedCount.effect.inNew", { count: Number(-effect.out) })
                  : t("receivedCount.effect.in", { count: Number(-effect.out), id: line.batchId.toString() })}
            </Text>
            <Field.Root w={isMobile ? "full" : "56"} flexShrink={0} invalid={effect.refusal.kind === "noRack" || effect.refusal.kind === "overRack"}>
              <Field.Label fontSize="xs">{effect.out > 0n ? t("receivedCount.fromRack") : t("receivedCount.toRack")}</Field.Label>
              {effect.out > 0n ? (
                <ShelfSelect
                  shelves={line.shelves}
                  value={draft.fromRack}
                  onChange={(v) => set(line, { fromRack: v })}
                  label={(rackId, units) => t("receivedCount.rackOption", { code: code(rackId), count: Number(units) })}
                  placeholder={t("receivedCount.rackPlaceholder")}
                  testId={`rc-line-${id}-from`}
                />
              ) : (
                // The real units go ONTO a rack — there is no unplaced pile (there-is-no-unplaced-pile).
                <RackSelect
                  warehouseId={warehouseId}
                  value={draft.toRack}
                  onChange={(v) => set(line, { toRack: v })}
                  allowUnplaced={false}
                  placeholder={t("receivedCount.rackPlaceholder")}
                  testId={`rc-line-${id}-to`}
                />
              )}
            </Field.Root>
          </Flex>
        )}

        {error && (
          <Text fontSize="sm" color="error.fg" data-testid={`rc-line-${id}-error`}>
            {error}
          </Text>
        )}
      </Stack>
    );
  };

  const body = (
    <Stack gap="field">
      <Stack gap="1">
        <Text fontSize="sm" color="fg.muted" data-testid="rc-subtitle">
          {subtitle}
        </Text>
        <Text fontSize="sm">{t("receivedCount.intro")}</Text>
      </Stack>

      <Stack gap="3" data-testid="rc-lines">
        {effects.map(lineBlock)}
      </Stack>

      <Field.Root required invalid={reasonTouched && reasonMissing}>
        <Field.Label>{t("receivedCount.reason")}</Field.Label>
        <Textarea
          rows={2}
          value={reason}
          maxLength={REASON_MAX}
          placeholder={t("receivedCount.reasonPlaceholder")}
          data-testid="rc-reason"
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setReasonTouched(true)}
        />
        <HStack justify="space-between" align="start" gap="2" w="full">
          {reasonTouched && reasonMissing ? (
            <Field.ErrorText data-testid="rc-reason-error">{t("receivedCount.error.reasonRequired")}</Field.ErrorText>
          ) : (
            // Who reads it — the selling team, in the history (the-warehouse-corrects-a-wrong-stock-in-alone).
            <Field.HelperText>{t("receivedCount.reasonHelper")}</Field.HelperText>
          )}
          <CharCount value={reason} max={REASON_MAX} testId="rc-reason-count" />
        </HStack>
      </Field.Root>

      {refusal !== "" && (
        // WHAT ONLY THE SERVER COULD JUDGE — a stale line, a rack a running count holds — in its own words.
        <Alert.Root status="error" data-testid="rc-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("receivedCount.failed")}</Alert.Title>
            <Alert.Description>{refusal}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {changed.length === 0 && (
        <Alert.Root status="info" data-testid="rc-unchanged">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{t("receivedCount.error.unchanged")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      <Text fontSize="xs" color="fg.muted">
        {t("receivedCount.sold")}
      </Text>
    </Stack>
  );

  // Batal and Simpan — on a phone two equal halves of the width, under the thumb.
  const halves = isMobile ? "1" : undefined;
  const buttons = (
    <HStack gap="2" justify="end" w={isMobile ? "full" : undefined}>
      <Button variant="outline" flex={halves} data-testid="rc-cancel" onClick={close}>
        {t("common.cancel")}
      </Button>
      <Button colorPalette="brand" flex={halves} disabled={!canSave} data-testid="rc-save" onClick={() => setConfirming(true)}>
        {t("receivedCount.save")}
      </Button>
    </HStack>
  );

  // ASKED FIRST — it is never rolled back (a-rollback-only-undoes-a-take); what it will do, in units.
  const confirmDialog = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      destructive={false}
      title={t("receivedCount.confirm.title")}
      message={t("receivedCount.confirm.message", {
        lines: changed
          .map(({ line, effect }) =>
            t("receivedCount.confirm.line", { name: line.name, from: line.received.toString(), to: effect.real.toString() }),
          )
          .join("; "),
      })}
      confirmLabel={t("receivedCount.save")}
      dismissLabel={t("receivedCount.confirm.dismiss")}
      onConfirm={confirm}
    />
  );

  if (isMobile) {
    return (
      <>
        <Drawer.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="bottom" closeOnInteractOutside={false}>
          <Portal>
            <Drawer.Backdrop />
            <Drawer.Positioner>
              <Drawer.Content roundedTop="l3" maxH="90dvh" data-testid="rc-sheet">
                <Drawer.Header>
                  <Drawer.Title>{t("receivedCount.title")}</Drawer.Title>
                </Drawer.Header>
                <Drawer.Body data-testid="rc-dialog">{body}</Drawer.Body>
                <Drawer.Footer>{buttons}</Drawer.Footer>
                <Drawer.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} closeOnInteractOutside={false} size="lg" scrollBehavior="inside">
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content data-testid="rc-dialog">
              <Dialog.Header>
                <Dialog.Title>{t("receivedCount.title")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>{body}</Dialog.Body>
              <Dialog.Footer>{buttons}</Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
      {confirmDialog}
    </>
  );
}

/** The racks this batch is on, with how many of it each holds — where units out come off (a-shelf-never-goes-below-zero). */
function ShelfSelect({
  shelves,
  value,
  onChange,
  label,
  placeholder,
  testId,
}: {
  shelves: { rackId: bigint; units: bigint }[];
  value: string;
  onChange: (value: string) => void;
  label: (rackId: bigint, units: bigint) => string;
  placeholder: string;
  testId: string;
}) {
  const collection = useMemo(
    () => createListCollection({ items: shelves.map((s) => ({ label: label(s.rackId, s.units), value: s.rackId.toString() })) }),
    [shelves, label],
  );

  return (
    <Select.Root
      collection={collection}
      value={value === "" ? [] : [value]}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked !== undefined) onChange(picked);
      }}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText placeholder={placeholder} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      {/* Inline, not portalled — inside the modal, as RackSelect. */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`${testId}-option-${item.value}`}>
              <Box flex="1">
                <Select.ItemText>{item.label}</Select.ItemText>
              </Box>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
