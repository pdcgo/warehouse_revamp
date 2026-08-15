import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Grid,
  GridItem,
  Heading,
  Icon,
  IconButton,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, FileClock, PackagePlus } from "lucide-react";
import { rpcError, teamClient } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useCreateOrder } from "../../features/orders/queries";
import { usePushOrderDraft, useUpdateOrderDraft } from "../../features/orderDrafts/queries";
import { useStockAvailability, useStockCosts } from "../../features/inventory/queries";
import { ShopSelect } from "../../components/ShopSelect";
import { TeamSelect } from "../../components/TeamSelect";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { ProductPicker } from "../../components/ProductPicker";
import type { PickedProduct } from "../../components/ProductSelect";
import { AddressPicker, emptyAddress } from "../../components/AddressPicker";
import type { AddressValue } from "../../components/AddressPicker";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { toaster } from "../../components/Toaster";
import { OrderLineRow } from "../../features/orders/OrderLineRow";
import { CustomerShipping } from "../../features/orders/CustomerShipping";
import { OrderTotals } from "../../features/orders/OrderTotals";
import { MarketplaceTotal } from "./components/MarketplaceTotal";
import { ReceiptUpload, emptyReceipt, hasReceipt } from "./components/ReceiptUpload";
import type { ReceiptValue } from "./components/ReceiptUpload";
import type { LineDraft } from "../../features/orders/lines";
import {
  canSubmit,
  lineFor,
  lineStock,
  lineTotal,
  toQty,
  toRupiah,
  unitCost,
} from "../../features/orders/lines";

// The address is OPTIONAL (#118) — exactly as the free text it replaces was: an order can be taken
// before the address is known. An untouched picker sends NOTHING rather than a message full of empty
// strings, so "no address" stays distinguishable from "an address of blanks".
function addressTouched(a: AddressValue): boolean {
  return Object.values(a).some((v) => v.trim() !== "");
}

// Where a draft saved from THIS FORM says it came from. Every other draft in the system was pushed
// by a scraper naming itself, and the drafts list already filters on this — so a hand-written one
// must be as identifiable as the rest rather than borrowing an app's name or leaving it blank.
const DRAFT_SOURCE = "manual";

// OrderCreatePage is the selling-side "place an order" form (#90), a dedicated PAGE (like the product
// editor) because it carries a dynamic list of lines.
//
// It is not merely a form: placing an order DRAWS ITS GOODS out of the chosen warehouse in the same
// transaction that writes it, so this screen is where stock leaves the building. Two consequences run
// through the whole page — the warehouse is required and visible, and every line shows what that
// warehouse actually holds.
export function OrderCreatePage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const createOrder = useCreateOrder();
  const pushDraft = usePushOrderDraft();
  const updateDraft = useUpdateOrderDraft();

  const teamId = current?.teamId;

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [shopId, setShopId] = useState<bigint>(0n);

  // Which warehouse fulfils this order (#72). REQUIRED: from #69 the order takes its stock out of this
  // warehouse the moment it is placed, so the form cannot submit without one.
  //
  // Pre-filled from the team's configured default (#145), which is not the same as guessing. A default
  // the SYSTEM invents would move real goods out of the wrong building; a default the TEAM configured
  // is the team stating where it ships from, and it stays visible and changeable on every order. The
  // server also still refuses an order that names no warehouse, so nothing here can let one through.
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [shippingCode, setShippingCode] = useState("");

  // The shipping receipt — the courier's slip photographed, or the marketplace's PDF (owner). What
  // is held here is a REFERENCE to a document already uploaded, never the file: the bytes went
  // straight to storage the moment it was picked, so submitting the order writes three short strings.
  const [receipt, setReceipt] = useState<ReceiptValue>(emptyReceipt);

  // Whatever the person taking the order needs the next person to know (owner). Free text on purpose:
  // "deliver after 5pm", "wrap the glass one", "second attempt, the first parcel came back" are
  // instructions to a HUMAN, and no dropdown ever fits the case actually in front of them.
  const [note, setNote] = useState("");

  // What the storefront actually took — a NOTE (owner), stored and never summed into anything.
  const [marketplaceTotal, setMarketplaceTotal] = useState("0");

  // Starts EMPTY, not with a blank line. Lines arrive by picking products, so a placeholder row with
  // no product would be a row you cannot remove and cannot use — the same conclusion the restock form
  // reached (#165). The Create button is what refuses an order with nothing on it.
  const [lines, setLines] = useState<LineDraft[]>([]);

  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState("");

  // The external reference this form's draft is filed under, minted ONCE per visit.
  //
  // OrderDraftPush is create-or-update on (team_id, source, external_id), so a stable id is what
  // makes a second Save update the draft this page already made instead of leaving a trail of
  // near-identical ones. A fresh id per visit is the other half: opening the form again is a
  // different order, not an edit of the last one.
  const draftRefRef = useRef(`form-${crypto.randomUUID()}`);
  // The draft this page has already created, if Save has been pressed. Kept so the line MAPPING can
  // be written to it — see saveDraft.
  const draftIdRef = useRef(0n);

  // A REF, not state, and this is load-bearing rather than a style choice. The save navigates in the
  // same tick it records success, and a `setState` has not landed by then — so a state flag would still
  // read false when the blocker below runs, and every successful order would be met with "discard
  // this?". A ref is written and read synchronously, which is what the navigation needs.
  const savedRef = useRef(false);

  // Pre-fill the warehouse from the team's configured default (#145).
  //
  // Only ever fills an UNTOUCHED field: if the answer arrives after somebody has already picked one,
  // it must not overwrite them. Reading `warehouseId` inside the updater rather than depending on it
  // keeps this a one-shot fill instead of a rule that fights the person typing.
  useEffect(() => {
    if (teamId === undefined) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await teamClient.teamDetail({ teamId });
        const preferred = res.team?.info?.defaultWarehouseId ?? 0n;

        if (!cancelled && preferred !== 0n) {
          setWarehouseId((chosen) => (chosen === 0n ? preferred : chosen));
        }
      } catch {
        // No default is an ordinary state, not an error worth showing: the field is required and
        // already visible, so the person simply picks one as they did before.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // What the chosen warehouse holds, for every product on the form. ONE batched read for all lines
  // rather than one per line, and it re-reads when the warehouse changes — which is the point: the
  // same order is placeable from one building and not from another, so the figures must follow the
  // warehouse rather than describing whichever one was picked first.
  const productIds = useMemo(() => lines.map((l) => l.productId), [lines]);

  const stockQuery = useStockAvailability({ teamId, warehouseId, productIds });
  const stock = stockQuery.data;

  // The HPP each line is valued at (owner: "we use hpp price"). Its own read, so a cost failure never
  // blanks the stock figures and vice versa.
  const costsQuery = useStockCosts({ teamId, warehouseId, productIds });
  const costs = costsQuery.data;

  // The picker hands back the WHOLE ticked set, so this RECONCILES — it does not append (#165).
  //
  // A product that is still ticked keeps the line it already had, with the quantity and price typed
  // into it. Rebuilding the list from the picked set would be shorter to write and would silently
  // reset every number on screen the next time somebody opened the picker to add one more product.
  function pickProducts(products: PickedProduct[]) {
    setLines((prev) => {
      const ticked = new Set(products.map((p) => p.id.toString()));
      const kept = prev.filter((l) => ticked.has(l.productId.toString()));

      const known = new Set(kept.map((l) => l.productId.toString()));
      const added = products.filter((p) => !known.has(p.id.toString())).map(lineFor);

      return [...kept, ...added];
    });
  }

  function patchLine(productId: bigint, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  // Dropping ONE product without opening the dialog. Unticking it in the picker does the same thing —
  // they are the same edit, because the picker's ticks are derived from these lines rather than held
  // separately.
  function removeLine(productId: bigint) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  // What the picker shows as ticked. Derived from the lines, never stored beside them — two copies of
  // "which products are on this order" is how a tick and a row start disagreeing.
  const pickedIds = useMemo(() => lines.map((l) => l.productId), [lines]);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + lineTotal(l, costs), 0n),
    [lines, costs],
  );
  // The shipping cost is no longer typed on this form (owner), so the total IS the subtotal. The
  // order still carries a `shipping_cost` — it is simply 0 on everything placed from here, and the
  // sum is written out rather than collapsed so the missing term is visible when it comes back.
  const total = subtotal;

  const canSave = canSubmit({ customerName, shopId, warehouseId, lines, stock });

  // How many lines the chosen warehouse cannot fill. Summarised at the top as well as marked on each
  // line: on a long order the failing line can be off screen, and "Create is disabled and I cannot see
  // why" is the state this page must never be in.
  const shortLines = lines.filter((l) => {
    const s = lineStock(l, stock);
    return s.kind === "known" && s.short;
  }).length;

  // Anything typed at all. Used only to decide whether leaving needs a confirmation — the warehouse is
  // excluded on purpose, because it arrives PRE-FILLED and a page nobody has touched must not claim to
  // have unsaved work.
  const dirty =
    customerName.trim() !== "" ||
    customerPhone.trim() !== "" ||
    shopId > 0n ||
    shippingCode !== "" ||
    note.trim() !== "" ||
    hasReceipt(receipt) ||
    addressTouched(address) ||
    toRupiah(marketplaceTotal) > 0n ||
    lines.length > 0;

  // A half-typed order is real work — several lines, an address, a customer on the phone — and a
  // mis-aimed click on Back or a sidebar link threw all of it away silently. `useBlocker` stops the
  // navigation, and the answer decides whether it proceeds; blocking only while `dirty` means the
  // ordinary "opened it, changed my mind" path is untouched, and `savedRef` is what stops it firing on
  // the one navigation that is the whole point of the form.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !savedRef.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await createOrder.mutateAsync({
        teamId,
        shopId,
        warehouseId,
        customerName,
        customerPhone,
        address: addressTouched(address) ? address : undefined,
        shippingCode,
        // Trimmed, so a note of nothing but whitespace is stored as no note at all — otherwise the
        // detail page would render an empty note card for a field somebody tabbed through.
        note: note.trim(),
        // Sent only when one was actually attached: an empty reference and no reference say the same
        // thing, and the shorter one cannot be mistaken for a document whose id got lost.
        receipt: hasReceipt(receipt) ? receipt : undefined,
        subtotal,
        // 0 from this form — the field was removed from it (owner). Sent explicitly rather than
        // omitted, so the request still states every term of the money it is placing.
        shippingCost: 0n,
        total,
        marketplaceTotal: toRupiah(marketplaceTotal),
        items: lines.map((l) => ({
          id: 0n,
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          quantity: toQty(l.quantity),
          // The HPP the form displayed. The server still stamps its own `unit_cost` from the
          // warehouse (#74) — this is what the ORDER is valued at, and the two are read from the
          // same place so they agree.
          unitPrice: unitCost(l, costs),
        })),
      });

      // The invalidation rode with the write (#177) — this page navigates away, so the list it
      // leaves behind has no other way to learn about the order just created.
      toaster.create({ type: "success", title: t("orders.orderCreated") });

      // Set BEFORE navigating, or the guard above asks whether to discard the order that was just
      // successfully placed — which is exactly what happened the first time this shipped.
      savedRef.current = true;

      const id = res.order?.id;
      void navigate(id ? `/orders/${id}` : "/orders");
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  // SAVE IT AS A DRAFT instead of placing it (owner) — the half-finished order goes to the drafts
  // screen, nothing is validated beyond what a draft requires, and NO STOCK MOVES.
  //
  // That last part is the whole reason this button exists beside Create: placing an order draws its
  // goods out of the warehouse in the same transaction (#69/#149). An order that is not ready — no
  // warehouse chosen yet, waiting on the buyer to confirm an address — must have somewhere to live
  // that does not touch the shelves.
  //
  // TWO CALLS, and the second is not an implementation detail:
  //
  //   1. PUSH writes the draft, but IGNORES `product_id` on every line. That rule protects the
  //      scraper path — an app may not guess our catalogue ids — and it applies to us as well.
  //   2. UPDATE carries the mapping, which is what OrderDraftUpdate is FOR: a person saying "this
  //      line is that product". Picking from the catalogue on this form is exactly that act.
  //
  // If the mapping call fails, the draft still exists with its lines unmapped — half-saved is the
  // normal state of a draft, so it is reported rather than rolled back.
  async function saveDraft() {
    if (teamId === undefined || !dirty) {
      return;
    }

    setSavingDraft(true);
    setError("");

    try {
      const pushed = await pushDraft.mutateAsync({
        teamId,
        source: DRAFT_SOURCE,
        externalId: draftRefRef.current,
        shopId,
        warehouseId,
        customerName,
        customerPhone,
        address: addressTouched(address) ? address : undefined,
        shippingCode,
        items: lines.map((l) => ({
          id: 0n,
          // The catalogue's own SKU and name stand in for what a scrape would have read off the
          // marketplace. They are the evidence of what was ordered, and on a form-made draft the
          // evidence is what the person picked.
          externalSku: l.sku,
          externalName: l.name,
          productId: 0n,
          quantity: toQty(l.quantity),
          unitPrice: unitCost(l, costs),
        })),
      });

      const draft = pushed.draft;

      if (!draft) {
        throw new Error("The draft was saved but not returned");
      }

      draftIdRef.current = draft.id;

      // The mapping, line by line, matched back by POSITION — push returns the lines in the order
      // they were sent, and neither side has anything better to key on: a form line has no draft id
      // until this moment, and two lines of the same product would be indistinguishable by SKU.
      if (draft.items.length > 0) {
        await updateDraft.mutateAsync({
          teamId,
          draftId: draft.id,
          items: {
            lines: draft.items.map((item, i) => ({
              id: item.id,
              productId: lines[i]?.productId ?? 0n,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          },
        });
      }

      toaster.create({ type: "success", title: t("orders.draftSaved") });

      savedRef.current = true;
      void navigate(`/order-drafts/${draft.id}`);
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSavingDraft(false);
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orders.title")}</Heading>
        <Text color="fg.muted" data-testid="order-create-no-team">
          {t("orders.selectTeamCreate")}
        </Text>
      </Stack>
    );
  }

  return (
    // No `maxW`: the page fills the content area, the way the list pages do. It carried a cap from
    // when it was ONE narrow column of stacked cards, where full width would have stretched a text
    // field across a 27-inch monitor. A two-column grid has the opposite problem — the wider the
    // window, the more room the lines get, which is the column that actually wants it.
    <Stack gap="section" data-testid="order-create-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="order-create-back"
          onClick={() => navigate("/orders")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{t("orders.newOrderTitle")}</Heading>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="order-create-error">
          {error}
        </Text>
      )}

      {/* Full width, above both columns: a line the warehouse cannot fill is a fact about the whole
          order, not about the column the line happens to sit in. */}
      {shortLines > 0 && (
        <Alert.Root status="error" data-testid="order-create-short">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("orders.shortTitle", { count: shortLines })}</Alert.Title>
            <Alert.Description>{t("orders.shortHelp")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      <form onSubmit={save} noValidate>
        {/*
          TWO COLUMNS on a wide screen, one on a narrow one.

          The LEFT column is the order being written, in the order the work actually happens (owner):

            1. WHICH SHOP, WHICH WAREHOUSE — two selects abreast. They frame everything below them,
               and the warehouse decides what the stock figures on the lines even mean.
            2. WHAT IS BEING SOLD — the lines. The subject of the order, and the part that grows.
            3. WHERE IT GOES, and BESIDE IT the parcel and the person — the address on the left
               (owner), the shipping receipt and Customer & shipping stacked on the right.

          The RIGHT column is the NOTE and what it all comes to (owner) — the two things that
          belong beside the order rather than inside it.

          ⚠ DOM ORDER IS VISUAL ORDER IS TAB ORDER, because the columns are assigned by explicit
          `gridColumn`/`gridRow` rather than by `order`. So keyboard tabbing follows what the eye
          follows, and on a narrow screen the grid collapses to exactly that order with nothing to
          re-specify.
        */}
        <Grid
          templateColumns={{ base: "1fr", lg: "minmax(0, 2fr) minmax(0, 1fr)" }}
          gap="section"
          alignItems="start"
        >
          {/* ── WHICH SHOP, WHICH WAREHOUSE ───────────── left column, and it comes FIRST (owner) ──

              Two selects, side by side, above the products — and the order is the design rather than
              tidiness. Both answer "which order is this?" before anything is on it, and the WAREHOUSE
              in particular has to be settled first: it is the building every line's stock figure is
              measured against, so picking products before naming it means picking blind.

              They were fields four and five inside "Customer & shop"; nothing about a shop or a
              warehouse is customer information, and burying them under a name and a phone number put
              the one control that governs the whole form below the fold. */}
          <GridItem gridColumn={{ lg: 1 }} gridRow={{ lg: 1 }}>
            <Card.Root>
              <Card.Body>
                <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
                  <Field.Root required>
                    <Field.Label>{t("orders.shop")}</Field.Label>
                    <ShopSelect teamId={teamId ?? 0n} value={shopId} onChange={setShopId} />
                  </Field.Root>

                  {/* Which warehouse ships it (#72) — and therefore which building's shelves every
                      line below is measured against. Changing it re-reads all of them. */}
                  <Field.Root required>
                    <Field.Label>{t("orders.warehouse")}</Field.Label>
                    <Box w="full" data-testid="order-warehouse">
                      <TeamSelect
                        teamType={TeamType.WAREHOUSE}
                        value={warehouseId}
                        onChange={setWarehouseId}
                      />
                    </Box>
                    <Field.HelperText>{t("orders.warehouseHelp")}</Field.HelperText>
                  </Field.Root>
                </SimpleGrid>
              </Card.Body>
            </Card.Root>
          </GridItem>

          {/* ── WHAT IS BEING SOLD ────────────────────────── left column, right under the two above ── */}
          <GridItem gridColumn={{ lg: 1 }} gridRow={{ lg: 2 }}>
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Flex align="center" gap="card" wrap="wrap">
                    <Text fontWeight="medium">{t("orders.items")}</Text>

                    {/* Picking is a DIALOG, as it is on a restock request (#165) — several products
                        at once, searchable, with what the warehouse holds on every row. There is no
                        per-line product control: swapping one product for another is untick, tick.

                        `readyLens="available"` is the load-bearing prop. The default lens answers
                        "what do I own here", which is right when BUYING and wrong when selling — an
                        order draws whatever is on the shelf, so the owned figure would show 0 for
                        stock this order would happily take. */}
                    <ProductPicker
                      // THE WAREHOUSE IS THE CATALOGUE (owner). Only what this building actually holds
                      // is offered — an out-of-stock product is not something it can sell, and listing
                      // one only for the form to refuse it later wastes the click.
                      //
                      // This replaces the My/Other tabs: the paging now lives in inventory_service,
                      // which knows what is on a shelf and nothing about whose catalogue a product
                      // belongs to. Cross-team selling still works — another team's goods sitting in
                      // this warehouse are in the list like any other, with their owner on the row.
                      stockedOnly
                      teamId={teamId ?? 0n}
                      stockWarehouseId={warehouseId > 0n ? warehouseId : undefined}
                      // NO WAREHOUSE, NO PICKING (owner). Every figure that makes a product pickable —
                      // what is on the shelf, what it cost — is a fact about ONE BUILDING, so browsing
                      // before naming one produces a list where nothing can be judged. Refusing the
                      // dialog is kinder than opening it full of blanks.
                      disabled={warehouseId <= 0n}
                      value={pickedIds}
                      onChange={pickProducts}
                      trigger={
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={warehouseId <= 0n}
                          data-testid="order-create-add-line"
                        >
                          <Icon as={PackagePlus} boxSize="4" />
                          {t("orders.addLine")}
                        </Button>
                      }
                    />

                    {/* WHY it is disabled, beside the disabled thing. A greyed-out button with no
                        explanation is the worst state a form can be in: the person cannot tell a
                        broken screen from one waiting on them. */}
                    {warehouseId <= 0n && (
                      <Text fontSize="sm" color="orange.fg" data-testid="order-create-need-warehouse">
                        {t("orders.pickWarehouseFirst")}
                      </Text>
                    )}
                  </Flex>

                  {lines.length === 0 && (
                    <Text fontSize="sm" color="fg.muted" data-testid="order-create-no-products">
                      {t("orders.noProducts")}
                    </Text>
                  )}

                  {/* A TABLE, not a stack of cards (owner). Lines are the same five facts repeated,
                      so the quantities line up in a column, the money lines up in a column, and the
                      HPP has somewhere to belong instead of floating between two inputs.

                      It scrolls inside its own box: six columns on a phone would otherwise push the
                      whole page sideways. */}
                  {lines.length > 0 && (
                    <Box overflowX="auto">
                      <Table.Root size="sm" data-testid="order-lines-table">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader>{t("orders.product")}</Table.ColumnHeader>
                            <Table.ColumnHeader textAlign="end">{t("orders.inStock")}</Table.ColumnHeader>
                            <Table.ColumnHeader textAlign="end">{t("orders.qty")}</Table.ColumnHeader>
                            <Table.ColumnHeader textAlign="end">{t("orders.hpp")}</Table.ColumnHeader>
                            <Table.ColumnHeader textAlign="end">{t("orders.lineTotal")}</Table.ColumnHeader>
                            <Table.ColumnHeader />
                          </Table.Row>
                        </Table.Header>

                        <Table.Body>
                          {lines.map((line, i) => (
                            <OrderLineRow
                              key={line.productId.toString()}
                              index={i}
                              line={line}
                              stock={lineStock(line, stock)}
                              costs={costs}
                              onPatch={(patch) => patchLine(line.productId, patch)}
                              onRemove={() => removeLine(line.productId)}
                            />
                          ))}
                        </Table.Body>
                      </Table.Root>
                    </Box>
                  )}
                </Stack>
              </Card.Body>
            </Card.Root>
          </GridItem>

          {/* ── WHERE IT GOES, WHAT WAS HANDED OVER, WHO IT IS FOR ── left column, two abreast ──

                ┌ Delivery address ┐ ┌ Shipping receipt ───┐
                │  (four rungs +   │ ├ Customer & shipping ┤
                │   street)        │ └─────────────────────┘
                └──────────────────┘

              The receipt sits beside the address because both describe the PARCEL: what was handed
              to the courier, going to that place. */}
          <GridItem gridColumn={{ lg: 1 }} gridRow={{ lg: 3 }}>
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="section" alignItems="start">
              {/* NOT required: nothing here gates the Create button (#118). */}
              <Card.Root>
                <Card.Body>
                  <Stack gap="card">
                    <Text fontWeight="medium">{t("orders.deliveryAddress")}</Text>
                    <AddressPicker value={address} onChange={setAddress} />
                  </Stack>
                </Card.Body>
              </Card.Root>

              {/* ONE CONTAINER for the second column (owner): the receipt, then the customer,
                  stacked — so the column starts level with the address and grows down it instead of
                  waiting for the address to end.

                  Both of these are short cards and the address is a four-rung cascade, so any
                  arrangement that gave them their own grid ROWS left a tall hole beside the address.
                  Stacked, the two of them are roughly the address's height and the row closes. */}
              <Stack gap="section">
                <Card.Root>
                  <Card.Body>
                    <Stack gap="card">
                      <Text fontWeight="medium">{t("orders.receipt")}</Text>
                      <ReceiptUpload teamId={teamId ?? 0n} value={receipt} onChange={setReceipt} />
                    </Stack>
                  </Card.Body>
                </Card.Root>

                <CustomerShipping
                  customerName={customerName}
                  onCustomerNameChange={setCustomerName}
                  customerPhone={customerPhone}
                  onCustomerPhoneChange={setCustomerPhone}
                  shippingCode={shippingCode}
                  onShippingCodeChange={setShippingCode}
                />
              </Stack>
            </SimpleGrid>
          </GridItem>

          {/* ── WHAT IT COMES TO, AND ANYTHING ELSE ──────────────── right column, and it STICKS ──
              Adding a tenth line used to push the total and the Create button off the bottom of the
              screen. Sticky keeps both in view while the lines column scrolls past — which is the
              whole reason the money went in its own column rather than under the lines. */}
          <GridItem
            gridColumn={{ lg: 2 }}
            // Spans every left-column row: a sticky item can only stick inside its own grid area, so
            // a span that stopped short would let the total scroll away exactly when the form is at
            // its longest.
            gridRow={{ lg: "1 / span 3" }}
            position={{ base: "static", lg: "sticky" }}
            top="4"
          >
            <Stack gap="section">
              {/* THE NOTE, in the right column (owner) — above the totals, and that order is the
                  design. The Create button is the last thing in the totals card, and a field placed
                  after a submit button is a field people do not fill in.

                  It rides in the STICKY column, so the note stays reachable while a long list of
                  lines scrolls past it — which is what a note is for: something remembered halfway
                  through typing the order, not something written in a fixed place at the end. */}
              <Card.Root>
                <Card.Body>
                  <Stack gap="card">
                    <Text fontWeight="medium">{t("orders.note")}</Text>

                    <Field.Root>
                      <Textarea
                        rows={3}
                        maxLength={2000}
                        value={note}
                        placeholder={t("orders.notePlaceholder")}
                        data-testid="order-create-note"
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <Field.HelperText>{t("orders.noteHelp")}</Field.HelperText>
                    </Field.Root>
                  </Stack>
                </Card.Body>
              </Card.Root>

              {/* What the storefront took — its OWN card (owner), between the note and the totals.
                  It is a record of the sale, not a term of the sum, and standing outside the totals
                  card is what says so without a paragraph of help text. */}
              <MarketplaceTotal value={marketplaceTotal} onChange={setMarketplaceTotal} />

              {/* THE TWO EXITS, SIDE BY SIDE (owner) — equal columns, draft on the left.

                  They are alternatives, not a sequence, and a row says that where a stack did not:
                  stacked, the draft read as a step on the way to Create rather than the other thing
                  you can do with this work. Equal widths because neither is a sub-action of the
                  other; the COLOUR is what marks which one this page is for. */}
              <OrderTotals
                subtotal={subtotal}
                total={total}
                action={
                  <SimpleGrid columns={2} gap="2">
                    {/* SAVE AS DRAFT asks for far less — a draft needs nothing but something typed —
                        so it is enabled while Create is still refusing, which is the whole point: the
                        work has somewhere to go before the order is placeable. */}
                    <Button
                      type="button"
                      w="full"
                      variant="outline"
                      loading={savingDraft}
                      disabled={!dirty || saving}
                      data-testid="order-create-save-draft"
                      onClick={() => void saveDraft()}
                    >
                      <Icon as={FileClock} boxSize="4" />
                      {t("orders.saveAsDraft")}
                    </Button>

                    <Button
                      type="submit"
                      w="full"
                      colorPalette="brand"
                      loading={saving}
                      disabled={!canSave || savingDraft}
                      data-testid="order-create-save"
                    >
                      {t("orders.createOrder")}
                    </Button>
                  </SimpleGrid>
                }
              />
            </Stack>
          </GridItem>
        </Grid>
      </form>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        title={t("orders.discardTitle")}
        message={t("orders.discardMessage")}
        confirmLabel={t("orders.discardConfirm")}
        onConfirm={async () => blocker.proceed?.()}
        // Closing the dialog ANY other way — Cancel, the X, the backdrop, Escape — means "stay", so
        // the navigation is reset rather than left hanging. `reset` is only defined while the blocker
        // is blocked, so the close that follows a confirmed proceed is a no-op rather than a fight.
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      />
    </Stack>
  );
}
