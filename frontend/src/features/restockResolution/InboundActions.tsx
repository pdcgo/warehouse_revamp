import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  HStack,
  Icon,
  Input,
  Portal,
  Separator,
  Span,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { PackageCheck, PackageOpen, PackageX, PencilLine, Tags } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import { useCanWrite } from "../team/TeamContext";
import { CourierCharge } from "../restock/CourierCharge";
import { toRupiah } from "../restock/counting";
import { CompactActions } from "../../components/chrome/CompactActions";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { RackSelect } from "../../components/pickers/RackSelect";
import { useIsMobile } from "../../layouts/shell";
import type { InboundParcel } from "./resolutions";
import { useArriveInbound, useMarkInboundLost, useReceiveInbound, useSetInboundPrices, useSetInboundResi } from "./queries";

// THE ACTS ON AN INBOUND RESHIPPING PARCEL, by side and step, as a restock box's
// (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 *"A"* — Tiba → Terima, or Hilang; the Tiba / Terima rules of a
// restock apply alike). Each is its phase-1 RPC; the server holds the same matrix and refuses the rest.
//
//   the selling team   ON_THE_WAY → Ubah Resi (CustomShipmentResiSet — the resi is editable until Tiba) · Ubah Harga
//                      (CustomShipmentPricesSet — until Terima) · Tandai Hilang (CustomShipmentMarkLost)
//                      ARRIVED → Ubah Harga
//   the warehouse      ON_THE_WAY / LOST → Tandai Tiba (CustomShipmentArrive — a late lost box is signed for,
//                      a-late-lost-box-is-signed-for-as-arrived — the courier's charge at the door noted, kept)
//                      ARRIVED → Terima (CustomShipmentReceive: the count, the charge final)
type Act = "resi" | "prices" | "lost" | "arrive" | "receive";

const LOOK: Record<Act, { icon: LucideIcon; labelKey: string; slug: string; danger?: boolean }> = {
  resi: { icon: PencilLine, labelKey: "restockResolution.inbound.editResi", slug: "edit-resi" },
  prices: { icon: Tags, labelKey: "restockResolution.inbound.editPrices", slug: "edit-prices" },
  lost: { icon: PackageX, labelKey: "restockResolution.inbound.markLost", slug: "mark-lost", danger: true },
  arrive: { icon: PackageOpen, labelKey: "restock.actions.signForBox", slug: "sign" },
  receive: { icon: PackageCheck, labelKey: "restockResolution.inbound.receive", slug: "receive" },
};

export function inboundActs(parcel: Pick<InboundParcel, "status">, side: "selling" | "warehouse"): Act[] {
  // The resi until Tiba (as a restock's); the prices until Terima (context_decision 🔄 A: editable until Terima); Hilang
  // only before the box arrives (lost-is-set-only-before-the-box-arrives).
  if (side === "selling") {
    if (parcel.status === "ON_THE_WAY") return ["resi", "prices", "lost"];
    return parcel.status === "ARRIVED" ? ["prices"] : [];
  }
  if (parcel.status === "ON_THE_WAY" || parcel.status === "LOST") return ["arrive"];
  if (parcel.status === "ARRIVED") return ["receive"];

  return [];
}

/** The team each side writes as — the owning selling team, or the warehouse it comes to (the server checks it). */
const writerOf = (parcel: InboundParcel, side: "selling" | "warehouse") => (side === "selling" ? parcel.teamId : parcel.warehouseId);

function failed(t: (key: string) => string, err: unknown) {
  toaster.create({ type: "error", title: t("restockResolution.toast.failed"), description: rpcError(err) });
}

/** The acts, as labelled buttons (a desktop header, a list row) or a phone header's icons. */
export function InboundActions({ parcel, side, variant }: { parcel: InboundParcel; side: "selling" | "warehouse"; variant: "buttons" | "compact" | "row" }) {
  const { t } = useTranslation();
  const writable = useCanWrite();
  const [open, setOpen] = useState<Act | "">("");
  const acts = writable ? inboundActs(parcel, side) : [];
  if (acts.length === 0) return null;
  const id = parcel.id.toString();
  const close = () => setOpen("");

  return (
    <>
      {variant === "compact" ? (
        <CompactActions
          menuLabel={t("restock.actions.menu")}
          menuTestId={`inbound-actions-${id}`}
          actions={acts.map((act) => ({
            id: act,
            label: t(LOOK[act].labelKey),
            icon: LOOK[act].icon,
            danger: LOOK[act].danger,
            testId: `inbound-action-${LOOK[act].slug}-${id}`,
            onClick: () => setOpen(act),
          }))}
        />
      ) : (
        <HStack gap="2" justify="flex-end">
          {acts.map((act) => (
            <Button
              key={act}
              size={variant === "row" ? "xs" : undefined}
              variant={act === "arrive" || act === "receive" ? "solid" : "outline"}
              colorPalette={LOOK[act].danger ? "error" : act === "receive" || act === "arrive" ? "brand" : undefined}
              data-testid={`inbound-action-${LOOK[act].slug}-${id}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(act);
              }}
            >
              <Icon as={LOOK[act].icon} boxSize="4" />
              {t(LOOK[act].labelKey)}
            </Button>
          ))}
        </HStack>
      )}

      {open === "resi" && <ResiDialog parcel={parcel} teamId={writerOf(parcel, side)} onClose={close} />}
      {open === "prices" && <PricesDialog parcel={parcel} teamId={writerOf(parcel, side)} onClose={close} />}
      {open === "lost" && <LostDialog parcel={parcel} teamId={writerOf(parcel, side)} onClose={close} />}
      {open === "arrive" && <ArriveDialog parcel={parcel} teamId={writerOf(parcel, side)} onClose={close} />}
      {open === "receive" && <ReceiveDialog parcel={parcel} teamId={writerOf(parcel, side)} onClose={close} />}
    </>
  );
}

function ResiDialog({ parcel, teamId, onClose }: { parcel: InboundParcel; teamId: bigint; onClose: () => void }) {
  const { t } = useTranslation();
  const resiSet = useSetInboundResi();
  const [resi, setResi] = useState(parcel.resi);

  async function confirm() {
    try {
      await resiSet.mutateAsync({ teamId, id: parcel.id, resi: resi.trim() });
      toaster.create({ type: "success", title: t("restockResolution.toast.resiSaved") });
    } catch (err) {
      failed(t, err);
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      destructive={false}
      title={t("restockResolution.inbound.resiTitle", { id: parcel.id.toString() })}
      message={t("restockResolution.inbound.resiMessage")}
      confirmLabel={t("restockResolution.save")}
      dismissLabel={t("common.cancel")}
      onConfirm={confirm}
    >
      <Field.Root>
        <Field.Label>{t("restock.detail.tracking")}</Field.Label>
        <Input value={resi} maxLength={100} placeholder="JNE0123456789" data-testid="inbound-resi-input" onChange={(e) => setResi(e.target.value)} />
      </Field.Root>
    </ConfirmDialog>
  );
}

// UBAH HARGA — the seller re-prices what the supplier sends, until Terima; the price values the stock and moves no money
// (context_decision: *the typed price moves no money*, his rule). Every line is sent; a line not changed keeps its price.
function PricesDialog({ parcel, teamId, onClose }: { parcel: InboundParcel; teamId: bigint; onClose: () => void }) {
  const { t } = useTranslation();
  const pricesSet = useSetInboundPrices();
  const [prices, setPrices] = useState(() => new Map(parcel.lines.map((l) => [l.id.toString(), String(l.priceUnit ?? 0)])));
  const ready = [...prices.values()].every((p) => toRupiah(p) > 0);

  async function confirm() {
    try {
      await pricesSet.mutateAsync({
        teamId,
        id: parcel.id,
        lines: parcel.lines.map((l) => ({ itemId: l.id, priceUnit: toRupiah(prices.get(l.id.toString()) ?? "") })),
      });
      toaster.create({ type: "success", title: t("restockResolution.toast.pricesSaved") });
    } catch (err) {
      failed(t, err);
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      destructive={false}
      title={t("restockResolution.inbound.pricesTitle", { id: parcel.id.toString() })}
      message={t("restockResolution.inbound.pricesMessage")}
      confirmLabel={t("restockResolution.save")}
      dismissLabel={t("common.cancel")}
      confirmDisabled={!ready}
      onConfirm={confirm}
    >
      <Stack gap="field">
        {parcel.lines.map((l) => (
          <Field.Root key={l.id.toString()} required>
            <Field.Label>
              {l.name} · {t("restockResolution.row.pcs", { count: Number(l.count) })}
              <Field.RequiredIndicator />
            </Field.Label>
            <CurrencyInput
              value={prices.get(l.id.toString()) ?? ""}
              onChange={(v) => setPrices((m) => new Map(m).set(l.id.toString(), v))}
              data-testid={`inbound-price-${l.productId}`}
            />
          </Field.Root>
        ))}
      </Stack>
    </ConfirmDialog>
  );
}

function LostDialog({ parcel, teamId, onClose }: { parcel: InboundParcel; teamId: bigint; onClose: () => void }) {
  const { t } = useTranslation();
  const markLost = useMarkInboundLost();
  const [reason, setReason] = useState("");

  async function confirm() {
    try {
      await markLost.mutateAsync({ teamId, id: parcel.id, reason: reason.trim() });
      toaster.create({ type: "success", title: t("restockResolution.toast.lost") });
    } catch (err) {
      failed(t, err);
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("restockResolution.inbound.lostTitle", { id: parcel.id.toString() })}
      message={t("restockResolution.inbound.lostMessage")}
      confirmLabel={t("restockResolution.inbound.markLost")}
      dismissLabel={t("restock.lost.keep")}
      onConfirm={confirm}
    >
      <Field.Root>
        <Field.Label>{t("restock.lost.reason")}</Field.Label>
        <Textarea value={reason} maxLength={200} rows={2} data-testid="inbound-lost-reason" onChange={(e) => setReason(e.target.value)} />
      </Field.Root>
    </ConfirmDialog>
  );
}

// TANDAI TIBA — the restock's sign, its door charge asked first then filled, kept on the parcel; no money moves
// (the-courier-charge-is-noted-at-tiba-and-final-at-terima).
function ArriveDialog({ parcel, teamId, onClose }: { parcel: InboundParcel; teamId: bigint; onClose: () => void }) {
  const { t } = useTranslation();
  const arrive = useArriveInbound();
  const [asked, setAsked] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const charge = asked ? toRupiah(amount) : 0;
  // Ada asks for the amount; what it was for is optional (the-couriers-charge-note-is-optional).
  const incomplete = asked && charge <= 0;

  async function confirm() {
    try {
      await arrive.mutateAsync({ teamId, id: parcel.id, doorCharge: charge, doorChargeNote: charge > 0 ? note.trim() : "" });
      toaster.create({ type: "success", title: t("restock.actions.toast.arrived") });
    } catch (err) {
      failed(t, err);
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      destructive={false}
      title={t("restockResolution.inbound.signTitle", { id: parcel.id.toString() })}
      message={t("restockResolution.inbound.signMessage")}
      confirmLabel={t("restock.actions.signForBox")}
      dismissLabel={t("restock.actions.sign.dismiss")}
      confirmDisabled={incomplete}
      onConfirm={confirm}
    >
      <Text fontSize="sm" color="fg.muted">
        {parcel.resi ? t("restock.actions.sign.tracking", { receipt: parcel.resi }) : t("restock.actions.sign.noTracking")}
      </Text>
      <Separator my="card" />
      <CourierCharge
        asked={asked}
        onAsked={setAsked}
        amount={amount}
        note={note}
        onAmount={setAmount}
        onNote={setNote}
        hint={t("restock.actions.sign.courierHint")}
        testId="inbound-sign-courier"
      />
    </ConfirmDialog>
  );
}

interface CountDraft {
  received: string;
  broken: string;
  rack: string;
}

// TERIMA — the count in, a restock box's rules (any-warehouse-member-counts-what-arrived, a-short-unit-at-the-door-is-
// missing): what is IN THE BOX is typed, broken among it typed; good = received − broken goes on a rack; short = sent −
// received is worked out. More than was sent is refused (accept-refuses-more-than-the-line-says). The door charge opens
// with Tiba's and is final here. Short or broken units reopen the restock (🔄 A) — the server does it in the same step.
// A dialog, one rack per line, as accepted.
function ReceiveDialog({ parcel, teamId, onClose }: { parcel: InboundParcel; teamId: bigint; onClose: () => void }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const receive = useReceiveInbound();
  const [drafts, setDrafts] = useState<Record<string, CountDraft>>(() =>
    Object.fromEntries(parcel.lines.map((l) => [l.id.toString(), { received: "", broken: "", rack: "" }])),
  );
  const [asked, setAsked] = useState(parcel.doorCharge > 0);
  const [amount, setAmount] = useState(parcel.doorCharge > 0 ? String(parcel.doorCharge) : "");
  const [note, setNote] = useState(parcel.doorChargeNote);
  const charge = asked ? toRupiah(amount) : 0;

  const counted = parcel.lines.map((line) => {
    const d = drafts[line.id.toString()]!;
    const received = d.received === "" ? undefined : BigInt(d.received);
    const broken = d.broken === "" ? 0n : BigInt(d.broken);
    const good = received === undefined ? 0n : received - broken;
    const over = received !== undefined && received > line.count;
    const badBroken = received !== undefined && broken > received;

    return { line, d, received, broken, good, over, badBroken, short: received === undefined || over ? 0n : line.count - received };
  });
  const ready =
    counted.every((c) => c.received !== undefined && !c.over && !c.badBroken && (c.good <= 0n || c.d.rack !== "")) &&
    !(asked && charge <= 0) &&
    !receive.isPending;
  const set = (id: bigint, patch: Partial<CountDraft>) => setDrafts((prev) => ({ ...prev, [id.toString()]: { ...prev[id.toString()]!, ...patch } }));

  async function confirm() {
    try {
      await receive.mutateAsync({
        teamId,
        id: parcel.id,
        lines: counted.map((c) => ({
          itemId: c.line.id,
          received: c.received ?? 0n,
          broken: c.broken,
          rackId: c.good > 0n && c.d.rack !== "" ? BigInt(c.d.rack) : 0n,
        })),
        doorCharge: charge,
        doorChargeNote: charge > 0 ? note.trim() : "",
      });
      toaster.create({ type: "success", title: t("restockResolution.toast.received") });
      onClose();
    } catch (err) {
      failed(t, err);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} size={isMobile ? "full" : "lg"} scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="inbound-receive-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("restockResolution.inbound.receiveTitle", { id: parcel.id.toString() })}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
            <Dialog.Body>
              <Stack gap="card">
                <Text fontSize="sm" color="fg.muted">
                  {t("restockResolution.inbound.receiveMessage")}
                </Text>
                {counted.map(({ line, d, good, short, over, badBroken }) => (
                  <Stack key={line.id.toString()} gap="2" borderWidth="1px" borderRadius="md" p="3" data-testid={`inbound-count-${line.productId}`}>
                    <Flex justify="space-between" gap="2" wrap="wrap">
                      <Text fontWeight="bold" fontSize="sm">
                        {line.name}
                        <Span color="fg.muted" fontWeight="normal">{` · ${line.productCode}`}</Span>
                      </Text>
                      <Text fontSize="sm">{t("restockResolution.inbound.sent", { count: Number(line.count) })}</Text>
                    </Flex>
                    <Flex gap="field" wrap="wrap" align="flex-end">
                      <Field.Root required invalid={over} w="auto">
                        <Field.Label>
                          {t("restockResolution.inbound.received")}
                          <Field.RequiredIndicator />
                        </Field.Label>
                        <QuantityInput value={d.received} onChange={(v) => set(line.id, { received: v })} min={0} testId={`inbound-received-${line.productId}`} />
                        {over && <Field.ErrorText>{t("restockResolution.inbound.over")}</Field.ErrorText>}
                      </Field.Root>
                      <Field.Root invalid={badBroken} w="auto">
                        <Field.Label>{t("restockResolution.inbound.broken")}</Field.Label>
                        <QuantityInput value={d.broken} onChange={(v) => set(line.id, { broken: v })} min={0} testId={`inbound-broken-${line.productId}`} />
                      </Field.Root>
                      <Field.Root required flex="1" minW="12rem" disabled={good <= 0n}>
                        <Field.Label>
                          {t("restockResolution.inbound.rack", { count: Number(good > 0n ? good : 0n) })}
                          {good > 0n && <Field.RequiredIndicator />}
                        </Field.Label>
                        <RackSelect
                          warehouseId={parcel.warehouseId}
                          value={d.rack}
                          onChange={(v) => set(line.id, { rack: v })}
                          allowUnplaced={false}
                          disabled={good <= 0n}
                          testId={`inbound-rack-${line.productId}`}
                        />
                      </Field.Root>
                    </Flex>
                    <Text fontSize="xs" color={short > 0n ? "warning.fg" : "fg.muted"} data-testid={`inbound-short-${line.productId}`}>
                      {t("restockResolution.inbound.countLine", { good: Number(good > 0n ? good : 0n), short: Number(short) })}
                    </Text>
                  </Stack>
                ))}
                <Separator />
                <CourierCharge
                  asked={asked}
                  onAsked={setAsked}
                  amount={amount}
                  note={note}
                  onAmount={setAmount}
                  onNote={setNote}
                  testId="inbound-receive-courier"
                />
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("common.cancel")}</Button>
              </Dialog.ActionTrigger>
              <Button colorPalette="brand" disabled={!ready} loading={receive.isPending} data-testid="inbound-receive-confirm" onClick={() => void confirm()}>
                <Icon as={PackageCheck} boxSize="4" />
                {t("restockResolution.inbound.receive")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
