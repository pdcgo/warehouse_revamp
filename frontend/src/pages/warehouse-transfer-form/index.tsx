import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Field,
  Flex,
  HStack,
  Icon,
  IconButton,
  SimpleGrid,
  Span,
  Spacer,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useStockAvailability } from "../../features/inventory/queries";
import { useCreateWarehouseTransfer } from "../../features/warehouseTransfer/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { OwnStockedProductPicker } from "../../components/products/OwnStockedProductPicker";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import { toaster } from "../../components/feedback/Toaster";
import { TRANSFER_FORM_PENDING } from "./pending";

interface LineDraft {
  productId: bigint;
  sku: string;
  name: string;
  count: string;
}

const countOf = (raw: string) => (/^\d+$/.test(raw) ? BigInt(raw) : 0n);

// WarehouseTransferFormPage — the selling team opens a transfer to rebalance its stock
// (the-team-opens-the-sender-ships-the-receiver-accepts).
//
// The form asks only what the TEAM decides: from where, to where, which of its products and how many. Everything else
// is somebody else's or the system's:
//   - the pick list and the value — the system, from A's racks and batches, at create
//     (a-transfer-takes-from-the-sender-at-create, the-system-fills-a-transfers-prices), so there is no price here;
//   - the courier and the tracking number — Warehouse A, when it ships (the-sender-enters-the-courier-at-ship);
//   - the shipping cost — the team's, but usually known only after A has packed, so it is OPTIONAL here and editable
//     until accepted (the-shipping-expense-reaches-the-account-by-event).
//
// The lines are never edited after create (a-transfers-lines-are-never-edited) — a wrong transfer is cancelled and
// made again — so this is a create-only form.
export function WarehouseTransferFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();
  const create = useCreateWarehouseTransfer();

  const [fromId, setFromId] = useState(0n);
  const [toId, setToId] = useState(0n);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [accountId, setAccountId] = useState(0n);

  const teamId = current?.teamId;
  const costValue = cost === "" ? 0n : BigInt(cost);

  // What A holds of each picked product — a count above it would fail the create (a-shelf-never-goes-below-zero).
  const availability = useStockAvailability({
    teamId,
    warehouseId: fromId,
    productIds: lines.map((l) => l.productId),
  });
  const availableOf = (id: bigint) => availability.data?.get(id.toString());

  const back = () => navigate("/inventories/transfer");

  // Stock is held per building: a different A makes every line a different question, so the lines start over.
  function changeFrom(id: bigint) {
    setFromId(id);
    setLines([]);
    if (id === toId) setToId(0n);
  }

  // The picker owns WHICH products; this keeps the counts already typed for the ones still picked.
  function pick(products: PickedProduct[]) {
    setLines((before) =>
      products.map((p) => {
        const kept = before.find((l) => l.productId === p.id);

        return kept ?? { productId: p.id, sku: p.sku, name: p.name, count: "1" };
      }),
    );
  }

  const setCount = (productId: bigint, count: string) =>
    setLines((before) => before.map((l) => (l.productId === productId ? { ...l, count } : l)));

  const remove = (productId: bigint) => setLines((before) => before.filter((l) => l.productId !== productId));

  const pieces = lines.reduce((sum, l) => sum + countOf(l.count), 0n);
  const overStock = lines.some((l) => {
    const available = availableOf(l.productId);

    return available !== undefined && countOf(l.count) > available;
  });

  // What still stands between the form and a transfer — listed rather than a silently disabled button.
  const missing: string[] = [];
  if (fromId === 0n) missing.push(t("warehouseTransfer.form.missing.from"));
  if (toId === 0n) missing.push(t("warehouseTransfer.form.missing.to"));
  if (lines.length === 0) missing.push(t("warehouseTransfer.form.missing.lines"));
  if (lines.some((l) => countOf(l.count) === 0n)) missing.push(t("warehouseTransfer.form.missing.count"));
  if (overStock) missing.push(t("warehouseTransfer.form.missing.stock"));
  if (costValue > 0n && accountId === 0n) missing.push(t("warehouseTransfer.form.missing.account"));

  async function submit() {
    if (teamId === undefined) return;

    try {
      const res = await create.mutateAsync({
        teamId,
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        lines: lines.map((l) => ({ productId: l.productId, count: countOf(l.count) })),
        note: note.trim(),
        shipmentCost: costValue,
        financeAccountId: costValue > 0n ? accountId : 0n,
      });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.created") });
      navigate(`/inventories/transfer/${res.transfer?.id ?? ""}`);
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.createFailed"), description: rpcError(err) });
    }
  }

  if (teamId === undefined) {
    return <Text color="fg.muted">{t("warehouseTransfer.selectTeam")}</Text>;
  }

  return (
    <Stack gap="section" data-testid="transfer-form">
      <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="transfer-form-back" onClick={back}>
        <Icon as={ArrowLeft} boxSize="4" />
        {t("warehouseTransfer.form.back")}
      </Button>

      <NotImplementedSummary list={TRANSFER_FORM_PENDING} />

      {/* WHERE — A and B. B never equals A (a-transfer-never-goes-to-its-own-warehouse), so A is left out of B's list. */}
      <Card.Root>
        <Card.Header>
          <Card.Title>{t("warehouseTransfer.form.route")}</Card.Title>
        </Card.Header>
        <Card.Body>
          <Flex gap="card" align={{ base: "stretch", md: "end" }} direction={{ base: "column", md: "row" }}>
            <Field.Root required flex="1">
              <Field.Label>
                {t("warehouseTransfer.form.from")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Box w="full" data-testid="transfer-form-from">
                <TeamSelect
                  value={fromId > 0n ? fromId : undefined}
                  teamType={TeamType.WAREHOUSE}
                  placeholder={t("warehouseTransfer.form.fromPlaceholder")}
                  onChange={changeFrom}
                />
              </Box>
            </Field.Root>
            <Icon as={ArrowRight} boxSize="5" color="fg.muted" alignSelf="center" hideBelow="md" />
            <Field.Root required flex="1">
              <Field.Label>
                {t("warehouseTransfer.form.to")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Box w="full" data-testid="transfer-form-to">
                <TeamSelect
                  value={toId > 0n ? toId : undefined}
                  teamType={TeamType.WAREHOUSE}
                  excludeTeamIds={fromId > 0n ? [fromId] : []}
                  placeholder={t("warehouseTransfer.form.toPlaceholder")}
                  onChange={setToId}
                />
              </Box>
            </Field.Root>
          </Flex>
        </Card.Body>
      </Card.Root>

      {/* WHAT — the team's own products that A holds, one line each (a-product-appears-once-per-transfer). */}
      <Card.Root>
        <Card.Header>
          <Flex align="center" gap="card" wrap="wrap">
            <Card.Title>{t("warehouseTransfer.form.products")}</Card.Title>
            <Spacer />
            <OwnStockedProductPicker
              teamId={teamId}
              warehouseId={fromId}
              value={lines.map((l) => l.productId)}
              onChange={pick}
              disabled={fromId === 0n}
              trigger={
                <Button size="xs" variant="outline" disabled={fromId === 0n} data-testid="transfer-form-pick">
                  {t("warehouseTransfer.form.pickProducts")}
                </Button>
              }
            />
          </Flex>
        </Card.Header>
        <Card.Body>
          {fromId === 0n ? (
            <Text color="fg.muted" data-testid="transfer-form-pick-from-first">
              {t("warehouseTransfer.form.pickFromFirst")}
            </Text>
          ) : lines.length === 0 ? (
            <Text color="fg.muted" data-testid="transfer-form-no-lines">
              {t("warehouseTransfer.form.noLines")}
            </Text>
          ) : (
            <Stack gap="card">
              {lines.map((line) => {
                const available = availableOf(line.productId);
                const over = available !== undefined && countOf(line.count) > available;

                return (
                  <Flex
                    key={line.productId.toString()}
                    gap="card"
                    align="center"
                    wrap="wrap"
                    data-testid={`transfer-form-line-${line.productId}`}
                  >
                    <Stack gap="0" flex="1" minW="48">
                      <Span fontWeight="medium">{line.name}</Span>
                      <Span fontSize="xs" color="fg.muted">
                        {line.sku}
                      </Span>
                    </Stack>
                    <Stack gap="0" align="end">
                      <QuantityInput
                        value={line.count}
                        onChange={(v) => setCount(line.productId, v)}
                        min={1}
                        max={available !== undefined ? Number(available) : undefined}
                        testId={`transfer-form-count-${line.productId}`}
                      />
                      <Span
                        fontSize="xs"
                        color={over ? "error.fg" : "fg.muted"}
                        data-testid={`transfer-form-available-${line.productId}`}
                      >
                        {available === undefined
                          ? t("warehouseTransfer.form.availableUnknown")
                          : t("warehouseTransfer.form.available", { count: available.toString() })}
                      </Span>
                    </Stack>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label={t("warehouseTransfer.form.removeLine")}
                      data-testid={`transfer-form-remove-${line.productId}`}
                      onClick={() => remove(line.productId)}
                    >
                      <Icon as={Trash2} boxSize="4" />
                    </IconButton>
                  </Flex>
                );
              })}
            </Stack>
          )}
        </Card.Body>
      </Card.Root>

      {/* THE TRIP'S COST — optional now (the courier prices by the packed weight), editable until accepted. */}
      <Card.Root>
        <Card.Header>
          <Card.Title>{t("warehouseTransfer.form.shipping")}</Card.Title>
          <Card.Description>{t("warehouseTransfer.form.shippingHint")}</Card.Description>
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
            <Field.Root>
              <Field.Label>
                <HStack gap="1.5">
                  {t("warehouseTransfer.cost.shippingCost")}
                  <NotImplemented list={TRANSFER_FORM_PENDING} id="costEvent" />
                </HStack>
              </Field.Label>
              <CurrencyInput value={cost} onChange={setCost} data-testid="transfer-form-cost" />
            </Field.Root>
            <Field.Root required={costValue > 0n}>
              <Field.Label>
                {t("warehouseTransfer.cost.account")}
                <Field.RequiredIndicator />
              </Field.Label>
              <FinancialAccountSelect
                teamId={teamId}
                value={accountId > 0n ? accountId : undefined}
                onChange={setAccountId}
                operationalOnly
                disabled={costValue === 0n}
                testId="transfer-form-account"
              />
            </Field.Root>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Field.Root>
        <Field.Label>{t("warehouseTransfer.form.note")}</Field.Label>
        <Textarea
          value={note}
          maxLength={1000}
          rows={2}
          placeholder={t("warehouseTransfer.form.notePlaceholder")}
          data-testid="transfer-form-note"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field.Root>

      <Card.Root data-testid="transfer-form-summary">
        <Card.Body>
          <Flex gap="card" align="center" wrap="wrap">
            <Stack gap="0">
              <Text fontWeight="bold" data-testid="transfer-form-pieces">
                {t("warehouseTransfer.table.itemsSummary", { count: lines.length, pieces: pieces.toString() })}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {t("warehouseTransfer.form.valueHint")}
              </Text>
              {missing.length > 0 && (
                <Text fontSize="sm" color="fg.muted" data-testid="transfer-form-missing">
                  {t("warehouseTransfer.form.stillNeeded", { parts: missing.join(" · ") })}
                </Text>
              )}
            </Stack>
            <Spacer />
            <Button
              colorPalette="brand"
              disabled={missing.length > 0}
              loading={create.isPending}
              data-testid="transfer-form-submit"
              onClick={() => void submit()}
            >
              {t("warehouseTransfer.form.submit")}
            </Button>
          </Flex>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
