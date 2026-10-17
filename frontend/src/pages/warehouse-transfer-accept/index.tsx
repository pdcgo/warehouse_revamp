import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Field, Flex, Heading, HStack, Icon, Input, SimpleGrid, Spacer, Spinner, Stack, Stat, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { rpcError } from "../../api/clients";
import { WarehouseTransferStatus as S } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useAcceptWarehouseTransfer, useWarehouseTransfer } from "../../features/warehouseTransfer/queries";
import { directionFor, parseTransferId } from "../../features/warehouseTransfer/summary";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { CountLineCard } from "./components/CountLineCard";
import { type LineCount, emptyCount, goodOf, isCounted, problemOf, toCount } from "./count";
import { TRANSFER_ACCEPT_PENDING } from "./pending";

// WarehouseTransferAcceptPage — Warehouse B COUNTS THE BOX IN (the-team-opens-the-sender-ships-the-receiver-accepts).
//
// Accepting IS the count: every line once, what arrived (broken included), how many are broken, and where every good
// unit goes on B's racks. Missing is worked out, never typed. Then the courier's charge at the door, if it asked one —
// B pays it and the team owes it back (the-on-site-charge-is-paid-by-b-at-accept). The server locks the transfer and
// accepts only from shipped or arrived, so a second accept is refused (a-transfer-is-locked-before-any-status-change).
export function WarehouseTransferAcceptPage() {
  const { t } = useTranslation();
  const { transferId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const accept = useAcceptWarehouseTransfer();

  const id = parseTransferId(transferId);
  const teamId = current?.teamId;
  const query = useWarehouseTransfer({ teamId, transferId: id });
  const transfer = query.data ?? null;

  const [lines, setLines] = useState<LineCount[]>([]);
  const [charge, setCharge] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  // The count starts EMPTY for every line: an accept nobody counted must not go through on defaults.
  useEffect(() => {
    if (transfer && lines.length === 0) setLines(transfer.items.map(emptyCount));
  }, [transfer, lines.length]);

  const toDetail = () => navigate(`/inventories/transfer/${id}`);

  if (!current || teamId === undefined) {
    return <Text color="fg.muted">{t("warehouseTransfer.selectTeam")}</Text>;
  }

  if (query.isPending && id !== 0n) {
    return <Spinner colorPalette="brand" />;
  }

  const acceptable =
    transfer !== null &&
    directionFor(transfer, teamId) === "incoming" &&
    (transfer.status === S.SHIPPED || transfer.status === S.ARRIVED);

  if (!transfer || !acceptable) {
    return (
      <Stack gap="section">
        <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="accept-back" onClick={toDetail}>
          <Icon as={ArrowLeft} boxSize="4" />
          {t("warehouseTransfer.accept.back")}
        </Button>
        <Text color="error.fg" data-testid="accept-not-acceptable">
          {query.isError ? rpcError(query.error) : t("warehouseTransfer.accept.notAcceptable")}
        </Text>
      </Stack>
    );
  }

  const itemOf = (line: LineCount) => transfer.items.find((item) => item.id === line.itemId)!;
  const chargeValue = toCount(charge);
  const sent = transfer.items.reduce((sum, item) => sum + item.count, 0n);
  const arrived = lines.reduce((sum, line) => sum + toCount(line.arrived), 0n);
  const good = lines.reduce((sum, line) => sum + (isCounted(line) ? goodOf(line) : 0n), 0n);
  const uncounted = lines.filter((line) => !isCounted(line)).length;
  const blocked =
    lines.length === 0 ||
    lines.some((line) => problemOf(itemOf(line), line) !== null) ||
    (chargeValue > 0n && chargeNote.trim() === "");

  async function confirm() {
    try {
      await accept.mutateAsync({
        teamId: teamId!,
        transferId: transfer!.id,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          arrivedCount: toCount(line.arrived),
          brokenCount: toCount(line.broken),
          brokenNote: line.brokenNote.trim(),
          missingNote: line.missingNote.trim(),
          placements: line.placements
            .filter((p) => toCount(p.quantity) > 0n)
            .map((p) => ({ placementId: BigInt(p.rackId), quantity: toCount(p.quantity) })),
        })),
        warehouseAdditionalCost: chargeValue,
        warehouseAdditionalCostNote: chargeNote.trim(),
      });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.accepted") });
      toDetail();
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.acceptFailed"), description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section" data-testid="accept-page">
      <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="accept-back" onClick={toDetail}>
        <Icon as={ArrowLeft} boxSize="4" />
        {t("warehouseTransfer.accept.back")}
      </Button>

      <Heading size="md" data-testid="accept-title">
        {t("warehouseTransfer.accept.title", { id: transfer.id.toString() })}
      </Heading>

      <NotImplementedSummary list={TRANSFER_ACCEPT_PENDING} />

      {lines.map((line, i) => (
        <CountLineCard
          key={line.itemId.toString()}
          item={itemOf(line)}
          line={line}
          warehouseId={teamId}
          onChange={(next) => setLines((before) => before.map((l, j) => (j === i ? next : l)))}
        />
      ))}

      {/* THE COURIER'S CHARGE AT THE DOOR — B pays it, the team owes it back. A note says what it was for. */}
      <Card.Root data-testid="accept-charge">
        <Card.Header>
          <Card.Title>
            <HStack gap="1.5">
              {t("warehouseTransfer.accept.charge")}
              <NotImplemented list={TRANSFER_ACCEPT_PENDING} id="courierDebt" />
            </HStack>
          </Card.Title>
          <Card.Description>{t("warehouseTransfer.accept.chargeHint")}</Card.Description>
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
            <Field.Root>
              <Field.Label>{t("warehouseTransfer.accept.chargeAmount")}</Field.Label>
              <CurrencyInput value={charge} onChange={setCharge} data-testid="accept-charge-amount" />
            </Field.Root>
            <Field.Root required={chargeValue > 0n} invalid={chargeValue > 0n && chargeNote.trim() === ""}>
              <Field.Label>
                {t("warehouseTransfer.accept.chargeNote")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Input
                value={chargeNote}
                maxLength={200}
                disabled={chargeValue === 0n}
                data-testid="accept-charge-note"
                onChange={(e) => setChargeNote(e.target.value)}
              />
            </Field.Root>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Card.Root data-testid="accept-summary">
        <Card.Body>
          <Flex gap="card" align="center" wrap="wrap">
            <SimpleGrid columns={{ base: 2, md: 4 }} gap="card" flex="1">
              <Stat.Root>
                <Stat.Label>{t("warehouseTransfer.accept.summarySent")}</Stat.Label>
                <Stat.ValueText>{sent.toString()}</Stat.ValueText>
              </Stat.Root>
              <Stat.Root>
                <Stat.Label>{t("warehouseTransfer.accept.summaryArrived")}</Stat.Label>
                <Stat.ValueText data-testid="accept-summary-arrived">{arrived.toString()}</Stat.ValueText>
              </Stat.Root>
              <Stat.Root>
                <Stat.Label>{t("warehouseTransfer.accept.summaryGood")}</Stat.Label>
                <Stat.ValueText data-testid="accept-summary-good">{good.toString()}</Stat.ValueText>
              </Stat.Root>
              <Stat.Root>
                <Stat.Label>{t("warehouseTransfer.accept.summaryUncounted")}</Stat.Label>
                <Stat.ValueText color={uncounted > 0 ? "warning.fg" : undefined} data-testid="accept-summary-uncounted">
                  {uncounted}
                </Stat.ValueText>
              </Stat.Root>
            </SimpleGrid>
            <Spacer />
            <Button
              colorPalette="brand"
              disabled={blocked}
              data-testid="accept-submit"
              onClick={() => setConfirming(true)}
            >
              {t("warehouseTransfer.actions.accept")}
            </Button>
          </Flex>
        </Card.Body>
      </Card.Root>

      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(false)}
          destructive={false}
          title={t("warehouseTransfer.accept.confirmTitle", { id: transfer.id.toString() })}
          message={t("warehouseTransfer.accept.confirmMessage", { good: good.toString(), sent: sent.toString() })}
          confirmLabel={t("warehouseTransfer.actions.accept")}
          dismissLabel={t("warehouseTransfer.accept.keepCounting")}
          onConfirm={confirm}
        />
      )}
    </Stack>
  );
}
