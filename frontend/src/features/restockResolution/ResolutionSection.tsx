import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Badge, Box, Button, Field, Flex, HStack, Icon, Link, Menu, Portal, Separator, Span, Stack, Text, Textarea } from "@chakra-ui/react";
import { BadgeCheck, ChevronDown, HandCoins, PackagePlus, Truck, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockResolutionType } from "../../gen/warehouse/inventory/v1/restock_resolution_pb";
import { useCanWrite } from "../team/TeamContext";
import { useActors } from "../users/queries";
import { useFinancialAccountsByIds } from "../financialAccount/queries";
import { useShipmentChannelsByIds } from "../shipment/queries";
import { useCustomShipment } from "../customShipment/queries";
import { CustomShipmentStatusBadge } from "../customShipment/CustomShipmentBadges";
import { customShipmentPath } from "../customShipment/customShipments";
import { brokenTotal } from "../restock/restockTags";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import { useIsMobile } from "../../layouts/shell";
import { fromHere } from "../../lib/cameFrom";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { personName } from "../../lib/users";
import type { InboundParcel, ResolutionType, RestockResolution } from "./resolutions";
import {
  INBOUND_STATUS_KEYS,
  RETURN_FORM_PATH,
  TYPE_KEYS,
  goodOf,
  inboundParcelPath,
  reshippingFormPath,
  resolutionsOf,
  settlementOf,
  shortOf,
  typesFor,
  unitsOf,
} from "./resolutions";
import { useInboundParcelsById, useRecordResolution, useSettleRestock } from "./queries";

const MAX_NOTE = 200;

const TYPE_LOOK: Record<ResolutionType, { icon: LucideIcon; palette: string; slug: string }> = {
  REFUND: { icon: HandCoins, palette: "green", slug: "refund" },
  RETURN: { icon: Undo2, palette: "orange", slug: "return" },
  RESHIPPING: { icon: Truck, palette: "blue", slug: "reshipping" },
};

/** The resolution's type, as a badge — categorical colour, its own icon. */
export function ResolutionTypeBadge({ type }: { type: ResolutionType }) {
  const { t } = useTranslation();
  const look = TYPE_LOOK[type];

  return (
    <Badge variant="subtle" colorPalette={look.palette} flexShrink={0} data-testid={`resolution-type-${look.slug}`}>
      <HStack gap="1">
        <Icon as={look.icon} boxSize="3" />
        {t(TYPE_KEYS[type])}
      </HStack>
    </Badge>
  );
}

/** An inbound parcel's step, in the restock's words (Dalam Perjalanan · Tiba · Diterima · Hilang). */
export function InboundStatusBadge({ status }: { status: InboundParcel["status"] }) {
  const { t } = useTranslation();
  const palette = { ON_THE_WAY: "blue", ARRIVED: "orange", RECEIVED: "green", LOST: "red" }[status];

  return (
    <Badge colorPalette={palette} flexShrink={0} data-testid={`inbound-status-${status.toLowerCase()}`}>
      {t(INBOUND_STATUS_KEYS[status])}
    </Badge>
  );
}

// THE RESOLUSI SECTION — a problem restock's settlement, the selling team's (a-restock-problem-is-settled-by-resolution-rows):
//
//   Resolusi                                       [Catat Resolusi ▾] [✓ Tandai Selesai]
//   [Refund]      Rp 65.000 ke BCA Operasional                       ← the money back, and where it went
//                 Supplier transfer untuk 1 karung yang kurang       ← the note
//                 18 Nov 10:12 · Ani Rahayu
//   ─────
//   [Kirim Ulang] Kiriman ulang #901 [Dalam Perjalanan] · 2 pcs · JNE ← the inbound parcel it created, its step
//
// No units on a row (🔄 B): the restock is settled when the seller says so, and then its problem tags come off. A SETTLED
// restock keeps *Catat Resolusi* (🔄 A, unlike the prototype's draw: a late refund still reaches its account) and stays
// settled; only *Tandai Selesai* goes (the server refuses a second settle).
export function ResolutionSection({ request, teamId }: { request: RestockRequest; teamId: bigint }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const writable = useCanWrite();
  const settle = useSettleRestock();
  const [dialog, setDialog] = useState<"" | "refund" | "settle">("");

  const rows = resolutionsOf(request);
  const settled = settlementOf(request);
  const lost = request.status === RestockRequestStatus.LOST;
  const actors = useActors([...rows.map((r) => r.createdByUserId), settled?.settledByUserId ?? 0n]);
  const accounts = useFinancialAccountsByIds(teamId, rows.map((r) => r.financeAccountId));
  const parcels = useInboundParcelsById(
    teamId,
    rows.filter((r) => r.type === "RESHIPPING" && r.customShipmentId > 0n).map((r) => r.customShipmentId),
  );
  const nameOf = (id: bigint) => personName(actors.data?.get(id.toString()), t("restock.table.userRef", { id: id.toString() }));
  // A RETURN sends the broken units back (the outbound reship parcel, which carries only those) — a restock with none has
  // nothing to send; a lost one never takes it.
  const returnable = brokenTotal(request) > 0n;

  function pick(type: ResolutionType) {
    if (type === "REFUND") return setDialog("refund");
    const state = fromHere(location);
    if (type === "RETURN") return navigate(RETURN_FORM_PATH, { state: { ...state, resolutionReturn: { restockId: request.id.toString() } } });
    navigate(reshippingFormPath(request.id), { state });
  }

  const open = rows.filter((r) => r.type === "RESHIPPING" && parcels.get(r.customShipmentId.toString())?.status === "ON_THE_WAY").length;

  async function confirmSettle() {
    try {
      await settle.mutateAsync({ teamId: request.requestingTeamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restockResolution.toast.settled") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restockResolution.toast.failed"), description: rpcError(err) });
    }
  }

  return (
    <Stack gap="card" data-testid="resolution-section">
      {writable && (
        <Flex gap="2" wrap="wrap" justify={isMobile ? "stretch" : "flex-end"} data-testid="resolution-actions">
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button size="xs" colorPalette="brand" flex={isMobile ? "1" : undefined} data-testid="resolution-record">
                <Icon as={PackagePlus} boxSize="4" />
                {t("restockResolution.record")}
                <Icon as={ChevronDown} boxSize="3.5" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content data-testid="resolution-record-menu">
                  {typesFor(lost).map((type) => {
                    const disabled = type === "RETURN" && !returnable;
                    return (
                      <Menu.Item
                        key={type}
                        value={type}
                        disabled={disabled}
                        data-testid={`resolution-record-${TYPE_LOOK[type].slug}`}
                        onSelect={disabled ? undefined : () => pick(type)}
                      >
                        <Icon as={TYPE_LOOK[type].icon} boxSize="4" />
                        <Stack gap="0">
                          <Span>{t(`restockResolution.menu.${TYPE_LOOK[type].slug}`)}</Span>
                          <Span fontSize="xs" color="fg.muted">
                            {disabled ? t("restockResolution.menu.returnNone") : t(`restockResolution.menu.${TYPE_LOOK[type].slug}Hint`)}
                          </Span>
                        </Stack>
                      </Menu.Item>
                    );
                  })}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
          {!settled && (
            <Button size="xs" variant="outline" flex={isMobile ? "1" : undefined} data-testid="resolution-settle" onClick={() => setDialog("settle")}>
              <Icon as={BadgeCheck} boxSize="4" />
              {t("restockResolution.settle")}
            </Button>
          )}
        </Flex>
      )}

      {settled && (
        <Alert.Root status="success" data-testid="resolution-settled">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("restockResolution.settled.title")}</Alert.Title>
            <Alert.Description>
              {t(lost ? "restockResolution.settled.bodyLost" : "restockResolution.settled.body", {
                name: nameOf(settled.settledByUserId),
                when: formatUnixDateTimeShort(settled.settledAtUnix),
              })}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {rows.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" data-testid="resolution-empty">
          {t(lost ? "restockResolution.emptyLost" : "restockResolution.empty")}
        </Text>
      ) : (
        <Stack gap="0" separator={<Separator />} data-testid="resolution-rows">
          {rows.map((row) => (
            <ResolutionRow
              key={row.id.toString()}
              row={row}
              teamId={teamId}
              parcel={parcels.get(row.customShipmentId.toString())}
              accountName={accounts.data?.get(row.financeAccountId.toString())?.name}
              by={nameOf(row.createdByUserId)}
            />
          ))}
        </Stack>
      )}

      {dialog === "refund" && <RefundDialog request={request} teamId={teamId} onClose={() => setDialog("")} />}
      {dialog === "settle" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDialog("")}
          destructive={false}
          title={t("restockResolution.settleDialog.title", { id: request.id.toString() })}
          message={t(lost ? "restockResolution.settleDialog.messageLost" : "restockResolution.settleDialog.message")}
          confirmLabel={t("restockResolution.settle")}
          dismissLabel={t("common.cancel")}
          onConfirm={confirmSettle}
        >
          <Stack gap="2" data-testid="resolution-settle-notes">
            {rows.length === 0 && (
              <Text fontSize="sm" color="warning.fg" data-testid="resolution-settle-none">
                {t("restockResolution.settleDialog.none")}
              </Text>
            )}
            {open > 0 && (
              <Text fontSize="sm" color="warning.fg" data-testid="resolution-settle-open">
                {t("restockResolution.settleDialog.onTheWay", { count: open })}
              </Text>
            )}
          </Stack>
        </ConfirmDialog>
      )}
    </Stack>
  );
}

function ResolutionRow({
  row,
  teamId,
  parcel,
  accountName,
  by,
}: {
  row: RestockResolution;
  teamId: bigint;
  parcel?: InboundParcel;
  accountName?: string;
  by: string;
}) {
  const { t } = useTranslation();
  const testId = `resolution-row-${row.id}`;

  return (
    <Stack gap="1" py="3" minW="0" data-testid={testId} data-type={row.type}>
      <Flex gap="2" align="center" wrap="wrap" minW="0">
        <ResolutionTypeBadge type={row.type} />
        {row.type === "REFUND" && (
          <Text fontSize="sm" fontWeight="bold" data-testid={`${testId}-refund`}>
            {t("restockResolution.row.refund", {
              amount: formatRupiahNumber(row.refundAmount ?? 0),
              account: accountName ?? t("restock.detail.accountRef", { id: row.financeAccountId.toString() }),
            })}
          </Text>
        )}
        {row.type === "RETURN" && <ReturnParcel id={row.customShipmentId} teamId={teamId} testId={`${testId}-parcel`} />}
        {row.type === "RESHIPPING" && <InboundParcelLine parcel={parcel} testId={`${testId}-parcel`} />}
      </Flex>
      {row.type === "RESHIPPING" && <InboundOutcome parcel={parcel} testId={`${testId}-outcome`} />}
      {row.note !== "" && (
        <Text fontSize="sm" whiteSpace="pre-wrap" wordBreak="break-word" data-testid={`${testId}-note`}>
          {row.note}
        </Text>
      )}
      <Text fontSize="xs" color="fg.muted" data-testid={`${testId}-when`}>
        {formatUnixDateTimeShort(row.createdAtUnix)}
        {by && ` · ${by}`}
      </Text>
    </Stack>
  );
}

/** A RETURN's parcel — the live outbound one, read from Kirim Paket (its step, a link to it). */
function ReturnParcel({ id, teamId, testId }: { id: bigint; teamId: bigint; testId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const parcel = useCustomShipment({ teamId, id });

  return (
    <HStack gap="2" wrap="wrap" minW="0" data-testid={testId}>
      <Link fontSize="sm" fontWeight="bold" colorPalette="brand" onClick={() => navigate(customShipmentPath(id))} data-testid={`${testId}-link`}>
        {t("restockResolution.row.returnParcel", { id: id.toString() })}
      </Link>
      {parcel.data && <CustomShipmentStatusBadge status={parcel.data.status} />}
      {parcel.data && (
        <Span fontSize="xs" color="fg.muted">
          {t("restockResolution.row.pcs", { count: Number(parcel.data.items.reduce((s, i) => s + i.quantity, 0n)) })}
        </Span>
      )}
    </HStack>
  );
}

/** A RESHIPPING's inbound parcel — its number, its step, what is in it and how it travels. */
export function InboundParcelLine({ parcel, testId }: { parcel?: InboundParcel; testId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const couriers = useShipmentChannelsByIds(parcel ? [parcel.shipmentChannelId] : []);
  if (!parcel) return null;
  const courier = couriers.data?.get(parcel.shipmentChannelId.toString())?.name;

  return (
    <HStack gap="2" wrap="wrap" minW="0" data-testid={testId}>
      <Link fontSize="sm" fontWeight="bold" colorPalette="brand" onClick={() => navigate(inboundParcelPath(parcel.id))} data-testid={`${testId}-link`}>
        {t("restockResolution.row.inboundParcel", { id: parcel.id.toString() })}
      </Link>
      <InboundStatusBadge status={parcel.status} />
      <Span fontSize="xs" color="fg.muted">
        {[t("restockResolution.row.pcs", { count: Number(unitsOf(parcel)) }), courier, parcel.resi].filter(Boolean).join(" · ")}
      </Span>
    </HStack>
  );
}

/** What Terima counted, once it has — broken or short units said in the warning tone: they reopen the restock (🔄 A). */
export function InboundOutcome({ parcel, testId }: { parcel?: InboundParcel; testId: string }) {
  const { t } = useTranslation();
  if (!parcel || parcel.status !== "RECEIVED") return null;
  const good = parcel.lines.reduce((s, l) => s + goodOf(l), 0n);
  const broken = parcel.lines.reduce((s, l) => s + (l.broken ?? 0n), 0n);
  const short = parcel.lines.reduce((s, l) => s + shortOf(l), 0n);
  const problem = broken > 0n || short > 0n;

  return (
    <Text fontSize="sm" color={problem ? "warning.fg" : "fg.muted"} data-testid={testId}>
      {t("restockResolution.row.outcome", { good: Number(good), broken: Number(broken), short: Number(short) })}
    </Text>
  );
}

// REFUND — the money back: its amount and the account it goes into, the picker opening on the restock's own paying account
// (🔄 *"yes, A"* — the account is the row's; the opening pick is the build's default). Posting raises that account's
// balance and writes its history, from inventory's RestockRefunded (restock-is-never-typed-by-hand). The dialog's key is
// minted once per opening: a double tap is refused by the server (AlreadyExists), never recorded twice.
function RefundDialog({ request, teamId, onClose }: { request: RestockRequest; teamId: bigint; onClose: () => void }) {
  const { t } = useTranslation();
  const record = useRecordResolution();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(request.financeAccountId);
  const [note, setNote] = useState("");
  const value = amount === "" ? 0 : Number(amount);

  async function confirm() {
    try {
      await record.mutateAsync({
        teamId: request.requestingTeamId,
        restockId: request.id,
        type: RestockResolutionType.REFUND,
        note: note.trim(),
        refundAmount: value,
        financeAccountId: accountId,
        idempotencyKey,
      });
      toaster.create({ type: "success", title: t("restockResolution.toast.recorded") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restockResolution.toast.failed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      destructive={false}
      title={t("restockResolution.refund.title", { id: request.id.toString() })}
      message={t("restockResolution.refund.message")}
      confirmLabel={t("restockResolution.refund.confirm")}
      dismissLabel={t("common.cancel")}
      confirmDisabled={value <= 0 || accountId === 0n}
      onConfirm={confirm}
    >
      <Stack gap="field" data-testid="resolution-refund-dialog">
        <Field.Root required>
          <Field.Label>
            {t("restockResolution.refund.amount")}
            <Field.RequiredIndicator />
          </Field.Label>
          <CurrencyInput fraction value={amount} onChange={setAmount} data-testid="resolution-refund-amount" />
        </Field.Root>
        <Field.Root required>
          <Field.Label>
            {t("restockResolution.refund.account")}
            <Field.RequiredIndicator />
          </Field.Label>
          <Box w="full">
            <FinancialAccountSelect
              teamId={teamId}
              value={accountId > 0n ? accountId : undefined}
              onChange={setAccountId}
              testId="resolution-refund-account"
            />
          </Box>
          <Field.HelperText>{t("restockResolution.refund.accountHint")}</Field.HelperText>
        </Field.Root>
        <NoteField value={note} onChange={setNote} testId="resolution-refund-note" />
      </Stack>
    </ConfirmDialog>
  );
}

/** The resolution's note — what was agreed with the supplier or the platform; optional, ≤ 200. */
export function NoteField({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  const { t } = useTranslation();

  return (
    <Field.Root>
      <Field.Label>{t("restockResolution.note")}</Field.Label>
      <Textarea
        value={value}
        maxLength={MAX_NOTE}
        rows={2}
        autoresize
        placeholder={t("restockResolution.notePlaceholder")}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
      <Field.HelperText alignSelf="end" data-testid={`${testId}-count`}>
        {value.length}/{MAX_NOTE}
      </Field.HelperText>
    </Field.Root>
  );
}
