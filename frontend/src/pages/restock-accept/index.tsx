import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Icon,
  IconButton,
  Input,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Stat,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, History, LayoutGrid, Plus, Trash2, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockDamageType } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { DamageTypeSelect } from "../../components/pickers/DamageTypeSelect";
import { ProductListItem } from "../../components/entity/ProductListItem";
import { RackSelect, UNPLACED } from "../../components/pickers/RackSelect";
import { ShippingBadge } from "../../components/badges/ShippingBadge";
import { toaster } from "../../components/feedback/Toaster";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { TeamItem } from "../../components/entity/TeamItem";
import { UserItem } from "../../components/entity/UserItem";
import {
  useRestockRequest,
  useRestockActors,
  useFulfillRestockRequest,
} from "../../features/restock/queries";
import { useTeamDetail } from "../../features/teams/queries";
import { useSuppliersByIds } from "../../features/suppliers/queries";
import { useProductsByIds } from "../../features/products/queries";
import { useProductPlaces } from "../../features/inventory/queries";
import { goodsTotal } from "../../features/restock/summary";
import { deltaLabel, toReceived, toRupiah, unitGoods, unitHpp } from "../../features/restock/counting";

// One shelf a line's goods went to, and how many. `place` is RackSelect's value: "" (no shelf yet —
// this is what blocks Accept), UNPLACED (the holding pile), or a rack id string.
interface PlacementDraft {
  key: string;
  place: string;
  quantity: string;
}

// One problem row: what failed to become stock, how many, and why (#154). `type` is the ENUM, not a
// "broken" | "lost" string — the picker emits it, so nothing here re-maps strings on the way out.
interface ProblemDraft {
  key: string;
  type: RestockDamageType;
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

  // The COVER IMAGE, batched. A RestockRequestItem carries the sku, the name and the quantity — it is
  // a snapshot of what was asked for, not a copy of the catalogue — so ProductListItem was falling
  // back to its package icon on every line. Someone matching a box against a screen recognises the
  // picture before they read the SKU, so the accept screen is exactly where it should not be missing.
  //
  // ONE call for the whole delivery, per ProductListItem's contract: it is presentational and fetches
  // nothing, so the caller resolves ids → products in a batch rather than N+1-ing per row.
  //
  // A warehouse reading a SELLING team's products is deliberate, not a leak — ProductByIds grants the
  // warehouse roles for this exact case ("a person at a shelf must be able to read the label on a box
  // sitting on it"), and `teamId` is the caller's own team, as on every other scoped call.
  const productsQuery = useProductsByIds({
    teamId,
    productIds: (request?.items ?? []).map((i) => i.productId),
  });
  const products = productsQuery.data;

  // WHO raised it — the team and the person. Two separate reads on top of the request, not folded
  // into it: each degrades to a reference rather than blanking the card, and neither delays the
  // counting UI, which is the only thing on this page anyone is waiting for.
  const requestingTeamId = request?.requestingTeamId ?? 0n;
  // TeamItem falls back to "Team #<id>" on its own while the name is in flight, so there is nothing
  // to pre-resolve here.
  const requester = useTeamDetail({ teamId: requestingTeamId, enabled: requestingTeamId > 0n });

  const actorsQuery = useRestockActors(request ? [request.createdByUserId] : []);
  const creator = actorsQuery.data?.get((request?.createdByUserId ?? 0n).toString());

  // The VENDOR by name. This needs SupplierByIds specifically: SupplierDetail filters by the caller's
  // team, so a warehouse asking about the buying team's supplier gets NotFound — which is how this
  // field came to read "Supplier #2". A restock names exactly one supplier, so the array is a set of
  // one; the hook batches because the shape is by-ids, not because this screen needs it to.
  const supplierId = request?.supplierId ?? 0n;
  const suppliersQuery = useSuppliersByIds({ teamId, supplierIds: [supplierId] });
  const supplier = suppliersQuery.data?.get(supplierId.toString());

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

  // What the ORDER was worth, from the lines as raised. This is the asked-for value, not the
  // received one: it is the figure on the invoice the courier is holding, which is the whole point
  // of showing it while the box is being opened.
  const productsTotal = goodsTotal(items);

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
      [itemKey]: [
        ...(prev[itemKey] ?? []),
        { key: nextKey(), type: RestockDamageType.BROKEN, quantity: "1", note: "" },
      ],
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
                type: p.type,
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
    // NOT capped at the page level (owner): the width limit belongs to the delivery summary above,
    // not to the counting below. The line cards want every pixel — three columns of put-away is the
    // work, and squeezing it to keep a read-only header narrow would be the wrong trade.
    <Stack gap="section" data-testid="restock-accept-page">
      {back}

      {/* The action header rides at the top of the scroll (#201): on a long delivery the Accept button
          and the reason it is disabled must stay in reach. */}
      <Box position="sticky" top="0" zIndex="1" bg="bg" borderBottomWidth="1px" borderColor="border" py="card">
        <Flex align="center" gap="card" wrap="wrap">
          {/* The id lives in the first summary card now (owner), not in the heading. It was being
              said twice, and of the two places the card is the right one: the heading is what you
              are DOING, the card is the record you are doing it to. */}
          {/* No team badge beside the title (owner). The accepting warehouse is already named twice
              over — the team switcher in the sidebar and the breadcrumb — and a third copy in the
              heading said nothing the person reading it did not already know. */}
          <Heading size="md">{t("restock.accept.title")}</Heading>
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

      {/* The delivery summary is THREE CARDS, side by side (owner): WHO sent it · WHAT was ordered and
          how it travelled · WHAT IT COST. One stacked card made those read as one undifferentiated
          list of nine labels; as three they answer three questions, and the money one gets to be a
          Stat rather than another row of small grey text.

          The 7xl cap is HERE and nowhere else (owner): these are read-only blocks of short values,
          and at full width on a wide monitor they string labels across a metre of screen with nothing
          between them. The counting below keeps the full width — see the page root. */}
      <SimpleGrid columns={{ base: 1, lg: 3 }} gap="card" maxW="7xl" alignItems="stretch">
        {/* 1 — WHO. The team that raised the request and the person who did it. A warehouse counting
            a delivery is settling somebody else's order, and "who do I ask about this?" is the first
            question a short count produces. */}
        <Card.Root>
          <Card.Body>
            <Stack gap="card">
              {/* WHICH restock this is — the record's identity, moved off the heading (owner). It
                  leads the card because it is the thing you quote back to whoever raised it. */}
              <Stack gap="0.5">
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  {t("restock.accept.summary.restock")}
                </Text>
                <Text fontSize="lg" fontWeight="semibold" data-testid="accept-restock-id">
                  #{request.id.toString()}
                </Text>
              </Stack>

              <Separator />

              {/* Through the SHARED components (#143/#42/#41), not a hand-rolled avatar and label:
                  TeamItem colours the type badge per team type and UserItem carries the @username,
                  and a re-implementation is how two screens start showing the same team differently. */}
              <Stack gap="0.5" data-testid="accept-team">
                <Text fontSize="xs" color="fg.subtle">
                  {t("restock.accept.summary.team")}
                </Text>
                <TeamItem
                  team={{
                    teamId: requestingTeamId,
                    teamName: requester.data?.name,
                    teamType: requester.data?.type,
                  }}
                />
              </Stack>

              <Stack gap="0.5" data-testid="accept-created-by">
                <Text fontSize="xs" color="fg.subtle">
                  {t("restock.accept.summary.raisedBy")}
                </Text>
                {/* No name is an EM DASH, never a fabricated one: a restock raised before the actor
                    columns existed carries 0 here, and inventing a person is worse than saying
                    nothing. */}
                {creator ? (
                  <UserItem user={creator} />
                ) : (
                  <Text color="fg.muted">
                    {request.createdByUserId === 0n
                      ? "—"
                      : t("restock.table.userRef", { id: request.createdByUserId.toString() })}
                  </Text>
                )}
              </Stack>
            </Stack>
          </Card.Body>
        </Card.Root>

        {/* 2 — WHAT AND HOW IT TRAVELLED. The order it answers, when it was raised, and the shipment
            to check the box against. Only the fields the model actually holds — a driver/receiver
            name and a shipped date are on the mock but not in the schema, so they are left out
            rather than faked. */}
        <Card.Root>
          <Card.Body>
            <Stack gap="card">
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                {t("restock.accept.summary.order")}
              </Text>

              <SimpleGrid columns={2} gap="card">
                <SummaryField label={t("restock.accept.summary.orderRef")} value={request.orderRef || "—"} />
                <SummaryField
                  label={t("restock.accept.summary.supplier")}
                  testId="accept-supplier"
                  // No supplier is legitimate (a transfer, a sample) and reads as an em dash. A SET
                  // id that has not resolved yet falls back to the reference rather than a blank —
                  // the id is a true thing to say while the name is in flight, and a supplier deleted
                  // since the order still resolves, so the fallback is genuinely rare.
                  value={
                    supplierId === 0n
                      ? "—"
                      : (supplier?.name ??
                        t("restock.detail.supplierRef", { id: supplierId.toString() }))
                  }
                />
                <SummaryField
                  label={t("restock.accept.summary.ordered")}
                  value={formatDate(request.createdAtUnix) || "—"}
                />
                <SummaryField
                  label={t("restock.accept.summary.receipt")}
                  value={request.receipt || "—"}
                  testId="accept-receipt"
                />
              </SimpleGrid>

              <Stack gap="0.5">
                <Text fontSize="xs" color="fg.subtle">
                  {t("restock.accept.summary.courier")}
                </Text>
                {request.shippingCode ? (
                  <Box>
                    <ShippingBadge code={request.shippingCode} />
                  </Box>
                ) : (
                  <Text>—</Text>
                )}
              </Stack>

              {request.note && (
                <Stack gap="0.5" borderTopWidth="1px" borderColor="border" pt="card">
                  <Text fontSize="xs" color="fg.subtle">
                    {t("restock.form.note")}
                  </Text>
                  <Text data-testid="accept-note">{request.note}</Text>
                </Stack>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>

        {/* 3 — WHAT IT COST, as Stats. These are the three numbers that decide whether the invoice in
            the courier's hand matches the order, so they are figures to read at arm's length rather
            than labelled rows. Shipping MOVES as the COD fee is typed below — freight is the recorded
            shipping cost plus whatever the courier actually collected at the door. */}
        <Card.Root>
          <Card.Body>
            <Stack gap="card">
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                {t("restock.accept.summary.cost")}
              </Text>

              <Stat.Root size="sm">
                <Stat.Label>{t("restock.accept.summary.productTotal")}</Stat.Label>
                <Stat.ValueText data-testid="accept-product-total">
                  {formatRupiah(productsTotal)}
                </Stat.ValueText>
              </Stat.Root>

              <Stat.Root size="sm">
                <Stat.Label>{t("restock.accept.summary.shippingTotal")}</Stat.Label>
                <Stat.ValueText data-testid="accept-shipping-total">
                  {formatRupiah(freight)}
                </Stat.ValueText>
                <Stat.HelpText>
                  {t("restock.accept.summary.shippingBreakdown", {
                    shipping: formatRupiah(request.shippingCost),
                    cod: formatRupiah(toRupiah(codFee)),
                  })}
                </Stat.HelpText>
              </Stat.Root>

              <Separator />

              <Stat.Root size="md">
                <Stat.Label>{t("restock.accept.summary.grandTotal")}</Stat.Label>
                <Stat.ValueText data-testid="accept-grand-total">
                  {formatRupiah(productsTotal + freight)}
                </Stat.ValueText>
              </Stat.Root>
            </Stack>
          </Card.Body>
        </Card.Root>
      </SimpleGrid>

      {/* The COD fee lives OUTSIDE the summary cards (owner). Everything in them is a fact already
          recorded on the request — read it, don't touch it. This is the one money figure the person
          at the door TYPES: what the courier actually collected on handover. Inside a card it read as
          another recorded row, when it is an input that moves the Shipping stat above and every HPP
          below. */}
      <Flex align="flex-end" gap="card" wrap="wrap">
        <Stack gap="0.5">
          <Text fontSize="xs" color="fg.subtle">
            {t("restock.accept.codFee")}
          </Text>
          <CurrencyInput value={codFee} data-testid="accept-cod-fee" onChange={setCodFee} />
        </Stack>
      </Flex>

      {items.map((item) => {
        const st = lineState(item);
        const goods = unitGoods(item.totalPrice, st.placed);
        const hpp = unitHpp(item.totalPrice, st.placed, freight, sellableTotal);
        const delta = deltaLabel(t, item.quantity, st.count);
        const recs = recommendations(item.productId);
        const problemRows = problems[st.key] ?? [];
        const product = products?.get(item.productId.toString());

        return (
          <Card.Root key={st.key} data-testid={`accept-line-${item.productId}`}>
            <Card.Body>
              {/* THREE COLUMNS per line (owner): WHAT IT IS · WHERE IT GOES · WHAT WENT WRONG — the
                  three questions asked at the door, side by side instead of stacked. A long delivery
                  is then scanned DOWN one column ("has everything got a shelf?") rather than read
                  card by card. Put-away gets the widest column because it is the one you type in.

                  They collapse to a single column below xl: a rack picker, a quantity and a
                  free-text note cannot share a row narrower than that without all three becoming
                  unusable, and the phone case is a person standing at a pallet. */}
              <Grid
                templateColumns={{ base: "1fr", xl: "minmax(0, 3fr) minmax(0, 4fr) minmax(0, 3fr)" }}
                gap="card"
                alignItems="stretch"
              >
                {/* 1 — WHAT IT IS. The product, what was asked for, and what a piece ends up costing.
                    Read-only: nothing in this column is typed.

                    `alignSelf="start"` while the grid stretches: the two PANELS beside it should be
                    equal height, but this column has no panel, so stretching it only opened a bare
                    gap between the SKU and the HPP that read as a rendering fault. */}
                <Stack gap="2" alignSelf="start">
                  {/* The product, through the shared component (#143). No stock badge — that means the
                      warehouse total (#138), and nothing here has loaded one.

                      The NAME and SKU come from the request line, not the catalogue: they are what was
                      ordered, and a product renamed since should not silently retitle a delivery being
                      counted against a paper invoice. Only the cover image is looked up. */}
                  <ProductListItem
                    product={{
                      id: item.productId,
                      sku: item.sku,
                      name: item.name,
                      defaultImageUrl: product?.defaultImageUrl,
                      defaultImageThumbnailUrl: product?.defaultImageThumbnailUrl,
                    }}
                  />

                  <Flex align="center" gap="2" wrap="wrap">
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
                  </Flex>

                  {/* TWO prices, not one (owner): the line's own price per piece, then the HPP with
                      freight folded in. The gap between them IS what the delivery cost to get here,
                      and it moves as the COD fee is typed — with only the HPP shown, that movement
                      looked like the supplier's price changing. */}
                  <Stack gap="1" borderTopWidth="1px" borderColor="border" pt="2">
                    <Flex align="baseline" gap="2">
                      <Text fontSize="xs" color="fg.muted">
                        {t("restock.accept.goodsPrice")}
                      </Text>
                      <Spacer />
                      <Text fontSize="sm" color="fg.muted" data-testid={`accept-goods-${item.productId}`}>
                        {/* No unit price until something is shelved — "Rp 0" would read as free
                            (#74), so an unplaced line shows a dash until it has a count to divide. */}
                        {st.placed > 0n ? t("restock.accept.perPiece", { price: formatRupiah(goods) }) : "—"}
                      </Text>
                    </Flex>

                    <Flex align="baseline" gap="2">
                      <Text fontSize="xs" color="fg.muted">
                        {t("restock.accept.hpp")}
                      </Text>
                      <Spacer />
                      <Text fontWeight="medium" data-testid={`accept-hpp-${item.productId}`}>
                        {st.placed > 0n ? t("restock.accept.perPiece", { price: formatRupiah(hpp) }) : "—"}
                      </Text>
                    </Flex>
                  </Stack>
                </Stack>

                {/* 2 — WHERE IT GOES. What you shelve here plus what column 3 flags IS the count
                    (#206). The balance pill turns from "{n} to place" to a settled total as every
                    typed quantity gets a shelf. */}
                <Box borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.muted" p="card" h="full">
                  <Stack gap="card">
                    <Flex align="center" gap="2" wrap="wrap">
                      <Icon as={LayoutGrid} boxSize="4" color="brand.fg" />
                      <Text fontSize="sm" fontWeight="semibold">
                        {t("restock.accept.putaway")}
                      </Text>
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
                      <Flex key={row.key} align="center" gap="2">
                        <Box flex="1" minW="0">
                          <RackSelect
                            warehouseId={teamId ?? 0n}
                            value={row.place}
                            onChange={(v) => patchPlacement(st.key, row.key, { place: v })}
                          />
                        </Box>
                        <Input
                          type="number"
                          min="0"
                          w="20"
                          flexShrink={0}
                          value={row.quantity}
                          data-testid={`accept-placement-qty-${item.productId}-${row.key}`}
                          onChange={(e) => patchPlacement(st.key, row.key, { quantity: e.target.value })}
                        />
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          flexShrink={0}
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

                {/* 3 — WHAT WENT WRONG. Broken or lost, never enters stock (#154). The column is
                    ALWAYS THERE, even empty: it used to be a ghost button that appeared under the
                    put-away box, which made reporting a loss feel like an unusual thing to do. A
                    reserved column says the question is asked of every line — the answer is just
                    "nothing" most of the time, so it stays visually quiet until it has a row. */}
                {problemRows.length === 0 ? (
                  <Flex
                    borderWidth="1px"
                    borderStyle="dashed"
                    borderColor="border"
                    borderRadius="md"
                    p="card"
                    h="full"
                    align="center"
                    justify="center"
                    direction="column"
                    gap="2"
                  >
                    <Text fontSize="xs" color="fg.subtle" textAlign="center">
                      {t("restock.accept.noProblems")}
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      data-testid={`accept-add-problem-${item.productId}`}
                      onClick={() => addProblem(st.key)}
                    >
                      <Icon as={Plus} boxSize="4" />
                      {t("restock.accept.reportProblem")}
                    </Button>
                  </Flex>
                ) : (
                  <Box
                    borderWidth="1px"
                    borderColor="orange.emphasized"
                    borderRadius="md"
                    bg="orange.subtle"
                    p="card"
                    h="full"
                  >
                    <Stack gap="card">
                      <Flex align="center" gap="2">
                        <Icon as={TriangleAlert} boxSize="4" color="orange.fg" />
                        <Text fontSize="sm" fontWeight="semibold" color="orange.fg">
                          {t("restock.accept.problems")}
                        </Text>
                      </Flex>

                      {/* Two rows per problem, not one: in a third of the width, the kind, the count
                          and "what happened?" cannot sit on one line and still be typeable. */}
                      {problemRows.map((row) => (
                        <Stack key={row.key} gap="2">
                          <Flex align="center" gap="2">
                            <Box
                              flex="1"
                              minW="0"
                              data-testid={`accept-problem-type-${item.productId}-${row.key}`}
                            >
                              <DamageTypeSelect
                                value={row.type}
                                onChange={(type) => patchProblem(st.key, row.key, { type })}
                              />
                            </Box>
                            <Input
                              type="number"
                              min="1"
                              w="20"
                              flexShrink={0}
                              value={row.quantity}
                              data-testid={`accept-problem-qty-${item.productId}-${row.key}`}
                              onChange={(e) => patchProblem(st.key, row.key, { quantity: e.target.value })}
                            />
                            <IconButton
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              flexShrink={0}
                              aria-label={t("restock.accept.removeProblem")}
                              onClick={() => removeProblem(st.key, row.key)}
                            >
                              <Icon as={Trash2} boxSize="4" />
                            </IconButton>
                          </Flex>
                          <Input
                            bg="bg"
                            placeholder={t("restock.accept.problemNote")}
                            value={row.note}
                            data-testid={`accept-problem-note-${item.productId}-${row.key}`}
                            onChange={(e) => patchProblem(st.key, row.key, { note: e.target.value })}
                          />
                        </Stack>
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
              </Grid>
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
