import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, PackageCheck, Printer, Receipt } from "lucide-react";
import { rpcError } from "../../api/clients";
import {
  RestockDamageType,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamDetail } from "../../features/teams/queries";
import { useRackCodes } from "../../features/racks/queries";
import { useRestockRequest } from "../../features/restock/queries";
import { DetailField } from "../../features/restock/DetailField";
import { DamageCell } from "../../features/restock/DamageCell";
import { lineTotal, rackLabel, unitPrice } from "../../features/restock/lines";
import {
  askedQuantity,
  brokenQuantity,
  damageReasons,
  goodsTotal,
  lostQuantity,
  receivedQuantity,
} from "../../features/restock/summary";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { ShippingBadge } from "../../components/badges/ShippingBadge";
import { formatUnixDate } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// RestockWarehouseDetailPage — ONE DELIVERY AS THE RECEIVING WAREHOUSE SEES IT (#133/#125).
//
// The other half of the detail split. This page answers: what is coming, has it been counted, where
// did it go, and what is each piece worth now that it is on my shelf.
//
// THE COMMERCIAL TERMS ARE GONE, and that is the substance of the split rather than a tidy-up. The
// supplier, the payment type and the order reference are the buying team's relationship with its
// own supplier, and a warehouse does not act on them.
//
// ⚠ The second half of that argument NO LONGER HOLDS, and the field is still absent by choice. This
// used to add "nor can it even read them" — SupplierDetail is scoped to the requesting team, so
// asking returned NotFound and the field showed "Supplier #7". SupplierByIds (2026-07-30, owner)
// removed that barrier for the ACCEPT screen, where the crew is holding the supplier's carton and a
// number instead of a name costs them the check they are there to make. THIS page is a record being
// read after the fact, not a box being matched, so the reason to omit the supplier here is now
// relevance rather than permission. Adding it back is a decision, not a bug fix.
//
// The LANDED COST stays, and the distinction is deliberate: purchase terms are somebody else's
// business, but what a piece cost to get here is this warehouse's own — it is the basis of the cost
// layer acceptance froze (#155/#209), and the crew that typed the COD fee is the crew reading this.
//
// The PLACE column is the one this page has and the buyer's does not. Counting and shelving are one
// act (#137), so where each part of a line went belongs beside what arrived.
export function RestockWarehouseDetailPage() {
  const { t } = useTranslation();
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

  const id = parseRequestId(requestId);
  const teamId = current?.teamId;

  const query = useRestockRequest({ teamId, requestId: id });

  const request = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  const error =
    id === 0n
      ? t("restock.detail.invalidId")
      : query.isError
        ? rpcError(query.error)
        : "";

  const requestingTeamId = request?.requestingTeamId ?? 0n;
  const warehouseId = request?.warehouseId ?? 0n;

  // Only a FULFILLED request has been counted, so it is the only one whose `receivedQuantity` and
  // placements mean anything. On a pending or cancelled one they are empty because nobody ever
  // opened the box — rendering that would read as "nothing came", not "not counted yet".
  const isFulfilled = request?.status === RestockRequestStatus.FULFILLED;

  // Who the goods are coming FROM — the column the buyer's page has no use for, since there it is
  // always the reader. TeamDetail is unscoped, so the name resolves for either side.
  const requester = useTeamDetail({
    teamId: requestingTeamId,
    enabled: requestingTeamId > 0n,
  });

  // Racks belong to the warehouse, so the codes resolve here and nowhere else. Asked for only once
  // there are placements to translate — before acceptance there is no place to resolve.
  const rackCodes = useRackCodes({ warehouseId, enabled: isFulfilled });
  const codes = rackCodes.data ?? {};

  const items = useMemo(() => request?.items ?? [], [request]);
  const productsTotal = useMemo(() => goodsTotal(items), [items]);
  const askedTotal = useMemo(() => askedQuantity(items), [items]);
  const receivedTotal = useMemo(() => receivedQuantity(items), [items]);

  const codFee = request?.codShippingFee ?? 0n;
  const grandTotal = productsTotal + (request?.shippingCost ?? 0n) + codFee;

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.detail.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-detail-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !request) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="restock-detail-back"
          onClick={() => navigate("/inventories/restock")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("restock.detail.back")}
        </Button>
        <Text color="red.fg" data-testid="restock-detail-error">
          {error || t("restock.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const isPending = request.status === RestockRequestStatus.PENDING;
  const short =
    isFulfilled && receivedTotal < askedTotal ? askedTotal - receivedTotal : 0n;

  return (
    <Stack gap="section" data-testid="restock-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="restock-detail-back"
        onClick={() => navigate("/inventories/restock")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("restock.detail.back")}
      </Button>

      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md" data-testid="restock-detail-title">
          {t("restock.detail.requestTitle", { id: request.id.toString() })}
        </Heading>
        <RestockStatusBadge status={request.status} />
        {short > 0n && (
          <Badge colorPalette="orange" data-testid="restock-detail-short">
            {t("restock.table.shortBy", { count: Number(short) })}
          </Badge>
        )}
        <Spacer />

        {/* Accepting is COUNTING (#133) — and since #154 also saying WHERE each part of a line went
            and what arrived broken, with the COD fee (#155) changing what it all cost. That is a form
            with sections, so it is a PAGE (#157), not a dialog.

            No `isWarehouse` guard any more: this page only renders for the warehouse the request
            targets, because RestockRequestDetail is scoped to exactly the two sides and the router
            picks this component by team type. */}
        {isPending && (
          <Button
            colorPalette="brand"
            data-testid="restock-detail-fulfil"
            onClick={() =>
              navigate(`/inventories/restock/${request.id}/accept`)
            }
          >
            <Icon as={PackageCheck} boxSize="4" />
            {t("restock.receive.title")}
          </Button>
        )}

        {/* The two things the crew does right after accepting: label what it shelved (#207), and
            file the goods-received document (#219). */}
        {isFulfilled && (
          <Button
            variant="outline"
            data-testid="restock-detail-labels"
            onClick={() =>
              navigate(`/inventories/restock/${request.id}/labels`)
            }
          >
            <Icon as={Printer} boxSize="4" />
            {t("restock.labels.action")}
          </Button>
        )}

        {isFulfilled && (
          <Button
            variant="outline"
            data-testid="restock-detail-receipt"
            onClick={() =>
              navigate(`/inventories/restock/${request.id}/receipt`)
            }
          >
            <Icon as={Receipt} boxSize="4" />
            {t("restock.table.receipt")}
          </Button>
        )}
      </Flex>

      {/* THE DELIVERY. No destination — every restock this page can open targets the warehouse
          reading it. What varies, and therefore what is shown, is where it comes from and how. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.delivery")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 4 }} gap="card">
              <DetailField
                label={t("restock.table.from")}
                value={
                  requester.data?.name ||
                  t("restock.teamRef", {
                    id: request.requestingTeamId.toString(),
                  })
                }
                testId="restock-detail-from"
              />
              <DetailField
                label={t("restock.table.shipment")}
                value={<ShippingBadge code={request.shippingCode} />}
              />
              {/* The tracking number IS the warehouse's business — it is how the crew chases a
                  delivery that has not turned up. */}
              <DetailField
                label={t("restock.form.receipt")}
                value={request.receipt}
                testId="restock-detail-tracking"
              />
              <DetailField
                label={t("restock.detail.created")}
                value={formatUnixDate(request.createdAtUnix)}
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The note stays, and it is the one free-text field that unambiguously belongs here — its own
          help text on the create form reads "anything the warehouse should know about this restock". */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.note")}
            </Text>
            <Text
              fontSize="sm"
              whiteSpace="pre-wrap"
              data-testid="restock-detail-note"
            >
              {request.note || "—"}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* maxW="full" + a scrolling table: EIGHT columns here (the buyer's seven plus Place) do not
          fit a laptop, and without both the card grows and the whole page scrolls sideways instead. */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.products")}
            </Text>

            <Table.ScrollArea>
              <Table.Root size="sm" data-testid="restock-detail-items">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>
                      {t("restock.detail.sku")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      {t("restock.detail.name")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.detail.asked")}
                    </Table.ColumnHeader>
                    {/* ACCEPTED · LOST · BROKEN (owner) — the same three columns the buyer's Product tab
                      carries, ALWAYS PRESENT for the same reason: gated on acceptance they were absent
                      from every restock still waiting, which is most of them, so the table looked as
                      though it had never gained them. An uncounted line reads "—" (not counted yet),
                      never 0 (nothing arrived).

                      The two pages must agree: this is the side that WROTE these numbers at the door,
                      so a warehouse reading its own record must see exactly what the team it supplies
                      is reading about that record. "Arrived" became "Accepted" for the same reason —
                      the number is what became sellable stock, and broken units arrived too.

                      PLACE stays gated, and the difference is real: an uncounted line has no shelf
                      because nothing has been put anywhere, and an em dash there would invite the crew
                      to wonder which shelf they had forgotten. */}
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.detail.accepted")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.accept.problemLost")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.accept.problemBroken")}
                    </Table.ColumnHeader>
                    {isFulfilled && (
                      <Table.ColumnHeader>
                        {t("restock.detail.place")}
                      </Table.ColumnHeader>
                    )}
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.detail.unitPrice")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.detail.lineTotal")}
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {request.items.map((item) => {
                    // Weights the number when the count came out other than the ask, either way. The
                    // "short by n" badge that used to sit beside it is gone (owner) — see below.
                    const differs = isFulfilled && item.receivedQuantity !== item.quantity;

                    return (
                      <Table.Row
                        key={item.id.toString()}
                        data-testid={`restock-detail-item-${item.productId}`}
                      >
                        <Table.Cell>{item.sku}</Table.Cell>
                        <Table.Cell>{item.name}</Table.Cell>
                        <Table.Cell textAlign="end">
                          {item.quantity.toString()}
                        </Table.Cell>
                        {/* An em dash before the count, never the 0 the field holds — see the header. */}
                        <Table.Cell
                          textAlign="end"
                          color={isFulfilled ? undefined : "fg.muted"}
                          data-testid={`restock-detail-received-${item.productId}`}
                        >
                          {/* NO "short by n" BADGE (owner), same as the buyer's tab: Asked · Accepted ·
                              Lost · Broken across the row IS the discrepancy, itemised, and the badge
                              could only restate the total while implying all of it was shortfall. The
                              number stays bold when it differs from the ask. */}
                          {isFulfilled ? (
                            <Text
                              as="span"
                              fontWeight={differs ? "semibold" : "normal"}
                            >
                              {item.receivedQuantity.toString()}
                            </Text>
                          ) : (
                            "—"
                          )}
                        </Table.Cell>
                        {/* The shared DamageCell, so the number and its reason read identically on both
                          detail pages (features/restock/DamageCell). No status gate: an uncounted line
                          has no damage rows, so its own zero-is-an-em-dash rule already says
                          "not counted". */}
                        <DamageCell
                          quantity={lostQuantity(item)}
                          reasons={damageReasons(item, RestockDamageType.LOST)}
                          testId={`restock-detail-lost-${item.productId}`}
                        />
                        <DamageCell
                          quantity={brokenQuantity(item)}
                          reasons={damageReasons(
                            item,
                            RestockDamageType.BROKEN,
                          )}
                          testId={`restock-detail-broken-${item.productId}`}
                        />
                        {isFulfilled && (
                          <Table.Cell
                            data-testid={`restock-detail-place-${item.productId}`}
                          >
                            {rackLabel(t, item, codes) || "—"}
                          </Table.Cell>
                        )}
                        <Table.Cell textAlign="end">
                          {formatRupiah(unitPrice(item))}
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          {formatRupiah(lineTotal(item))}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>

            <Separator />

            <Stack gap="1" align="end">
              {/* What this warehouse is actually holding because of this delivery — the number the
                  money below cannot tell you, since the money is what was ORDERED. */}
              {isFulfilled && (
                <Text fontSize="sm" color="fg.muted">
                  {t("restock.detail.receivedTotal")}:{" "}
                  <Text
                    as="span"
                    fontWeight="medium"
                    data-testid="restock-detail-received-total"
                  >
                    {receivedTotal.toString()} / {askedTotal.toString()}
                  </Text>
                </Text>
              )}
              <Text fontSize="sm" color="fg.muted">
                {t("restock.summary.productsTotal")}:{" "}
                <Text as="span" data-testid="restock-detail-products-total">
                  {formatRupiah(productsTotal)}
                </Text>
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {t("restock.form.shippingCost")}:{" "}
                <Text as="span" data-testid="restock-detail-shipping">
                  {formatRupiah(request.shippingCost)}
                </Text>
              </Text>
              {/* The fee THIS warehouse paid at the door (#155) — hidden until there is one, since
                  most deliveries are not COD. */}
              {codFee > 0n && (
                <Text fontSize="sm" color="fg.muted">
                  {t("restock.accept.codFee")}:{" "}
                  <Text as="span" data-testid="restock-detail-cod-fee">
                    {formatRupiah(codFee)}
                  </Text>
                </Text>
              )}
              <Text
                fontSize="md"
                fontWeight="semibold"
                data-testid="restock-detail-total"
              >
                {t("restock.summary.grandTotal")}: {formatRupiah(grandTotal)}
              </Text>
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
