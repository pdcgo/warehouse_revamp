import { useEffect, useMemo, useRef, useState } from "react";
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

import { rpcError } from "../api/clients";
import type {
  RestockRequestItem,
} from "../gen/warehouse/inventory/v1/restock_request_pb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CurrencyInput } from "../components/CurrencyInput";
import { ProductListItem } from "../components/ProductListItem";
import { RackSelect, UNPLACED } from "../components/RackSelect";
import { toaster } from "../components/Toaster";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";
import { useRestockRequest, useFulfillRestockRequest } from "./queries";
import { useProductPlaces } from "../inventory/queries";
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

  // Only the DRAFTS are state — what the person counting is typing. The request and the existing
  // shelf placements come from queries.
  //
  // `submitError` is separate from the query's error on purpose: one is "we could not load this
  // request", the other is "the server refused your count". They read differently and one must not
  // clear the other.
  const [submitError, setSubmitError] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [placements, setPlacements] = useState<Record<string, PlacementDraft[]>>({});
  const [damage, setDamage] = useState<Record<string, DamageDraft[]>>({});
  const [codFee, setCodFee] = useState("0");

  // Accepting RECEIVES GOODS, so this mutation invalidates stock and racks as well as restock —
  // see the warning in queries.ts. `busy` is the mutation's own in-flight flag (#177).
  const fulfill = useFulfillRestockRequest();
  const busy = fulfill.isPending;

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  const query = useRestockRequest({ teamId, requestId });

  const request = query.data ?? null;
  const loading = query.isPending && teamId !== undefined && requestId !== 0n;
  const error = query.isError ? rpcError(query.error) : submitError;

  // B — where these products already live, so a put-away adds to the existing pile rather than
  // starting a second one in another aisle (#156). Its own query: it depends on the request having
  // arrived, and it must not hold up the form if it fails — a shelf suggestion is help, not a gate.
  const placesQuery = useProductPlaces({
    warehouseId: teamId,
    productIds: (request?.items ?? []).map((i) => i.productId),
  });
  const places = placesQuery.data ?? [];

  // SEEDING THE FORM, once per request. The drafts are what the person edits, so they cannot be
  // derived on every render — that would overwrite typing. Keyed on the request id rather than the
  // object: the query refetches and hands back a NEW object with the same contents, and reseeding on
  // that would wipe a half-filled count sheet the moment anything invalidated.
  //
  // The counts prefill from the ASK and the PLACE is deliberately left unanswered: a prefilled count
  // is a claim the request already made, offered back for confirmation, whereas a prefilled shelf
  // would invent an answer only the person holding the box has.
  const seededFor = useRef<string>("");

  useEffect(() => {
    if (!request) return;

    const id = request.id.toString();
    if (seededFor.current === id) return;
    seededFor.current = id;

    const nextCounts: Record<string, string> = {};
    const nextPlacements: Record<string, PlacementDraft[]> = {};

    for (const item of request.items) {
      const key = item.id.toString();
      nextCounts[key] = item.quantity.toString();
      nextPlacements[key] = [{ key: nextKey(), place: "", quantity: item.quantity.toString() }];
    }

    setCounts(nextCounts);
    setPlacements(nextPlacements);
    setDamage({});
  }, [request]);


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

  // WHY Accept is disabled, in the two words the person actually needs (#157 relayout).
  //
  // The per-line warnings were already there, but on a delivery of ten products they are ten screens
  // apart: a disabled button with no explanation makes somebody scroll the whole page hunting for the
  // line they have not finished. Counted and placed are separated because they are different jobs —
  // "I have not opened that box yet" and "I opened it but have not said which shelf" send you to
  // different places.
  const counted = items.filter((item) => isCounted(counts[item.id.toString()] ?? "")).length;
  const unplaced = items.filter(
    (item) => isCounted(counts[item.id.toString()] ?? "") && !lineReady(item),
  ).length;

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

    setSubmitError("");

    try {
      // Built from `request.items` rather than from the maps, so the payload's shape comes from the
      // REQUEST and cannot silently drop a line a map missed.
      await fulfill.mutateAsync({
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

      // The invalidation is part of the mutation now (#177) and has already run by the time we get
      // here — including the STOCK and RACK caches, which accepting a delivery makes stale and which
      // the old `invalidateRestock()` here did not clear.
      toaster.create({ type: "success", title: t("restock.accept.toast.accepted") });
      navigate(`/inventories/restock/${request.id}`);
    } catch (err) {
      setSubmitError(rpcError(err));
      toaster.create({ type: "error", title: t("restock.accept.toast.failed"), description: rpcError(err) });
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

      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("restock.accept.heading", { id: request.id.toString() })}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />

        {/* What is left to do, beside the button it is stopping. Silent once everything is ready —
            a bar that congratulates you on finishing is noise at the moment you want to press Accept. */}
        {!ready && (
          <Text fontSize="sm" color="fg.muted" data-testid="accept-progress">
            {t("restock.accept.progress", { counted, total: items.length })}
            {unplaced > 0 && ` · ${t("restock.accept.progressUnplaced", { count: unplaced })}`}
          </Text>
        )}

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
                {/* A — the product, through the SHARED component (#143/#157). It was hand-rolled here
                    as a name over a SKU, which is the same picture drawn a second way: this screen
                    then had its own idea of how a product looks, and the cover image every other
                    screen shows was simply missing. No `stock` is passed — that badge means the
                    warehouse's total (#138), and nothing here has loaded one. */}
                <ProductListItem
                  product={{ id: item.productId, sku: item.sku, name: item.name }}
                  action={
                    /* D — what a unit of this line actually cost, freight included (#155). */
                    <Stack gap="0" textAlign="end">
                      <Text fontSize="xs" color="fg.muted">
                        {t("restock.accept.hpp")}
                      </Text>
                      <Text fontWeight="medium" data-testid={`accept-hpp-${item.productId}`}>
                        {t("restock.accept.perPiece", { price: formatRupiah(hpp) })}
                      </Text>
                    </Stack>
                  }
                />

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

                    {/* B — where it already lives (#157 relayout). This used to sit up beside the
                        product, which is where you read ABOUT a product; it is really advice about
                        WHERE TO PUT one, so it belongs at the decision it informs. Today's delivery
                        joining yesterday's pile is the whole point of showing it. */}
                    {hint && (
                      <Text
                        fontSize="xs"
                        color="fg.muted"
                        data-testid={`accept-recommend-${item.productId}`}
                      >
                        {t("restock.accept.alreadyOn", { places: hint })}
                      </Text>
                    )}

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

                {/* F — what arrived broken. Never enters stock (#154).

                    COLLAPSED UNTIL IT IS NEEDED (#157 relayout). Breakage is the exception: most
                    deliveries have none, and an always-open "Broken / lost" heading with an empty
                    Add button under EVERY line pushed the real work — count, then place — down the
                    page on every single one. Now it is one small action until somebody has something
                    to report, and the full section the moment they do. */}
                {damageRows.length === 0 ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    alignSelf="flex-start"
                    data-testid={`accept-add-damage-${item.productId}`}
                    onClick={() => addDamage(key)}
                  >
                    <Icon as={Plus} boxSize="4" />
                    {t("restock.accept.reportDamage")}
                  </Button>
                ) : (
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
                    data-testid={`accept-add-more-damage-${item.productId}`}
                    onClick={() => addDamage(key)}
                  >
                    <Icon as={Plus} boxSize="4" />
                    {t("restock.accept.addDamage")}
                  </Button>
                </Stack>
                )}
              </Stack>
            </Card.Body>
          </Card.Root>
        );
      })}
    </Stack>
  );
}
