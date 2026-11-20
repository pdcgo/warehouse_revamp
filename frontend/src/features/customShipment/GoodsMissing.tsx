import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  HStack,
  Icon,
  Portal,
  Separator,
  Spacer,
  Stack,
  Text,
  Textarea,
  Timeline,
} from "@chakra-ui/react";
import { PackageX, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import { canWrite, useTeam } from "../team/TeamContext";
import { useTeamsByIds } from "../teams/queries";
import { useActors } from "../users/queries";
import { UserItem } from "../../components/entity/UserItem";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { CompactActions } from "../../components/chrome/CompactActions";
import { CharCount } from "../../components/inputs/CharCount";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { toaster } from "../../components/feedback/Toaster";
import { formatUnixDateTime } from "../../lib/datetime";
import { useIsMobile } from "../../layouts/shell";
import type { CustomShipment, CustomShipmentPick, GoodsMissingLine, GoodsMissingNote } from "./customShipments";
import { CustomShipmentStatusBadge } from "./CustomShipmentBadges";
import { useReportGoodsMissing } from "./queries";

// *BARANG TIDAK KETEMU* — the warehouse's goods-missing note on a custom shipment (backlog #88 P6), live on
// CustomShipmentService.CustomShipmentMissingReport. The owner's decisions (docs/business/custom_shipments/
// context_decision.md): missing-goods-leave-a-note-on-the-custom-shipment, the-goods-missing-badge-is-on-both-lists,
// missing-reship-units-are-not-offered-again, and the drawing accepted as the-goods-missing-prototype-is-accepted —
// the order's road (*"A"*, as an order: missing-goods-send-the-order-back-to-pending), on a parcel:
//
//   the warehouse  on the pick page, while Diminta: *Barang Tidak Ketemu* (a header button; on a phone the header's icon —
//                  a-phone-header-action-is-an-icon). Its dialog is the order's StepBackDialog shape (an alert dialog, a
//                  warning, the facts, a warning-coloured confirm — pages/pick-queue/components/StepBackDialog.tsx): which
//                  lines, how many, from which rack — the racks PREFILLED from the sample's take (StockPickLocations, the
//                  pick list's own; the server checks each against the same take rows); a reship's broken units were never
//                  on a rack, so a reship line names none — and an optional note (the lines already say what and where).
//   the trail      one row of its own kind (`kind` GOODS_MISSING): who, when, the lines and racks, the note — and the
//                  parcel still Diminta. The warehouse reads that the team decides; the team that it may cancel or wait.
//   the team       a *Barang tidak ketemu* badge beside the status on its list row (the order list's *No settlement
//                  account* badge's place and look — the-settlement-missing-badge-is-accepted), and a notice on the
//                  detail page above the parcel; Batalkan stays in the header while Diminta
//                  (a-custom-shipment-is-cancelled-only-while-requested). The warehouse's queue carries the badge too.
//   never          a status move (it stays Diminta), a cancel by the warehouse (only-the-selling-team-cancels), a stock
//                  write — a count finds the shortfall (a-missing-unit-is-found-by-opname).
//
// The OPEN note is the server's `goods_missing` — the latest while the parcel is REQUESTED, on list rows too; once it is
// picked (the goods turned up) or cancelled, the badge and the notices go and the trail keeps the row. No money in any of
// it: the warehouse and the team are sent the same.

const NOTE_MAX = 200;

type NoteHolder = Pick<CustomShipment, "id" | "status" | "goodsMissing">;

/** The OPEN note — the latest while the parcel is still Diminta; null once picked or cancelled, and on a parcel never noted. */
export function useOpenGoodsMissing(shipment: NoteHolder | null | undefined): GoodsMissingNote | null {
  return shipment?.status === "REQUESTED" ? (shipment.goodsMissing ?? null) : null;
}

/** Units in a note. */
const unitsIn = (note: GoodsMissingNote) => note.lines.reduce((sum, l) => sum + l.quantity, 0n);

/**
 * A list row's status line — the status badge ALONE without an open note (the very element it drew before), and the
 * badge beside it while the parcel waits on the team (the *No settlement account* badge's place: one line, nowrap).
 */
export function StatusWithGoodsMissing({ shipment, status }: { shipment: NoteHolder; status: ReactNode }) {
  const open = useOpenGoodsMissing(shipment);
  if (!open) return <>{status}</>;

  return (
    <HStack gap="1" wrap="nowrap" whiteSpace="nowrap">
      {status}
      <GoodsMissingBadge shipment={shipment} />
    </HStack>
  );
}

/** A phone block's own line for the badge, under its first line (a-phone-reads-each-line-as-a-block). Nothing without a note. */
export function GoodsMissingBlockLine({ shipment }: { shipment: NoteHolder }) {
  const open = useOpenGoodsMissing(shipment);
  if (!open) return null;

  return (
    <Flex align="center" gap="2" minW="0">
      <GoodsMissingBadge shipment={shipment} />
    </Flex>
  );
}

// ── The lists: a badge beside the status ────────────────────────────────────────────────────────────────────────────

/** *Barang tidak ketemu* — beside the status on a list row, while the parcel waits on the team. */
export function GoodsMissingBadge({ shipment }: { shipment: NoteHolder }) {
  const { t } = useTranslation();
  const open = useOpenGoodsMissing(shipment);
  if (!open) return null;

  return (
    <Badge
      colorPalette="warning"
      size="sm"
      title={t("customShipment.goodsMissing.badgeHint", { count: Number(unitsIn(open)) })}
      data-testid={`custom-shipment-goods-missing-${shipment.id}`}
    >
      <Icon as={PackageX} boxSize="3" />
      {t("customShipment.goodsMissing.badge")}
    </Badge>
  );
}

// ── The lines, said once for the trail and the notices ──────────────────────────────────────────────────────────────

function useLineText() {
  const { t } = useTranslation();

  return (line: GoodsMissingLine, reship: boolean) =>
    reship
      ? t("customShipment.goodsMissing.lineBroken", { name: line.name, count: Number(line.quantity) })
      : line.rackId > 0n
        ? t("customShipment.goodsMissing.lineRack", { name: line.name, count: Number(line.quantity), rack: line.rackCode })
        : t("customShipment.goodsMissing.lineNoRack", { name: line.name, count: Number(line.quantity) });
}

function MissingLines({ note, reship, testId }: { note: GoodsMissingNote; reship: boolean; testId: string }) {
  const lineText = useLineText();

  return (
    <Stack gap="0.5" data-testid={`${testId}-lines`}>
      {note.lines.map((line) => (
        <Text
          key={`${line.itemId}-${line.rackId}`}
          fontSize="sm"
          wordBreak="break-word"
          data-testid={`${testId}-line-${line.productId}-${line.rackId}`}
        >
          {lineText(line, reship)}
        </Text>
      ))}
    </Stack>
  );
}

// ── The notices: the team's detail, the warehouse's pick page ───────────────────────────────────────────────────────

/**
 * The open note at the top of the page. The TEAM reads that the warehouse cannot find the goods and that the parcel
 * waits on it — cancel (the header's Batalkan) or wait. The WAREHOUSE reads that it is recorded and waits on the team —
 * and that the scan is still there if the goods turn up. Nothing without an open note.
 */
export function GoodsMissingNotice({ shipment, side }: { shipment: CustomShipment; side: "selling" | "warehouse" }) {
  const { t } = useTranslation();
  const open = useOpenGoodsMissing(shipment);
  const teams = useTeamsByIds({ ids: open ? [shipment.teamId, shipment.warehouseId] : [] });
  if (!open) return null;

  const name = (id: bigint) => teams.data?.[id.toString()]?.name ?? t("customShipment.teamRef", { id: id.toString() });
  const reship = shipment.kind === "RESTOCK_RESHIP";
  const testId = "custom-shipment-goods-missing-notice";

  return (
    <Alert.Root status="warning" data-testid={testId} data-side={side}>
      <Alert.Indicator>
        <Icon as={PackageX} boxSize="4" />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title fontWeight="bold" data-testid={`${testId}-title`}>
          {side === "selling"
            ? t("customShipment.goodsMissing.notice.sellingTitle", { warehouse: name(shipment.warehouseId) })
            : t("customShipment.goodsMissing.notice.warehouseTitle", { when: formatUnixDateTime(open.atUnix) })}
        </Alert.Title>
        <Alert.Description>
          <Stack gap="1.5" mt="1">
            <MissingLines note={open} reship={reship} testId={testId} />
            {open.note && (
              <Text fontSize="sm" fontStyle="italic" wordBreak="break-word" data-testid={`${testId}-note`}>
                “{open.note}”
              </Text>
            )}
            <Text fontSize="sm" data-testid={`${testId}-next`}>
              {side === "selling"
                ? t(reship ? "customShipment.goodsMissing.notice.sellingReship" : "customShipment.goodsMissing.notice.sellingSample")
                : t("customShipment.goodsMissing.notice.warehouse", { team: name(shipment.teamId) })}
            </Text>
          </Stack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

// ── The trail row ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A *goods missing* row in the parcel's trail — its own kind (`data-kind="goods-missing"`), never read as a cost edit. */
export function GoodsMissingStep({
  note,
  shipment,
  side,
}: {
  note: GoodsMissingNote;
  shipment: CustomShipment;
  side: "selling" | "warehouse";
}) {
  const { t } = useTranslation();
  const actors = useActors([note.actorUserId]);
  const teams = useTeamsByIds({ ids: [shipment.teamId, shipment.warehouseId] });
  const actor = actors.data?.get(note.actorUserId.toString());
  const name = (id: bigint) => teams.data?.[id.toString()]?.name ?? t("customShipment.teamRef", { id: id.toString() });
  const testId = `custom-shipment-timeline-missing-${note.id}`;
  const fallback = note.actorUserId > 0n ? t("customShipment.userRef", { id: note.actorUserId.toString() }) : "";

  return (
    <Timeline.Item data-testid={testId} data-kind="goods-missing">
      <Timeline.Connector>
        <Timeline.Separator />
        <Timeline.Indicator colorPalette="warning" color="colorPalette.fg">
          <Icon as={PackageX} boxSize="4" />
        </Timeline.Indicator>
      </Timeline.Connector>
      <Timeline.Content>
        <Flex align="center" gap="card" wrap="wrap">
          {actor ? (
            <Box w="auto" maxW="72" flexShrink="0" data-testid={`${testId}-by`}>
              <UserItem user={actor} />
            </Box>
          ) : (
            fallback && (
              <Text fontSize="sm" fontWeight="medium" flexShrink="0">
                {fallback}
              </Text>
            )
          )}
          {/* The "by Root team" badge every trail row draws for an override (an-override-shows-a-platform-badge). */}
          {(actor || fallback) && note.isOverride && <RootTeamBadge />}
          {(actor || fallback) && <Separator orientation="vertical" height="auto" alignSelf="stretch" />}

          <Stack gap="1" minW="0" flex="1">
            {/* Its title, and the status it LEFT the parcel in — still Diminta: nothing moved. */}
            <HStack gap="2" wrap="wrap">
              <Timeline.Title>{t("customShipment.goodsMissing.trailTitle")}</Timeline.Title>
              <CustomShipmentStatusBadge status="REQUESTED" />
            </HStack>
            <MissingLines note={note} reship={shipment.kind === "RESTOCK_RESHIP"} testId={testId} />
            {note.note && (
              <Text fontSize="sm" fontStyle="italic" wordBreak="break-word" data-testid={`${testId}-note`}>
                “{note.note}”
              </Text>
            )}
            <Text fontSize="sm" color="fg.muted" data-testid={`${testId}-stays`}>
              {side === "selling"
                ? t("customShipment.goodsMissing.trailSelling", { warehouse: name(shipment.warehouseId) })
                : t("customShipment.goodsMissing.trailWarehouse", { team: name(shipment.teamId) })}
            </Text>
            <Timeline.Description>{formatUnixDateTime(note.atUnix)}</Timeline.Description>
          </Stack>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}

// ── The warehouse's control and its dialog ──────────────────────────────────────────────────────────────────────────

/**
 * *Barang Tidak Ketemu* on the pick page — the shipping warehouse's writing roles (never a monitor), while Diminta.
 * `variant` — `button` in the desktop header beside the page's own step; `icon` in the phone's one-row header
 * (a-phone-header-action-is-an-icon). Nothing once the parcel is picked, handed over or cancelled.
 */
export function GoodsMissingAction({
  shipment,
  picks,
  variant,
}: {
  shipment: CustomShipment;
  picks: CustomShipmentPick[];
  variant: "button" | "icon";
}) {
  const { t } = useTranslation();
  const { current } = useTeam();
  const [open, setOpen] = useState(false);

  if (shipment.status !== "REQUESTED" || !canWrite(current)) return null;

  const label = t("customShipment.goodsMissing.action");

  return (
    <>
      {variant === "button" ? (
        <Button variant="outline" colorPalette="warning" data-testid="custom-shipment-goods-missing-open" onClick={() => setOpen(true)}>
          <Icon as={PackageX} boxSize="4" />
          {label}
        </Button>
      ) : (
        // The phone header's end — the title row carries no spacer of its own, so the icon pushes itself there.
        <Box ms="auto" flexShrink={0}>
          <CompactActions
            menuLabel={t("customShipment.actions.menu")}
            actions={[{ id: "goods-missing", label, icon: PackageX, testId: "custom-shipment-goods-missing-open", onClick: () => setOpen(true) }]}
          />
        </Box>
      )}
      {/* Mounted only while open, so each opening starts from the parcel and its racks as they are now. */}
      {open && <GoodsMissingDialog shipment={shipment} picks={picks} onClose={() => setOpen(false)} />}
    </>
  );
}

/** One row of the dialog: a line on one of its racks (a sample), or a reship's line. */
interface Row {
  key: string;
  itemId: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  rackId: bigint;
  rackCode: string;
  /** The most it may say is missing here: what the take drew from this rack, or a reship line's quantity. */
  max: bigint;
  brokenNote: string;
}

/** The dialog's rows — the racks PREFILLED from the take, every rack a line drew from its own row (two racks, two walks). */
function rowsOf(shipment: CustomShipment, picks: CustomShipmentPick[]): Row[] {
  return shipment.items.flatMap((item) => {
    const base = { itemId: item.id, productId: item.productId, productCode: item.productCode, name: item.name, brokenNote: item.brokenNote };
    const racks = shipment.kind === "SAMPLE" ? picks.filter((p) => p.productId === item.productId) : [];

    if (racks.length === 0) {
      return [{ ...base, key: `${item.id}-0`, rackId: 0n, rackCode: "", max: item.quantity }];
    }

    return racks.map((pick) => ({ ...base, key: `${item.id}-${pick.rackId}`, rackId: pick.rackId, rackCode: pick.rackCode, max: pick.quantity }));
  });
}

// THE ORDER'S STEP-BACK DIALOG, for a parcel (pages/pick-queue/components/StepBackDialog.tsx — the owner's *"warning
// cukup, tetapi pakai alasan terdengar masuk akal"*): an alert dialog, a warning first, then the facts, then a
// warning-coloured confirm. The order's facts are one typed reason; a parcel's are its lines — how many of each are
// missing and from which rack, the racks already known from the take — so the note is only what the lines cannot say.
//
// A unit found on ANOTHER rack is simply taken (a-wrong-rack-pick-waits-for-the-count): the dialog says so, so only
// what is on no rack is written here. A refusal (the parcel was picked or cancelled meanwhile) says the server's
// sentence, and the page re-reads the parcel as it is now.
function GoodsMissingDialog({
  shipment,
  picks,
  onClose,
}: {
  shipment: CustomShipment;
  picks: CustomShipmentPick[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const report = useReportGoodsMissing();
  const isMobile = useIsMobile();
  const teams = useTeamsByIds({ ids: [shipment.teamId] });
  const team = teams.data?.[shipment.teamId.toString()]?.name ?? t("customShipment.teamRef", { id: shipment.teamId.toString() });
  const rows = useMemo(() => rowsOf(shipment, picks), [shipment, picks]);
  const reship = shipment.kind === "RESTOCK_RESHIP";

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const amount = (row: Row) => {
    const raw = counts[row.key] ?? "";
    return /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  };
  const over = rows.some((row) => amount(row) > row.max);
  const total = rows.reduce((sum, row) => sum + amount(row), 0n);
  const ready = total > 0n && !over;

  async function confirm() {
    if (!ready || report.isPending) return;

    const chosen = rows.filter((row) => amount(row) > 0n);

    try {
      await report.mutateAsync({
        teamId: shipment.warehouseId,
        id: shipment.id,
        lines: chosen.map((row) => ({ itemId: row.itemId, rackId: row.rackId, quantity: amount(row) })),
        note: note.trim(),
      });
      toaster.create({
        type: "success",
        title: t("customShipment.goodsMissing.toast"),
        description: t("customShipment.goodsMissing.toastDetail", { team }),
      });
    } catch (err) {
      toaster.create({ type: "error", title: t("customShipment.toast.refused"), description: rpcError(err) });
    }
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} role="alertdialog" size={isMobile ? "full" : "lg"}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="custom-shipment-goods-missing-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("customShipment.goodsMissing.title", { id: shipment.id.toString() })}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="card">
                <Alert.Root status="warning" data-testid="custom-shipment-goods-missing-warning">
                  <Alert.Indicator />
                  {/* A reship moves no rack stock and no count can find broken units (never on a rack) — its own words. */}
                  <Alert.Description>
                    {t(reship ? "customShipment.goodsMissing.warningReship" : "customShipment.goodsMissing.warning", { team })}
                  </Alert.Description>
                </Alert.Root>

                <Text fontSize="sm" color="fg.muted" data-testid="custom-shipment-goods-missing-where">
                  {reship
                    ? t("customShipment.goodsMissing.brokenHint", { id: shipment.restockId.toString() })
                    : t("customShipment.goodsMissing.otherRack")}
                </Text>

                <Stack gap="3" data-testid="custom-shipment-goods-missing-rows">
                  {rows.map((row, i) => {
                    const firstOfLine = i === 0 || rows[i - 1]!.itemId !== row.itemId;
                    const invalid = amount(row) > row.max;
                    const rowId = `${row.productId}-${row.rackId}`;

                    return (
                      <Stack key={row.key} gap="1.5" data-testid={`custom-shipment-goods-missing-row-${rowId}`}>
                        {firstOfLine && (
                          <Stack gap="0">
                            <Text fontWeight="medium" wordBreak="break-word">
                              {row.name}
                            </Text>
                            <Text fontSize="xs" color="fg.muted">
                              {row.productCode}
                              {reship && row.brokenNote ? ` · ${t("customShipment.form.brokenNote", { note: row.brokenNote })}` : ""}
                            </Text>
                          </Stack>
                        )}
                        <Flex align="center" gap="2" wrap="wrap">
                          {reship ? (
                            <Text fontSize="sm" color="fg.muted" data-testid={`custom-shipment-goods-missing-rack-${rowId}`}>
                              {t("customShipment.goodsMissing.ofBroken", { count: Number(row.max) })}
                            </Text>
                          ) : row.rackId > 0n ? (
                            <HStack gap="2" data-testid={`custom-shipment-goods-missing-rack-${rowId}`}>
                              <Badge colorPalette="brand">{row.rackCode}</Badge>
                              <Text fontSize="sm">×{row.max.toString()}</Text>
                            </HStack>
                          ) : (
                            <HStack gap="1" color="fg.muted" data-testid={`custom-shipment-goods-missing-rack-${rowId}`}>
                              <Icon as={TriangleAlert} boxSize="4" />
                              <Text fontSize="sm">{t("customShipment.pick.noRack")}</Text>
                            </HStack>
                          )}
                          <Spacer />
                          <Field.Root invalid={invalid} w="auto" flexDirection="row" alignItems="center" gap="2">
                            <Field.Label fontSize="sm" mb="0">
                              {t("customShipment.goodsMissing.missing")}
                            </Field.Label>
                            <QuantityInput
                              min={0}
                              max={Number(row.max)}
                              value={counts[row.key] ?? ""}
                              onChange={(value) => setCounts((all) => ({ ...all, [row.key]: value }))}
                              aria-label={t("customShipment.goodsMissing.missingOf", { name: row.name })}
                              testId={`custom-shipment-goods-missing-qty-${rowId}`}
                            />
                          </Field.Root>
                        </Flex>
                      </Stack>
                    );
                  })}
                </Stack>

                <Field.Root>
                  <Field.Label>{t("customShipment.goodsMissing.note")}</Field.Label>
                  <Textarea
                    rows={2}
                    value={note}
                    maxLength={NOTE_MAX}
                    placeholder={t("customShipment.goodsMissing.notePlaceholder")}
                    data-testid="custom-shipment-goods-missing-note"
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <CharCount value={note} max={NOTE_MAX} testId="custom-shipment-goods-missing-note-count" />
                </Field.Root>
              </Stack>
            </Dialog.Body>

            {/* On a phone the count is a line of its own above the two buttons — beside them it was squeezed to three. */}
            <Dialog.Footer flexWrap="wrap">
              <Text fontSize="sm" color="fg.muted" me="auto" w={isMobile ? "full" : undefined} data-testid="custom-shipment-goods-missing-total">
                {total > 0n
                  ? t("customShipment.goodsMissing.total", { count: Number(total) })
                  : t("customShipment.goodsMissing.waiting")}
              </Text>
              <Button variant="ghost" data-testid="custom-shipment-goods-missing-dismiss" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                colorPalette="warning"
                disabled={!ready}
                loading={report.isPending}
                data-testid="custom-shipment-goods-missing-confirm"
                onClick={confirm}
              >
                {t("customShipment.goodsMissing.confirm")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
