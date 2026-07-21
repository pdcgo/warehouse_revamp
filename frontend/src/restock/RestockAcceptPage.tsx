import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Plus, Trash2, TriangleAlert } from "lucide-react";

import { inventoryClient, restockClient, rpcError } from "../api/clients";
import type { ProductPlace } from "../gen/warehouse/inventory/v1/inventory_pb";
import type {
  RestockRequest,
  RestockRequestItem,
} from "../gen/warehouse/inventory/v1/restock_request_pb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CurrencyInput } from "../components/CurrencyInput";
import { RackSelect, UNPLACED } from "../components/RackSelect";
import { toaster } from "../components/Toaster";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";
import {
  deltaLabel,
  isCounted,
  needsPlace,
  noneArrived,
  toReceived,
  toRupiah,
  unitHpp,
} from "./counting";

// One row of the placement editor: where some of a line's goods went, and how many.
interface PlacementDraft {
  key: string;
  place: string;
  quantity: string;
}

// One row of the breakage editor (#154).
interface DamageDraft {
  key: string;
  quantity: string;
  reason: string;
  value: string;
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

// RestockAcceptPage is how a warehouse ACCEPTS a delivery (#157) — a PAGE, not a dialog.
//
// It replaced a dialog because the job outgrew one: a line can now be split across several shelves
// (#154), some of it can arrive broken, and the COD fee (#155) changes what everything cost. That is a
// form with sections, and a form with sections is a page.
//
// ACCEPTING IS COUNTING (#133). A request is a promise, a delivery is a fact, and the two disagree
// often enough that nothing here assumes they match. Each Arrived field is prefilled with the asked
// quantity because everything turning up is the common case — a convenience, not an assumption: the
// number is on screen, editable, and confirming means somebody looked at it.
export function RestockAcceptPage() {
  const { current } = useTeam();
  const { requestId: rawId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const requestId = parseRequestId(rawId);

  const [request, setRequest] = useState<RestockRequest | null>(null);
  const [places, setPlaces] = useState<ProductPlace[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [placements, setPlacements] = useState<Record<string, PlacementDraft[]>>({});
  const [damage, setDamage] = useState<Record<string, DamageDraft[]>>({});
  const [codFee, setCodFee] = useState("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  const load = useCallback(async () => {
    if (teamId === undefined || requestId === 0n) return;

    setLoading(true);
    setError("");

    try {
      const detail = await restockClient.restockRequestDetail({ teamId, requestId });
      const req = detail.request ?? null;

      setRequest(req);

      // Prefill the counts from the ASK, and the placements with one row per line holding all of it.
      // The place itself is deliberately left UNANSWERED: a prefilled count is a claim the request
      // already made, offered back for confirmation, whereas a prefilled shelf would invent an answer
      // only the person holding the box has. Guessing the shelf is what naming one exists to prevent.
      const nextCounts: Record<string, string> = {};
      const nextPlacements: Record<string, PlacementDraft[]> = {};

      for (const item of req?.items ?? []) {
        const key = item.id.toString();
        nextCounts[key] = item.quantity.toString();
        nextPlacements[key] = [{ key: nextKey(), place: "", quantity: item.quantity.toString() }];
      }

      setCounts(nextCounts);
      setPlacements(nextPlacements);
      setDamage({});

      // B — where these products already live, so a put-away adds to the existing pile rather than
      // starting a second one in another aisle (#156).
      const ids = (req?.items ?? []).map((i) => i.productId);

      if (ids.length > 0) {
        const found = await inventoryClient.productPlaces({ warehouseId: teamId, productIds: ids });
        setPlaces(found.places);
      }
    } catch (err) {
      setError(rpcError(err));
      setRequest(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => request?.items ?? [], [request]);

  // The money, live. G feeds D: the person typing the COD fee is entitled to watch it land on the
  // cost before committing to it.
  const freight = (request?.shippingCost ?? 0n) + toRupiah(codFee);

  const sellableTotal = items.reduce(
    (sum, item) => sum + toReceived(counts[item.id.toString()] ?? ""),
    0n,
  );

  // The one guard on Accept — the server's rules mirrored, per line:
  //   1. it must be counted at all (blank is not zero),
  //   2. anything that arrived must say where it went, and
  //   3. the placements must ADD UP to the count beside them.
  // Kept as ONE expression on purpose: a second guard beside it is how a screen's idea of "ready to
  // send" drifts from the handler's idea of "acceptable".
  function lineReady(item: RestockRequestItem): boolean {
    const key = item.id.toString();
    const raw = counts[key] ?? "";

    if (!isCounted(raw)) return false;

    const rows = placements[key] ?? [];
    const wanted = toReceived(raw);

    if (!needsPlace(raw)) {
      // Nothing usable arrived, so nothing may be placed — the server refuses a placement beside a
      // zero count, because 0 units cannot be anywhere.
      return rows.every((r) => toReceived(r.quantity) === 0n);
    }

    const placed = rows.reduce((sum, r) => sum + toReceived(r.quantity), 0n);
    const allNamed = rows.every((r) => r.place !== "" || toReceived(r.quantity) === 0n);

    return placed === wanted && allNamed;
  }

  const ready = items.length > 0 && items.every(lineReady);

  function patchCount(key: string, value: string) {
    setCounts((prev) => ({ ...prev, [key]: value }));
  }

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

  function addDamage(itemKey: string) {
    setDamage((prev) => ({
      ...prev,
      [itemKey]: [...(prev[itemKey] ?? []), { key: nextKey(), quantity: "1", reason: "", value: "0" }],
    }));
  }

  function patchDamage(itemKey: string, rowKey: string, patch: Partial<DamageDraft>) {
    setDamage((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).map((r) => (r.key === rowKey ? { ...r, ...patch } : r)),
    }));
  }

  function removeDamage(itemKey: string, rowKey: string) {
    setDamage((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).filter((r) => r.key !== rowKey),
    }));
  }

  async function accept() {
    if (teamId === undefined || !request) return;

    setBusy(true);
    setError("");

    try {
      // Built from `request.items` rather than from the maps, so the payload's shape comes from the
      // REQUEST and cannot silently drop a line a map missed.
      await restockClient.restockRequestFulfill({
        teamId,
        requestId: request.id,
        codShippingFee: toRupiah(codFee),
        lines: request.items.map((item) => {
          const key = item.id.toString();
          const receivedQuantity = toReceived(counts[key] ?? "");

          return {
            itemId: item.id,
            receivedQuantity,
            // A zero-quantity row is a half-finished edit, not a placement — dropped rather than sent,
            // since the server refuses one and the person has already moved on.
            placements: (placements[key] ?? [])
              .filter((r) => toReceived(r.quantity) > 0n)
              .map((r) => ({
                place:
                  r.place === UNPLACED
                    ? ({ case: "unplaced", value: true } as const)
                    : ({ case: "rackId", value: BigInt(r.place) } as const),
                quantity: toReceived(r.quantity),
              })),
            damaged: (damage[key] ?? [])
              .filter((d) => toReceived(d.quantity) > 0n && d.reason.trim() !== "")
              .map((d) => ({
                quantity: toReceived(d.quantity),
                reason: d.reason.trim(),
                value: toRupiah(d.value),
              })),
          };
        }),
      });

      toaster.create({ type: "success", title: t("restock.accept.toast.accepted") });
      navigate(`/inventories/restock/${request.id}`);
    } catch (err) {
      setError(rpcError(err));
      toaster.create({ type: "error", title: t("restock.accept.toast.failed"), description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  // B — the shelves a product already sits on, as "A-01-3 (40)".
  function recommended(productId: bigint): string {
    return places
      .filter((p) => p.productId === productId)
      .map((p) => `${p.rackId === 0n ? t("racks.select.unplaced") : p.rackCode} (${p.onHand})`)
      .join(", ");
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

      <Flex align="center" gap="card">
        <Heading size="md">{t("restock.accept.heading", { id: request.id.toString() })}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />

        {/* H — accepting moves stock and cannot be undone, so it confirms first. */}
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

      {error && (
        <Text color="red.fg" data-testid="accept-error">
          {error}
        </Text>
      )}

      {/* I + J + G — what this delivery is, and the fee the courier took at the door. */}
      <Card.Root>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap="card">
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.detail.receipt")}
              </Text>
              <Text data-testid="accept-receipt">{request.receipt || "—"}</Text>
            </Stack>
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.form.shippingCost")}
              </Text>
              <Text>{formatRupiah(request.shippingCost)}</Text>
            </Stack>
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.accept.codFee")}
              </Text>
              <CurrencyInput
                value={codFee}
                data-testid="accept-cod-fee"
                onChange={setCodFee}
              />
            </Stack>
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.accept.freightTotal")}
              </Text>
              <Text fontWeight="medium" data-testid="accept-freight-total">
                {formatRupiah(freight)}
              </Text>
            </Stack>
          </SimpleGrid>

          {request.note && (
            <Stack gap="0" mt="card">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.form.note")}
              </Text>
              <Text data-testid="accept-note">{request.note}</Text>
            </Stack>
          )}
        </Card.Body>
      </Card.Root>

      {items.map((item) => {
        const key = item.id.toString();
        const raw = counts[key] ?? "";
        const rows = placements[key] ?? [];
        const damageRows = damage[key] ?? [];
        const placed = rows.reduce((sum, r) => sum + toReceived(r.quantity), 0n);
        const hpp = unitHpp(item.totalPrice, toReceived(raw), freight, sellableTotal);
        const delta = deltaLabel(t, item.quantity, toReceived(raw));
        const hint = recommended(item.productId);

        return (
          <Card.Root key={key} data-testid={`accept-line-${item.productId}`}>
            <Card.Body>
              <Stack gap="card">
                {/* A — the product. */}
                <Flex align="center" gap="card" wrap="wrap">
                  <Stack gap="0">
                    <Text fontWeight="medium">{item.name}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      {item.sku}
                    </Text>
                  </Stack>
                  <Spacer />

                  {/* D — what a unit of this line actually cost, freight included (#155). */}
                  <Stack gap="0" textAlign="end">
                    <Text fontSize="xs" color="fg.muted">
                      {t("restock.accept.hpp")}
                    </Text>
                    <Text fontWeight="medium" data-testid={`accept-hpp-${item.productId}`}>
                      {t("restock.accept.perPiece", { price: formatRupiah(hpp) })}
                    </Text>
                  </Stack>
                </Flex>

                {/* B — where it already lives, so today's delivery joins yesterday's pile. */}
                {hint && (
                  <Text fontSize="sm" color="fg.muted" data-testid={`accept-recommend-${item.productId}`}>
                    {t("restock.accept.alreadyOn", { places: hint })}
                  </Text>
                )}

                <Separator />

                {/* C — the count. */}
                <Flex align="flex-end" gap="card" wrap="wrap">
                  <Stack gap="0">
                    <Text fontSize="xs" color="fg.muted">
                      {t("restock.receive.asked")}
                    </Text>
                    <Text>{item.quantity.toString()}</Text>
                  </Stack>

                  <Stack gap="0" maxW="32">
                    <Text fontSize="xs" color="fg.muted">
                      {t("restock.receive.arrived")}
                    </Text>
                    <Input
                      type="number"
                      min="0"
                      value={raw}
                      data-testid={`accept-count-${item.productId}`}
                      onChange={(e) => patchCount(key, e.target.value)}
                    />
                  </Stack>

                  {delta && (
                    <Badge colorPalette="orange" data-testid={`accept-delta-${item.productId}`}>
                      {delta}
                    </Badge>
                  )}

                  {/* The running total against the count — visible WHILE typing rather than refused at
                      the end, because being told what is wrong after pressing a disabled button is how
                      a form wastes somebody's time. */}
                  {needsPlace(raw) && placed !== toReceived(raw) && (
                    <Flex align="center" gap="1" color="orange.fg" data-testid={`accept-unbalanced-${item.productId}`}>
                      <Icon as={TriangleAlert} boxSize="4" />
                      <Text fontSize="sm">
                        {t("restock.accept.unbalanced", {
                          placed: placed.toString(),
                          counted: toReceived(raw).toString(),
                        })}
                      </Text>
                    </Flex>
                  )}
                </Flex>

                {/* E — placements. A delivery of 100 does not go on one shelf (#154). */}
                {!noneArrived(raw) && (
                  <Stack gap="2">
                    <Text fontSize="sm" fontWeight="medium">
                      {t("restock.accept.placements")}
                    </Text>

                    {rows.map((row) => (
                      <Flex key={row.key} align="center" gap="2" wrap="wrap">
                        <Stack gap="0" flex="1" minW="48">
                          <RackSelect
                            warehouseId={teamId ?? 0n}
                            value={row.place}
                            onChange={(v) => patchPlacement(key, row.key, { place: v })}
                          />
                        </Stack>
                        <Input
                          type="number"
                          min="0"
                          maxW="24"
                          value={row.quantity}
                          data-testid={`accept-placement-qty-${item.productId}-${row.key}`}
                          onChange={(e) => patchPlacement(key, row.key, { quantity: e.target.value })}
                        />
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          aria-label={t("restock.accept.removePlacement")}
                          disabled={rows.length === 1}
                          onClick={() => removePlacement(key, row.key)}
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
                      onClick={() => addPlacement(key)}
                    >
                      <Icon as={Plus} boxSize="4" />
                      {t("restock.accept.addPlacement")}
                    </Button>
                  </Stack>
                )}

                {/* F — what arrived broken. Never enters stock (#154). */}
                <Stack gap="2">
                  <Text fontSize="sm" fontWeight="medium">
                    {t("restock.accept.damage")}
                  </Text>

                  {damageRows.map((row) => (
                    <Flex key={row.key} align="center" gap="2" wrap="wrap">
                      <Input
                        type="number"
                        min="1"
                        maxW="20"
                        value={row.quantity}
                        data-testid={`accept-damage-qty-${item.productId}-${row.key}`}
                        onChange={(e) => patchDamage(key, row.key, { quantity: e.target.value })}
                      />
                      <Input
                        flex="1"
                        minW="40"
                        placeholder={t("restock.accept.damageReason")}
                        value={row.reason}
                        data-testid={`accept-damage-reason-${item.productId}-${row.key}`}
                        onChange={(e) => patchDamage(key, row.key, { reason: e.target.value })}
                      />
                      <CurrencyInput
                        maxW="28"
                        placeholder={t("restock.accept.damageValue")}
                        value={row.value}
                        onChange={(v) => patchDamage(key, row.key, { value: v })}
                      />
                      <IconButton
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        aria-label={t("restock.accept.removeDamage")}
                        onClick={() => removeDamage(key, row.key)}
                      >
                        <Icon as={Trash2} boxSize="4" />
                      </IconButton>
                    </Flex>
                  ))}

                  <Button
                    size="xs"
                    variant="outline"
                    alignSelf="flex-start"
                    data-testid={`accept-add-damage-${item.productId}`}
                    onClick={() => addDamage(key)}
                  >
                    <Icon as={Plus} boxSize="4" />
                    {t("restock.accept.addDamage")}
                  </Button>
                </Stack>
              </Stack>
            </Card.Body>
          </Card.Root>
        );
      })}
    </Stack>
  );
}
