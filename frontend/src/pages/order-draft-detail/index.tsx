import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Grid,
  GridItem,
  Heading,
  HStack,
  Icon,
  IconButton,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import { emptyAddress } from "../../components/customers/AddressPicker";
import type { AddressValue } from "../../components/customers/AddressPicker";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { ProductSelect } from "../../components/products/ProductSelect";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { ShippingSelect } from "../../components/pickers/ShippingSelect";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { toaster } from "../../components/feedback/Toaster";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";
import { useTeam } from "../../features/team/TeamContext";
import { CustomerInfoForm } from "../../components/customers/CustomerInfoForm";
import { OrderLineRow } from "../../features/orders/OrderLineRow";
import { OrderTotals } from "../../features/orders/OrderTotals";
import { lineStock, toQty, toRupiah } from "../../features/orders/lines";
import type { LineDraft } from "../../features/orders/lines";
import { useStockAvailability } from "../../features/inventory/queries";
import { draftGaps } from "../../features/orderDrafts/draftReadiness";
import {
  useDeleteOrderDrafts,
  useOrderDraft,
  usePromoteOrderDraft,
  useUpdateOrderDraft,
} from "../../features/orderDrafts/queries";

// One line as this screen holds it.
//
// ⚠ KEYED BY ROW (`id`), not by product — the opposite of the order form, and the difference is the
// job rather than an inconsistency. A draft line is one thing the scraper READ: it exists before any
// product is named (`productId` 0), two lines may map to the same product, and re-mapping must not
// destroy the row or the scraped text pinned to it.
//
// The scraped text rides along READ-ONLY: it is the evidence of what the buyer ordered, and it stays
// on screen next to the mapping so a wrong mapping is visible.
interface DraftLine {
  id: bigint;
  externalSku: string;
  externalName: string;
  productId: bigint;
  /** The mapped product's label, filled in when somebody picks one. A line loaded from the server has
   * only an id — the catalogue read that would resolve it is not worth a request per line, and the
   * scraped text above already says what the line is. */
  sku: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

// What the shared row needs. The identity (`id`) stays here — the row is deliberately identity-free,
// because the form keys by product and this screen keys by row.
function rowLine(line: DraftLine): LineDraft {
  return {
    productId: line.productId,
    sku: line.sku,
    name: line.name,
    imageUrl: "",
    thumbnailUrl: "",
    quantity: line.quantity,
  };
}

function addressOf(draft: OrderDraft): AddressValue {
  const a = draft.address;
  if (!a) return emptyAddress;

  return {
    provinsiCode: a.provinsiCode,
    provinsiName: a.provinsiName,
    kabupatenCode: a.kabupatenCode,
    kabupatenName: a.kabupatenName,
    kecamatanCode: a.kecamatanCode,
    kecamatanName: a.kecamatanName,
    desaCode: a.desaCode,
    desaName: a.desaName,
    kodePos: a.kodePos,
    addressLine: a.addressLine,
  };
}

function linesOf(draft: OrderDraft): DraftLine[] {
  return draft.items.map((item) => ({
    id: item.id,
    externalSku: item.externalSku,
    externalName: item.externalName,
    productId: item.productId,
    sku: "",
    name: "",
    quantity: String(item.quantity),
    unitPrice: item.unitPrice.toString(),
  }));
}

function sameLines(a: DraftLine[], b: DraftLine[]): boolean {
  if (a.length !== b.length) return false;

  return a.every((line, i) => {
    const other = b[i];

    return (
      line.id === other.id &&
      line.productId === other.productId &&
      line.quantity === other.quantity &&
      line.unitPrice === other.unitPrice
    );
  });
}

// OrderDraftDetailPage is where scraped text becomes a real product (#196) — a PAGE, not a dialog,
// because it is a record somebody works through rather than a focused action.
//
// It is BUILT FROM THE ORDER FORM'S PARTS (owner): the same lines table, the same customer card, the
// same money card, the same two-column layout with the total pinned. The two screens compose the same
// thing, and the pieces they share are shared rather than re-typed — a draft of twelve lines used to
// push Promote off the bottom of a single narrow column, which is the exact problem the form's sticky
// column was built to fix.
//
// What stays DIFFERENT is only what the job differs about:
//
//   • the SCRAPED TEXT above each mapping — the form has none, because a product picked from the
//     catalogue is its own evidence;
//   • a ProductSelect PER LINE rather than the form's multi-tick picker — a picker hands back a set,
//     and a set cannot say which scraped line a tick belongs to;
//   • the PRICE IS TYPED (owner) — a draft's money is what the marketplace charged, not the HPP the
//     form reads off the warehouse;
//   • the catalogue is NOT narrowed to what this warehouse stocks (owner) — a scrape may legitimately
//     name a product that is out of stock, and refusing to MAP it is not the same as refusing to
//     promote it.
//
// ⚠ IT SAVES ONLY WHAT CHANGED, and that is not an optimisation. `OrderDraftUpdate` marks every
// field it receives as TOUCHED, and a touched field is one the pushing app may never write again.
// Sending the whole form on every save would freeze the entire draft against the app the first time
// anybody pressed Save — the blanks-only merge would stop meaning anything.
export function OrderDraftDetailPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const params = useParams();

  const teamId = current?.teamId;
  const draftId = BigInt(params.draftId ?? "0");

  const query = useOrderDraft({ teamId, draftId });
  const update = useUpdateOrderDraft();
  const promote = usePromoteOrderDraft();
  const remove = useDeleteOrderDrafts();

  const draft = query.data ?? null;

  const [shopId, setShopId] = useState<bigint>(0n);
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [shippingCode, setShippingCode] = useState("");
  const [shippingCost, setShippingCost] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The loaded draft is the BASELINE every save is diffed against. Re-seeding on each fetch is what
  // makes a save idempotent: after it lands, the refetched draft becomes the new baseline and the
  // form is clean again.
  useEffect(() => {
    if (!draft) return;

    setShopId(draft.shopId);
    setWarehouseId(draft.warehouseId);
    setCustomerName(draft.customerName);
    setCustomerPhone(draft.customerPhone);
    setAddress(addressOf(draft));
    setShippingCode(draft.shippingCode);
    setShippingCost(draft.shippingCost.toString());
    setLines(linesOf(draft));
  }, [draft]);

  const baselineLines = useMemo(() => (draft ? linesOf(draft) : []), [draft]);

  // WHAT THE CHOSEN WAREHOUSE HOLDS, for every mapped line — the same batched read the order form
  // makes, and it exists here for the same reason: Promote runs `placeOrder`, so this draft is one
  // button away from taking these goods off a shelf. Unmapped lines carry product 0 and are filtered
  // out by the hook, so a half-mapped draft still gets figures for the half that is done.
  const productIds = useMemo(() => lines.map((l) => l.productId), [lines]);
  const stockQuery = useStockAvailability({ teamId, warehouseId, productIds });
  const stock = stockQuery.data;

  function patchLine(id: bigint, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function pickProduct(id: bigint, p: PickedProduct) {
    patchLine(id, { productId: p.id, sku: p.sku, name: p.name });
  }

  function removeLine(id: bigint) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + BigInt(toQty(l.quantity)) * toRupiah(l.unitPrice), 0n),
    [lines],
  );

  // How many mapped lines the warehouse cannot fill. Summarised at the top as well as marked on each
  // row: on a long draft the failing line can be off screen, and "Promote is disabled and I cannot
  // see why" is the state this page must never be in.
  const shortLines = lines.filter((l) => {
    const s = lineStock(rowLine(l), stock);
    return s.kind === "known" && s.short;
  }).length;

  const dirty = useMemo(() => {
    if (!draft) return false;

    return (
      shopId !== draft.shopId ||
      warehouseId !== draft.warehouseId ||
      customerName !== draft.customerName ||
      customerPhone !== draft.customerPhone ||
      JSON.stringify(address) !== JSON.stringify(addressOf(draft)) ||
      shippingCode !== draft.shippingCode ||
      shippingCost !== draft.shippingCost.toString() ||
      !sameLines(lines, baselineLines)
    );
  }, [
    draft,
    shopId,
    warehouseId,
    customerName,
    customerPhone,
    address,
    shippingCode,
    shippingCost,
    lines,
    baselineLines,
  ]);

  // Readiness is computed from what is ON SCREEN, not from what was last saved — otherwise mapping
  // the final line would leave Promote disabled until somebody pressed Save and noticed.
  const pending: OrderDraft | null = draft
    ? ({
        ...draft,
        shopId,
        warehouseId,
        customerName,
        itemCount: lines.length,
        unmappedItemCount: lines.filter((l) => l.productId === 0n).length,
      } as OrderDraft)
    : null;

  const gaps = pending ? draftGaps(pending, { shortLines }) : [];
  const ready = gaps.length === 0;

  async function save() {
    if (!teamId || !draft) return;

    setSaving(true);
    setError("");

    try {
      // ONLY THE CHANGED FIELDS. Each one included here becomes untouchable by the app.
      await update.mutateAsync({
        teamId,
        draftId: draft.id,
        shopId: shopId !== draft.shopId ? shopId : undefined,
        warehouseId: warehouseId !== draft.warehouseId ? warehouseId : undefined,
        customerName: customerName !== draft.customerName ? customerName : undefined,
        customerPhone: customerPhone !== draft.customerPhone ? customerPhone : undefined,
        address:
          JSON.stringify(address) !== JSON.stringify(addressOf(draft)) ? address : undefined,
        shippingCode: shippingCode !== draft.shippingCode ? shippingCode : undefined,
        shippingCost:
          shippingCost !== draft.shippingCost.toString() ? toRupiah(shippingCost) : undefined,
        items: sameLines(lines, baselineLines)
          ? undefined
          : {
              lines: lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                quantity: toQty(l.quantity),
                unitPrice: toRupiah(l.unitPrice),
              })),
            },
      });

      toaster.create({ type: "success", title: t("orderDrafts.saved") });
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  async function doPromote() {
    if (!teamId || !draft) return;

    setSaving(true);
    setError("");

    try {
      const res = await promote.mutateAsync({ teamId, draftId: draft.id });

      toaster.create({ type: "success", title: t("orderDrafts.promoted") });

      const id = res.order?.id;
      void navigate(id ? `/orders/${id}` : "/orders");
    } catch (err) {
      // The draft survives a refused promote — a product deleted underneath it, a shop that is gone.
      // The message names WHICH reference died, so it is shown rather than reduced to "failed".
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!teamId || !draft) return;

    await remove.mutateAsync({ teamId, draftIds: [draft.id] });
    void navigate("/order-drafts");
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orderDrafts.title")}</Heading>
        <Text color="fg.muted">{t("orderDrafts.selectTeamView")}</Text>
      </Stack>
    );
  }

  if (query.isPending) {
    return <Spinner colorPalette="brand" />;
  }

  if (!draft) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orderDrafts.title")}</Heading>
        <Text color="fg.muted" data-testid="draft-not-found">
          {t("orderDrafts.notFound")}
        </Text>
      </Stack>
    );
  }

  return (
    // No `maxW`: the page fills the content area, as the order form does. A cap made sense while this
    // was one narrow column of stacked cards; a two-column grid has the opposite problem, because the
    // wider the window the more room the lines get — and the lines are the column that wants it.
    <Stack gap="section" data-testid="draft-detail-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("orderDrafts.back")}
          data-testid="draft-back"
          onClick={() => navigate("/order-drafts")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{t("orderDrafts.draftTitle", { ref: draft.externalId })}</Heading>
        <Badge colorPalette="gray">{draft.source}</Badge>
        <Spacer />
        <Button
          size="xs"
          variant="outline"
          colorPalette="red"
          data-testid="draft-delete"
          onClick={() => setConfirmDelete(true)}
        >
          <Icon as={Trash2} boxSize="4" />
          {t("orderDrafts.deleteConfirm")}
        </Button>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="draft-error">
          {error}
        </Text>
      )}

      {/* Full width, above both columns: a line the warehouse cannot fill is a fact about the whole
          draft, not about the column the line happens to sit in. */}
      {shortLines > 0 && (
        <Alert.Root status="error" data-testid="draft-short">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("orders.shortTitle", { count: shortLines })}</Alert.Title>
            <Alert.Description>{t("orderDrafts.shortHelp")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {/*
        THE ORDER FORM'S LAYOUT, because this screen composes the same thing. Two columns on a wide
        screen, one on a narrow one, and the columns are assigned by explicit `gridColumn`/`gridRow`
        so DOM order is visual order is tab order.
      */}
      <Grid
        templateColumns={{ base: "1fr", lg: "minmax(0, 2fr) minmax(0, 1fr)" }}
        gap="section"
        alignItems="start"
      >
        {/* ── WHICH SHOP, WHICH WAREHOUSE ─────────────────────────────── first, as on the form ──
            Both frame everything below them, and the warehouse decides what the stock figures on the
            lines even mean. A scrape almost never knows either, so on a draft these are usually the
            two fields somebody is here to fill in. */}
        <GridItem gridColumn={{ lg: 1 }} gridRow={{ lg: 1 }}>
          <Card.Root>
            <Card.Body>
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
                <Field.Root required>
                  <Field.Label>{t("orders.shop")}</Field.Label>
                  <ShopSelect teamId={teamId ?? 0n} value={shopId} onChange={setShopId} />
                </Field.Root>

                <Field.Root required>
                  <Field.Label>{t("orders.warehouse")}</Field.Label>
                  <Box w="full" data-testid="draft-warehouse">
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

        {/* ── THE MAPPING ────────────────────────────────────────────────────── the real work ── */}
        <GridItem gridColumn={{ lg: 1 }} gridRow={{ lg: 2 }}>
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Heading as="h3" size="sm">{t("orderDrafts.mapLines")}</Heading>
                <Text fontSize="sm" color="fg.muted">
                  {t("orderDrafts.mapLinesHelp")}
                </Text>

                {lines.length === 0 && (
                  <Text color="fg.muted" data-testid="draft-no-lines">
                    {t("orderDrafts.missingLines")}
                  </Text>
                )}

                {/* THE SAME TABLE THE ORDER FORM USES. It scrolls inside its own box: six columns on
                    a phone would otherwise push the whole page sideways. */}
                {lines.length > 0 && (
                  <Box overflowX="auto">
                    <Table.Root size="sm" data-testid="draft-lines-table">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>{t("orders.product")}</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">{t("orders.inStock")}</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">{t("orders.qty")}</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">{t("orders.unitPrice")}</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">{t("orders.lineTotal")}</Table.ColumnHeader>
                          <Table.ColumnHeader />
                        </Table.Row>
                      </Table.Header>

                      <Table.Body>
                        {lines.map((line, i) => (
                          <OrderLineRow
                            key={line.id.toString()}
                            idPrefix="draft-line"
                            index={i}
                            line={rowLine(line)}
                            stock={lineStock(rowLine(line), stock)}
                            total={BigInt(toQty(line.quantity)) * toRupiah(line.unitPrice)}
                            // NO THUMBNAIL. A draft line names a product by id and nothing more, so
                            // the cover would be the same grey placeholder on every row — and its
                            // indent pushes the mapping control out of line with the scraped text
                            // directly above it, which is the one comparison this screen exists for.
                            cover={false}
                            // THE SCRAPED TEXT, ABOVE THE MAPPING AND NEVER REPLACED BY IT. It is the
                            // evidence of what the buyer actually ordered — the only thing anybody can
                            // check a mapping against, and the reason a wrong one is visible at all.
                            evidence={
                              <Stack gap="0.5" mb="2">
                                <HStack gap="2">
                                  <Badge size="xs" colorPalette="gray">
                                    {t("orderDrafts.scraped")}
                                  </Badge>
                                  {line.externalSku && (
                                    <Text fontSize="xs" color="fg.muted">
                                      {line.externalSku}
                                    </Text>
                                  )}
                                </HStack>
                                <Text fontSize="sm" data-testid={`draft-line-scraped-${i}`}>
                                  {line.externalName || t("orderDrafts.noScrapedName")}
                                </Text>
                              </Stack>
                            }
                            // A SELECT PER LINE, not the form's multi-tick picker: a picker hands back
                            // a ticked SET, and a set cannot say which scraped line a tick belongs to.
                            // The catalogue is NOT narrowed to what this warehouse stocks (owner) — a
                            // scrape may name a product that is out of stock, and that is a reason to
                            // refuse the PROMOTE, not the mapping.
                            product={
                              <Box flex="1" minW="52">
                                <ProductSelect
                                  teamId={teamId ?? 0n}
                                  value={line.productId}
                                  onChange={(p) => pickProduct(line.id, p)}
                                />
                                {line.productId > 0n ? (
                                  <Text
                                    fontSize="xs"
                                    color="fg.muted"
                                    mt="1"
                                    data-testid={`draft-line-mapped-${i}`}
                                  >
                                    {line.name ? `${line.sku} — ${line.name}` : t("orderDrafts.mapped")}
                                  </Text>
                                ) : (
                                  <Text
                                    fontSize="xs"
                                    color="orange.fg"
                                    mt="1"
                                    data-testid={`draft-line-unmapped-${i}`}
                                  >
                                    {t("orderDrafts.notMappedYet")}
                                  </Text>
                                )}
                              </Box>
                            }
                            // TYPED, unlike the form's read-only HPP (owner). A draft's money is what
                            // the marketplace charged the buyer — a fact the scrape read and a person
                            // corrects, not something the warehouse can be asked for.
                            price={
                              <CurrencyInput
                                size="xs"
                                w="28"
                                textAlign="end"
                                value={line.unitPrice}
                                data-testid={`draft-line-price-${i}`}
                                onChange={(v) => patchLine(line.id, { unitPrice: v })}
                              />
                            }
                            onPatch={(patch) => patchLine(line.id, patch)}
                            // A buyer who cancelled one line of three must be able to say so, or the
                            // draft stays unpromotable forever over a line nobody wants.
                            onRemove={() => removeLine(line.id)}
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

        {/* ── WHO IT IS FOR, AND HOW IT TRAVELS ─────────────── stacked, as on the form ──
            The customer and the address are ONE two-column card (owner), the same one the create form
            mounts. What the form puts under it is a shipping RECEIPT; a draft has none — nothing has
            been handed to a courier yet — so only the courier itself follows. */}
        <GridItem gridColumn={{ lg: 1 }} gridRow={{ lg: 3 }}>
          <Stack gap="section">
            <CustomerInfoForm
              idPrefix="draft"
              customerName={customerName}
              onCustomerNameChange={setCustomerName}
              customerPhone={customerPhone}
              onCustomerPhoneChange={setCustomerPhone}
              address={address}
              onAddressChange={setAddress}
            />

            {/* THE COURIER, ON ITS OWN — it left the customer card (owner), and a draft has no
                shipping-receipt card to take it: nothing has been handed over yet, so there is no
                tracking number and no slip to sit beside.

                It still has to be here. A scraped draft arrives carrying the marketplace's chosen
                courier, the field is editable before promotion, and the save sends it — a card that
                simply stopped rendering it would silently drop a value the screen still writes.

                A narrow card for one narrow control: full width, a lone combobox would stretch to the
                width of the lines table above it and read as a search bar. */}
            <Card.Root maxW={{ md: "sm" }}>
              <Card.Body>
                <Stack gap="card">
                  <Heading as="h3" size="sm">{t("orders.shipping")}</Heading>
                  <Field.Root>
                    <ShippingSelect value={shippingCode} onChange={setShippingCode} />
                  </Field.Root>
                </Stack>
              </Card.Body>
            </Card.Root>
          </Stack>
        </GridItem>

        {/* ── WHAT IT COMES TO, AND THE TWO EXITS ──────────────── right column, and it STICKS ──
            A draft of a dozen lines used to push Promote off the bottom of the page. Sticky keeps the
            total and both buttons in view while the lines scroll past. */}
        <GridItem
          gridColumn={{ lg: 2 }}
          gridRow={{ lg: "1 / span 3" }}
          position={{ base: "static", lg: "sticky" }}
          top="4"
        >
          <OrderTotals
            idPrefix="draft"
            subtotal={subtotal}
            total={subtotal + toRupiah(shippingCost)}
            // A DRAFT HAS A SHIPPING COST and the order form does not: the scrape read what the
            // marketplace charged for delivery, and promote carries that figure onto the order.
            shipping={
              <Field.Root>
                <Field.Label>{t("orders.shippingCost")}</Field.Label>
                <CurrencyInput
                  w="40"
                  value={shippingCost}
                  data-testid="draft-shipping-cost"
                  onChange={setShippingCost}
                />
              </Field.Root>
            }
            action={
              <Stack gap="card">
                {/* WHY Promote is disabled, beside the button rather than behind a click. The
                    alternative is a person pressing it and reading a rejection to learn what they
                    already could have seen. */}
                {!ready && (
                  <HStack gap="1" wrap="wrap" data-testid="draft-gaps">
                    <Text fontSize="sm" color="fg.muted">
                      {t("orderDrafts.remaining")}:
                    </Text>
                    {gaps.map((gap) => (
                      <Badge key={gap.key} colorPalette="gray">
                        {t(gap.key)}
                      </Badge>
                    ))}
                  </HStack>
                )}

                {/* THE TWO EXITS, SIDE BY SIDE, as on the order form — equal columns, the
                    non-committing one on the left. */}
                <SimpleGrid columns={2} gap="2">
                  <Button
                    type="button"
                    w="full"
                    variant="outline"
                    loading={saving}
                    disabled={!dirty}
                    data-testid="draft-save"
                    onClick={() => void save()}
                  >
                    {t("orderDrafts.save")}
                  </Button>

                  {/* Promote refuses an unsaved edit rather than silently saving first: it destroys
                      the draft, and a button that quietly does two things is the wrong one to be
                      surprised by. */}
                  <Button
                    type="button"
                    w="full"
                    colorPalette="brand"
                    loading={saving}
                    disabled={!ready || dirty}
                    data-testid="draft-promote"
                    onClick={() => void doPromote()}
                  >
                    {dirty ? t("orderDrafts.saveFirst") : t("orderDrafts.promote")}
                  </Button>
                </SimpleGrid>
              </Stack>
            }
          />
        </GridItem>
      </Grid>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("orderDrafts.deleteOneTitle")}
        message={t("orderDrafts.deleteOneMessage", { ref: draft.externalId })}
        confirmLabel={t("orderDrafts.deleteConfirm")}
        onConfirm={doDelete}
      />
    </Stack>
  );
}
