import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  NativeSelect,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, History, LayoutGrid, Plus, Trash2, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockDamageType } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CurrencyInput } from "../../components/CurrencyInput";
import { ProductListItem } from "../../components/ProductListItem";
import { RackSelect, UNPLACED } from "../../components/RackSelect";
import { ShippingBadge } from "../../components/ShippingBadge";
import { toaster } from "../../components/Toaster";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { useRestockRequest, useFulfillRestockRequest } from "../../features/restock/queries";
import { useProductPlaces } from "../../features/inventory/queries";
import { deltaLabel, toReceived, toRupiah, unitHpp } from "../../features/restock/counting";

// One shelf a line's goods went to, and how many. `place` is RackSelect's value: "" (no shelf yet —
// this is what blocks Accept), UNPLACED (the holding pile), or a rack id string.
interface PlacementDraft {
  key: string;
  place: string;
  quantity: string;
}

// One problem row: what failed to become stock, how many, and why (#154).
interface ProblemDraft {
  key: string;
  type: "broken" | "lost";
  quantity: string;
  note: string;
}

let seq = 0;

function nextKey(): string {
  seq += 1;
  return `d${seq}`;
}

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function formatDate(unix: bigint): string {
  if (unix <= 0n) return "";
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// RestockAcceptPage — how a warehouse ACCEPTS a delivery (#157), redesigned to the owner's mock
// (#201/#206, mocks/accept-rack.html).
//
// THE RESTOCK COUNT IS DERIVED, NEVER TYPED (owner, 2026-07-23). There is no separate "arrived" box:
// what you put on the shelves plus what you flag as a problem IS the count. You type quantities in ONE
// place — the shelf rows and the problem rows — and the header, the per-line balance, the HPP and the
// Accept button all read off that.
//
//   line count = placed (on named shelves + the holding pile) + problems (broken / lost)
//   received (what stock hears about) = placed only — problems never enter stock (#154)
//
// A shelf row with a quantity but NO shelf chosen yet is what blocks Accept: goods that arrived are
// somewhere, and the system is told rather than left to guess (#137). Each line seeds with the ordered
// quantity on one unplaced row — a claim to confirm by naming a shelf, not a silent write-off (#133).
export function RestockAcceptPage() {
  const { current } = useTeam();
  const { requestId: rawId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const requestId = parseRequestId(rawId);

  // Only the DRAFTS are state — what the person accepting is typing. The request and the existing
  // shelf placements come from queries.
  const [submitError, setSubmitError] = useState("");
  const [placements, setPlacements] = useState<Record<string, PlacementDraft[]>>({});
  const [problems, setProblems] = useState<Record<string, ProblemDraft[]>>({});
  const [codFee, setCodFee] = useState("0");

  const fulfill = useFulfillRestockRequest();
  const busy = fulfill.isPending;

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  const query = useRestockRequest({ teamId, requestId });
  const request = query.data ?? null;
  const loading = query.isPending && teamId !== undefined && requestId !== 0n;
  const error = query.isError ? rpcError(query.error) : submitError;

  // Where these products already live, so a put-away joins the existing pile (#156). Help, not a gate.
  const placesQuery = useProductPlaces({
    warehouseId: teamId,
    productIds: (request?.items ?? []).map((i) => i.productId),
  });
  const places = placesQuery.data ?? [];

  // Seed once per request: one placement row prefilled with the ORDERED quantity and NO shelf — the
  // asked number offered back for confirmation, blocking Accept until a shelf is named.
  const seededFor = useRef<string>("");

  useEffect(() => {
    if (!request) return;
    const id = request.id.toString();
    if (seededFor.current === id) return;
    seededFor.current = id;

    const nextPlacements: Record<string, PlacementDraft[]> = {};
    for (const item of request.items) {
      nextPlacements[item.id.toString()] = [
        { key: nextKey(), place: "", quantity: item.quantity.toString() },
      ];
    }
    setPlacements(nextPlacements);
    setProblems({});
  }, [request]);

  const items = useMemo(() => request?.items ?? [], [request]);

  const freight = (request?.shippingCost ?? 0n) + toRupiah(codFee);

  // Per-line arithmetic, in one place so the header, the pill and the payload cannot disagree.
  function lineState(item: RestockRequestItem) {
    const key = item.id.toString();
    const rows = placements[key] ?? [];

    let placed = 0n;
    let blocking = 0n;
    for (const row of rows) {
      const qty = toReceived(row.quantity);
      if (qty === 0n) continue;
      if (row.place === "") blocking += qty;
      else placed += qty;
    }

    const problemQty = (problems[key] ?? []).reduce((sum, p) => sum + toReceived(p.quantity), 0n);

    return {
      key,
      rows,
      placed,
      blocking,
      problemQty,
      count: placed + blocking + problemQty,
      ready: blocking === 0n,
    };
  }

  // Freight rides on every SHELVED (sellable) unit across the whole delivery — problems carry none.
  const sellableTotal = items.reduce((sum, item) => sum + lineState(item).placed, 0n);

  const ready = items.length > 0 && items.every((item) => lineState(item).ready);

  const totalReceived = items.reduce((sum, item) => sum + lineState(item).count, 0n);
  const blockedLines = items.filter((item) => !lineState(item).ready).length;

  function patchPlacement(itemKey: string, rowKey: string, patch: Partial<PlacementDraft>) {
    setPlacements((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).map((r) => (r.key === rowKey ? { ...r, ...patch } : r)),
    }));
  }

  function addPlacement(itemKey: string) {
    setPlacements((prev) => ({
      ...prev,
      [itemKey]: [...(prev[itemKey] ?? []), { key: nextKey(), place: "", quantity: "0" }],
    }));
  }

  function removePlacement(itemKey: string, rowKey: string) {
    setPlacements((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).filter((r) => r.key !== rowKey),
    }));
  }

  // A "placed here before" chip drops the goods onto a shelf they sat on already: it fills the first
  // row with no shelf chosen, else the first row (#156).
  function applyRecommendation(itemKey: string, rackId: bigint) {
    setPlacements((prev) => {
      const rows = prev[itemKey] ?? [];
      const target = rows.find((r) => r.place === "") ?? rows[0];
      if (!target) return prev;
      return {
        ...prev,
        [itemKey]: rows.map((r) => (r.key === target.key ? { ...r, place: rackId.toString() } : r)),
      };
    });
  }

  function addProblem(itemKey: string) {
    setProblems((prev) => ({
      ...prev,
      [itemKey]: [...(prev[itemKey] ?? []), { key: nextKey(), type: "broken", quantity: "1", note: "" }],
    }));
  }

  function patchProblem(itemKey: string, rowKey: string, patch: Partial<ProblemDraft>) {
    setProblems((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).map((r) => (r.key === rowKey ? { ...r, ...patch } : r)),
    }));
  }

  function removeProblem(itemKey: string, rowKey: string) {
    setProblems((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).filter((r) => r.key !== rowKey),
    }));
  }

  async function accept() {
    if (teamId === undefined || !request) return;
    setSubmitError("");

    try {
      await fulfill.mutateAsync({
        teamId,
        requestId: request.id,
        codShippingFee: toRupiah(codFee),
        // Built from `request.items` so the payload's shape comes from the REQUEST and cannot drop a
        // line a map missed. received = the shelved units; the problems ride separately (#154).
        lines: request.items.map((item) => {
          const st = lineState(item);
          return {
            itemId: item.id,
            receivedQuantity: st.placed,
            placements: st.rows
              .filter((r) => toReceived(r.quantity) > 0n && r.place !== "")
              .map((r) => ({
                place:
                  r.place === UNPLACED
                    ? ({ case: "unplaced", value: true } as const)
                    : ({ case: "rackId", value: BigInt(r.place) } as const),
                quantity: toReceived(r.quantity),
              })),
            damaged: (problems[item.id.toString()] ?? [])
              .filter((p) => toReceived(p.quantity) > 0n && p.note.trim() !== "")
              .map((p) => ({
                quantity: toReceived(p.quantity),
                reason: p.note.trim(),
                type:
                  p.type === "lost"
                    ? RestockDamageType.LOST
                    : RestockDamageType.BROKEN,
              })),
          };
        }),
      });

      toaster.create({ type: "success", title: t("restock.accept.toast.accepted") });
      navigate(`/inventories/restock/${request.id}`);
    } catch (err) {
      setSubmitError(rpcError(err));
      toaster.create({
        type: "error",
        title: t("restock.accept.toast.failed"),
        description: rpcError(err),
      });
    }
  }

  // The shelves this product already sits on, as chips to drop it back onto. Only real racks — the
  // unplaced pile is not a recommendation.
  function recommendations(productId: bigint) {
    return places.filter((p) => p.productId === productId && p.rackId !== 0n);
  }

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      onClick={() => navigate(`/inventories/restock/${rawId ?? ""}`)}
      data-testid="accept-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("restock.accept.back")}
    </Button>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.accept.title")}</Heading>
        <Text color="fg.muted" data-testid="accept-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.accept.title")}</Heading>
        <Text color="fg.muted" data-testid="accept-not-warehouse">
          {t("restock.accept.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack gap="section">
        {back}
        <Spinner colorPalette="brand" />
      </Stack>
    );
  }

  if (error || !request) {
    return (
      <Stack gap="section">
        {back}
        <Text color="red.fg" data-testid="accept-error">
          {error || t("restock.accept.notFound")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {back}

      {/* The action header rides at the top of the scroll (#201): on a long delivery the Accept button
          and the reason it is disabled must stay in reach. */}
      <Box position="sticky" top="0" zIndex="1" bg="bg" borderBottomWidth="1px" borderColor="border" py="card">
        <Flex align="center" gap="card" wrap="wrap">
          <Heading size="md">{t("restock.accept.heading", { id: request.id.toString() })}</Heading>
          <Badge colorPalette="brand">{current.teamName}</Badge>
          <Spacer />

          <Stack gap="0" textAlign="end" mr="1">
            <Text fontSize="sm" data-testid="accept-restock-count">
              {t("restock.accept.restockCount", { count: totalReceived.toString() })}
            </Text>
            {blockedLines > 0 && (
              <Text fontSize="xs" color="orange.fg" data-testid="accept-progress">
                {t("restock.accept.notPlaced", { count: blockedLines })}
              </Text>
            )}
          </Stack>

          {/* Accepting moves stock and cannot be undone, so it confirms first. */}
          <ConfirmDialog
            title={t("restock.accept.confirm.title")}
            message={t("restock.accept.confirm.message")}
            confirmLabel={t("restock.accept.confirm.label")}
            onConfirm={accept}
            trigger={
              <Button colorPalette="brand" disabled={!ready} loading={busy} data-testid="accept-submit">
                {t("restock.accept.action")}
              </Button>
            }
          />
        </Flex>
      </Box>

      {error && (
        <Text color="red.fg" data-testid="accept-error">
          {error}
        </Text>
      )}

      {/* Delivery summary, grouped (#206): the order, the shipment, and the freight the courier took at
          the door. Only the fields the model actually holds — a driver/receiver name and a shipped date
          are on the mock but not yet in the schema, so they are left out rather than faked. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Box>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb="2">
                {t("restock.accept.summary.order")}
              </Text>
              <SimpleGrid columns={{ base: 2, md: 3 }} gap="card">
                <SummaryField label={t("restock.accept.summary.orderRef")} value={request.orderRef || "—"} />
                <SummaryField
                  label={t("restock.accept.summary.supplier")}
                  value={request.supplierId !== 0n ? `#${request.supplierId.toString()}` : "—"}
                />
                <SummaryField label={t("restock.accept.summary.ordered")} value={formatDate(request.createdAtUnix) || "—"} />
              </SimpleGrid>
            </Box>

            <Separator />

            <Box>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb="2">
                {t("restock.accept.summary.shipping")}
              </Text>
              <SimpleGrid columns={{ base: 2, md: 3 }} gap="card">
                <Stack gap="0.5">
                  <Text fontSize="xs" color="fg.subtle">
                    {t("restock.accept.summary.courier")}
                  </Text>
                  {request.shippingCode ? <ShippingBadge code={request.shippingCode} /> : <Text>—</Text>}
                </Stack>
                <SummaryField
                  label={t("restock.accept.summary.receipt")}
                  value={request.receipt || "—"}
                  testId="accept-receipt"
                />
              </SimpleGrid>
            </Box>

            <Separator />

            <Box>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb="2">
                {t("restock.accept.summary.freight")}
              </Text>
              <SimpleGrid columns={{ base: 2, md: 3 }} gap="card">
                <SummaryField label={t("restock.form.shippingCost")} value={formatRupiah(request.shippingCost)} />
                <Stack gap="0.5">
                  <Text fontSize="xs" color="fg.subtle">
                    {t("restock.accept.codFee")}
                  </Text>
                  <CurrencyInput value={codFee} data-testid="accept-cod-fee" onChange={setCodFee} />
                </Stack>
                <Stack gap="0.5">
                  <Text fontSize="xs" color="fg.subtle">
                    {t("restock.accept.freightTotal")}
                  </Text>
                  <Text fontWeight="medium" data-testid="accept-freight-total">
                    {formatRupiah(freight)}
                  </Text>
                </Stack>
              </SimpleGrid>
            </Box>

            {request.note && (
              <Box borderTopWidth="1px" borderColor="border" pt="card">
                <Text fontSize="xs" color="fg.subtle">
                  {t("restock.form.note")}
                </Text>
                <Text data-testid="accept-note">{request.note}</Text>
              </Box>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      {items.map((item) => {
        const st = lineState(item);
        const hpp = unitHpp(item.totalPrice, st.placed, freight, sellableTotal);
        const delta = deltaLabel(t, item.quantity, st.count);
        const recs = recommendations(item.productId);
        const problemRows = problems[st.key] ?? [];

        return (
          <Card.Root key={st.key} data-testid={`accept-line-${item.productId}`}>
            <Card.Body>
              <Stack gap="card">
                {/* The product, through the shared component (#143). No stock badge — that means the
                    warehouse total (#138), and nothing here has loaded one. */}
                <ProductListItem
                  product={{ id: item.productId, sku: item.sku, name: item.name }}
                  action={
                    <Stack gap="0" textAlign="end">
                      <Text fontSize="xs" color="fg.muted">
                        {t("restock.accept.hpp")}
                      </Text>
                      <Text fontWeight="medium" data-testid={`accept-hpp-${item.productId}`}>
                        {/* No unit cost until something is shelved — "Rp 0" would read as free (#74),
                            so an unplaced line shows a dash until it has a sellable count to divide. */}
                        {st.placed > 0n ? t("restock.accept.perPiece", { price: formatRupiah(hpp) }) : "—"}
                      </Text>
                    </Stack>
                  }
                />

                <Separator />

                {/* PUT-AWAY is the whole line now (#206): what you shelve here + what you flag is the
                    count. The balance pill turns from "{n} to place" to a settled total as every typed
                    quantity gets a shelf. */}
                <Box borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.muted" p="card">
                  <Stack gap="card">
                    <Flex align="center" gap="2" wrap="wrap">
                      <Icon as={LayoutGrid} boxSize="4" color="brand.fg" />
                      <Text fontSize="sm" fontWeight="semibold">
                        {t("restock.accept.putaway")}
                      </Text>
                      <Text fontSize="xs" color="fg.subtle">
                        {t("restock.accept.ordered", { n: item.quantity.toString() })}
                      </Text>
                      {delta && (
                        <Badge
                          colorPalette={st.count < item.quantity ? "orange" : "green"}
                          data-testid={`accept-delta-${item.productId}`}
                        >
                          {delta}
                        </Badge>
                      )}
                      <Spacer />
                      {st.blocking > 0n ? (
                        <Badge colorPalette="orange" data-testid={`accept-unbalanced-${item.productId}`}>
                          {t("restock.accept.toPlace", { count: st.blocking.toString() })}
                        </Badge>
                      ) : (
                        <Badge colorPalette="green" data-testid={`accept-balanced-${item.productId}`}>
                          {t("restock.accept.pcs", { count: st.count.toString() })}
                        </Badge>
                      )}
                    </Flex>

                    {/* Placed here before — clickable, drops it onto a shelf it already sits on (#156). */}
                    {recs.length > 0 && (
                      <Flex align="center" gap="2" wrap="wrap">
                        <Flex align="center" gap="1" color="fg.muted">
                          <Icon as={History} boxSize="3.5" />
                          <Text fontSize="xs">{t("restock.accept.placedBefore")}</Text>
                        </Flex>
                        {recs.map((rec) => (
                          <Button
                            key={rec.rackId.toString()}
                            size="xs"
                            variant="outline"
                            data-testid={`accept-rec-${item.productId}-${rec.rackId}`}
                            onClick={() => applyRecommendation(st.key, rec.rackId)}
                          >
                            {rec.rackCode}
                            <Text as="span" color="fg.subtle" ml="1">
                              {t("restock.accept.hereCount", { count: rec.onHand.toString() })}
                            </Text>
                          </Button>
                        ))}
                      </Flex>
                    )}

                    {st.rows.map((row) => (
                      <Flex key={row.key} align="center" gap="2" wrap="wrap">
                        <Box flex="1" minW="48">
                          <RackSelect
                            warehouseId={teamId ?? 0n}
                            value={row.place}
                            onChange={(v) => patchPlacement(st.key, row.key, { place: v })}
                          />
                        </Box>
                        <Input
                          type="number"
                          min="0"
                          maxW="24"
                          value={row.quantity}
                          data-testid={`accept-placement-qty-${item.productId}-${row.key}`}
                          onChange={(e) => patchPlacement(st.key, row.key, { quantity: e.target.value })}
                        />
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          aria-label={t("restock.accept.removePlacement")}
                          disabled={st.rows.length === 1}
                          onClick={() => removePlacement(st.key, row.key)}
                        >
                          <Icon as={Trash2} boxSize="4" />
                        </IconButton>
                      </Flex>
                    ))}

                    <Button
                      size="xs"
                      variant="outline"
                      alignSelf="flex-start"
                      data-testid={`accept-add-placement-${item.productId}`}
                      onClick={() => addPlacement(st.key)}
                    >
                      <Icon as={Plus} boxSize="4" />
                      {t("restock.accept.addPlacement")}
                    </Button>
                  </Stack>
                </Box>

                {/* Problems — broken or lost, never enter stock (#154). Collapsed until there is one to
                    report: most deliveries have none. */}
                {problemRows.length === 0 ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    alignSelf="flex-start"
                    data-testid={`accept-add-problem-${item.productId}`}
                    onClick={() => addProblem(st.key)}
                  >
                    <Icon as={Plus} boxSize="4" />
                    {t("restock.accept.reportProblem")}
                  </Button>
                ) : (
                  <Box borderWidth="1px" borderColor="orange.emphasized" borderRadius="md" bg="orange.subtle" p="card">
                    <Stack gap="2">
                      <Flex align="center" gap="2">
                        <Icon as={TriangleAlert} boxSize="4" color="orange.fg" />
                        <Text fontSize="sm" fontWeight="semibold" color="orange.fg">
                          {t("restock.accept.problems")}
                        </Text>
                      </Flex>

                      {problemRows.map((row) => (
                        <Flex key={row.key} align="center" gap="2" wrap="wrap">
                          <NativeSelect.Root maxW="28" size="sm">
                            <NativeSelect.Field
                              value={row.type}
                              data-testid={`accept-problem-type-${item.productId}-${row.key}`}
                              onChange={(e) =>
                                patchProblem(st.key, row.key, {
                                  type: e.target.value as "broken" | "lost",
                                })
                              }
                            >
                              <option value="broken">{t("restock.accept.problemBroken")}</option>
                              <option value="lost">{t("restock.accept.problemLost")}</option>
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                          <Input
                            type="number"
                            min="1"
                            maxW="20"
                            value={row.quantity}
                            data-testid={`accept-problem-qty-${item.productId}-${row.key}`}
                            onChange={(e) => patchProblem(st.key, row.key, { quantity: e.target.value })}
                          />
                          <Input
                            flex="1"
                            minW="40"
                            placeholder={t("restock.accept.problemNote")}
                            value={row.note}
                            data-testid={`accept-problem-note-${item.productId}-${row.key}`}
                            onChange={(e) => patchProblem(st.key, row.key, { note: e.target.value })}
                          />
                          <IconButton
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            aria-label={t("restock.accept.removeProblem")}
                            onClick={() => removeProblem(st.key, row.key)}
                          >
                            <Icon as={Trash2} boxSize="4" />
                          </IconButton>
                        </Flex>
                      ))}

                      <Button
                        size="xs"
                        variant="outline"
                        alignSelf="flex-start"
                        data-testid={`accept-add-more-problem-${item.productId}`}
                        onClick={() => addProblem(st.key)}
                      >
                        <Icon as={Plus} boxSize="4" />
                        {t("restock.accept.addProblem")}
                      </Button>
                    </Stack>
                  </Box>
                )}
              </Stack>
            </Card.Body>
          </Card.Root>
        );
      })}
    </Stack>
  );
}

function SummaryField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Stack gap="0.5">
      <Text fontSize="xs" color="fg.subtle">
        {label}
      </Text>
      <Text data-testid={testId}>{value}</Text>
    </Stack>
  );
}
