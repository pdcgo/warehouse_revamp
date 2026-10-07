import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
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
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ChevronsDownUp, ChevronsUpDown, Trash2, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";
import { useTeam } from "../../features/team/TeamContext";
import {
  useDeleteOrderDrafts,
  useOrderDraft,
  usePromoteOrderDraft,
  useUpdateOrderDraft,
} from "../../features/orderDrafts/queries";
import { useStockAvailability, useStockCosts } from "../../features/inventory/queries";
import { useProductsByIds } from "../../features/products/queries";
import { useTeams } from "../../features/teams/queries";
import { MarketplaceInfoForm, emptyMarketplaceInfo } from "../../components/orders/MarketplaceInfoForm";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import type { MarketplaceInfoValue } from "../../components/orders/MarketplaceInfoForm";
import { emptyReceipt } from "../../components/orders/ReceiptUpload";
import type { ReceiptValue } from "../../components/orders/ReceiptUpload";
import { CustomerInfoForm } from "../../components/customers/CustomerInfoForm";
import { emptyAddress } from "../../components/customers/AddressPicker";
import type { AddressValue } from "../../components/customers/AddressPicker";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { DatePicker } from "../../components/datetime/DatePicker";
import { todayDateInput } from "../../lib/datetime";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { lineTotal, toRupiah } from "../../features/orders/lines";
import { mockTerms } from "../../features/orders/form/mockData";
import { creditRows, invoiceRows } from "../../features/orders/form/money";
import { WarehouseBand } from "../../features/orders/form/WarehouseBand";
import { ShippingReceiptCard } from "../../features/orders/form/ShippingReceiptCard";
import { ReturnMappingCard } from "../../features/orders/form/ReturnMappingCard";
import type { CrossLine, MappedProduct } from "../../features/orders/form/ReturnMappingCard";
import { ExtraInfoCard } from "../../features/orders/form/ExtraInfoCard";
import { CreditLimitPanel } from "../../features/orders/form/CreditLimitPanel";
import { ProfitEstimatePanel } from "../../features/orders/form/ProfitEstimatePanel";
import { TotalsInvoicePanel } from "../../features/orders/form/TotalsInvoicePanel";
import { NoteAndSubmitCard } from "../../features/orders/form/NoteAndSubmitCard";
import { OrderChecksDialog } from "../../features/orders/form/OrderChecksDialog";
import type { CheckFinding } from "../../features/orders/form/checks";
import { runOrderChecks } from "../../features/orders/form/checks";
import { ORDER_FORM_PENDING } from "../../features/orders/form/pending";
import { ORDER_DRAFT_PENDING } from "./pending";
import type { DraftRow } from "./rows";
import {
  emptyRow,
  rowLines,
  rowMapped,
  rowMpTotal,
  rowSavedProduct,
  rowSavedQuantity,
  rowShort,
  rowsFromDraft,
  sameStoredRows,
} from "./rows";
import { DraftRowsCard } from "./components/DraftRowsCard";

// A DRAFT, IN THE ORDER FORM'S CLOTHES (`the-draft-page-wears-the-order-form`) — `/order-drafts/:id`.
//
// The draft keeps its own page (`the-draft-keeps-its-own-page`), and that page now reads like the order
// create form: the warehouse band on top, the receipt card, the order information, the items, the
// return mapping, the customer, the extras — and the money rail on the right, with Save and Promote
// where Save as Draft and Create are.
//
// What differs is only what a draft IS:
//
//   • each item is a scraped ROW, mapped to a product, a bundle or a split
//     (`a-draft-row-maps-to-a-product-a-bundle-or-a-split`);
//   • the price per row is what the platform charged (the draft's own), so the sell price is their
//     sum and the profit estimate is REAL rather than typed;
//   • Save keeps anything, in any state; Promote is refused until the order could be placed, and runs
//     the form's own checks first;
//   • what a draft cannot store is on screen with a ⚠, as everywhere else (`draftKeeps`).
//
// Approved as a preview and routed in place of the built page (`the-draft-preview-became-the-draft-page`).

interface Baseline {
  shopId: bigint;
  warehouseId: bigint;
  customerName: string;
  customerPhone: string;
  address: AddressValue;
  shippingCode: string;
  rows: DraftRow[];
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

function parseId(raw: string | undefined): bigint {
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

export function OrderDraftDetailPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const params = useParams();

  const teamId = current?.teamId;
  const draftId = parseId(params.draftId);

  const query = useOrderDraft({ teamId, draftId });
  const update = useUpdateOrderDraft();
  const promote = usePromoteOrderDraft();
  const remove = useDeleteOrderDrafts();
  const draft = query.data ?? null;

  // ── What a draft stores ──
  const [marketplace, setMarketplace] = useState<MarketplaceInfoValue>(emptyMarketplaceInfo);
  const shopId = marketplace.shopId;
  const [warehouseId, setWarehouseId] = useState(0n);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [shippingCode, setShippingCode] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);

  // ── What it does not (on screen, ⚠ draftKeeps) ──
  const [receipt, setReceipt] = useState<ReceiptValue>(emptyReceipt);
  const [receiptCode, setReceiptCode] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [buyerUsername, setBuyerUsername] = useState("");
  const [note, setNote] = useState("");
  // THE SELL PRICE, AS TYPED — `null` while nobody has typed one, and then it FOLLOWS the rows' platform
  // prices. Typing takes it over (owner: *"sell price masih mungkin untuk diganti"*), and an EMPTY box
  // is 0, not "follow the rows again" — otherwise backspacing a figure away would snap it back mid-edit.
  // Following the rows again is its own button. ⚠ Not stored: a draft has no sell price (`sellPrice`).
  const [sellPriceTyped, setSellPriceTyped] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Map<string, MappedProduct>>(new Map());

  const [compact, setCompact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState("");
  const [gate, setGate] = useState<CheckFinding[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [added, setAdded] = useState(0);

  // SEED from the draft — and again after a save, from what the server now holds. The loaded draft is
  // the baseline every save is diffed against. What a draft cannot store is left alone.
  function seed(from: OrderDraft) {

    const next: Baseline = {
      shopId: from.shopId,
      warehouseId: from.warehouseId,
      customerName: from.customerName,
      customerPhone: from.customerPhone,
      address: addressOf(from),
      shippingCode: from.shippingCode,
      rows: rowsFromDraft(from),
    };

    setMarketplace((prev) => ({ ...prev, shopId: next.shopId }));
    setWarehouseId(next.warehouseId);
    setCustomerName(next.customerName);
    setCustomerPhone(next.customerPhone);
    setAddress(next.address);
    setShippingCode(next.shippingCode);
    setRows(next.rows);
    setBaseline(next);
  }

  // Once per draft — a save's refetch must not wipe what the draft cannot store out from under the person.
  const seededFor = useRef("");

  useEffect(() => {
    if (!draft || seededFor.current === draft.id.toString()) return;

    seededFor.current = draft.id.toString();
    seed(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // ── Every product the rows put on the order ──
  const allLines = useMemo(() => rows.flatMap(rowLines), [rows]);
  const productIds = useMemo(() => allLines.map((l) => l.productId), [allLines]);
  const stock = useStockAvailability({ teamId, warehouseId, productIds }).data;
  const costs = useStockCosts({ teamId, warehouseId, productIds }).data;

  // Names for mapped rows (a draft names a product by id only), and owners for the invoice.
  const mappedIds = useMemo(
    () => [...productIds, ...rows.map((r) => r.product?.productId ?? 0n)],
    [productIds, rows],
  );
  const owners = useProductsByIds({ teamId, productIds: mappedIds }).data;
  const namedRows = useMemo(
    () =>
      rows.map((row) => {
        const p = row.product;
        if (!p || p.name || p.productId <= 0n) return row;
        const found = owners?.get(p.productId.toString());
        return found ? { ...row, product: { ...p, sku: found.sku, name: found.name } } : row;
      }),
    [rows, owners],
  );

  const teamsQuery = useTeams({ page: 1, pageSize: 200, reference: true });
  const teamName = (id: bigint) =>
    teamsQuery.data?.teams.find((team) => team.id === id)?.name ?? `#${id.toString()}`;

  // ── The money — the sell price is the rows' platform prices, so the profit is real ──
  const rowsSellPrice = rows.reduce((sum, row) => sum + rowMpTotal(row), 0n);
  const sellPriceInput = sellPriceTyped ?? (rowsSellPrice > 0n ? rowsSellPrice.toString() : "");
  // 0 when the app read no prices and nobody typed one — the profit then reads no sell price at all.
  const sellPrice = toRupiah(sellPriceInput);
  const productsTotal = allLines.reduce((sum, l) => sum + lineTotal(l, costs), 0n);
  const warehouseFee = warehouseId > 0n ? mockTerms(warehouseId).handlingFee : 0n;
  const orderTotal = productsTotal + warehouseFee;
  const invoice = invoiceRows({ lines: allLines, owners, costs, teamId, warehouseId, warehouseFee, teamName });
  const invoiceTotal = invoice.reduce((sum, row) => sum + row.owed, 0n);
  const credit = creditRows({ invoice, warehouseId, warehouseFee, teamName });

  // ── Return mapping: goods belonging to another team ──
  const crossLines: CrossLine[] = useMemo(() => {
    const seen = new Map<string, CrossLine>();
    for (const line of allLines) {
      const ownerTeamId = owners?.get(line.productId.toString())?.teamId ?? 0n;
      if (ownerTeamId === 0n || ownerTeamId === teamId) continue;
      seen.set(line.productId.toString(), {
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        ownerTeamId,
        ownerName: teamName(ownerTeamId),
      });
    }
    return [...seen.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLines, owners, teamId, teamsQuery.data]);
  const unmappedReturns = crossLines.filter((l) => !mapping.has(l.productId.toString())).length;

  // ── Save: anything, in any state — only what changed ──
  const changed =
    baseline !== null &&
    (shopId !== baseline.shopId ||
      warehouseId !== baseline.warehouseId ||
      customerName !== baseline.customerName ||
      customerPhone !== baseline.customerPhone ||
      JSON.stringify(address) !== JSON.stringify(baseline.address) ||
      shippingCode !== baseline.shippingCode ||
      !sameStoredRows(rows, baseline.rows));

  // ── Promote: refused until the order could be placed ──
  const shortRows = rows.filter((row) => rowShort(row, stock)).length;
  const reasons: string[] = [];
  if (shopId <= 0n) reasons.push(t("orderDrafts.missingShop"));
  if (warehouseId <= 0n) reasons.push(t("orderDrafts.missingWarehouse"));
  if (customerName.trim() === "") reasons.push(t("orderDrafts.missingCustomer"));
  if (rows.length === 0) reasons.push(t("orderDrafts.missingLines"));
  if (rows.some((row) => !rowMapped(row))) reasons.push(t("orderDraftForm.gaps.unmapped"));
  if (rows.some((row) => row.mode !== "product")) reasons.push(t("orderDraftForm.gaps.notStorable"));
  if (shortRows > 0) reasons.push(t("orderDrafts.missingStock"));
  if (changed) reasons.push(t("orderDraftForm.gaps.saveFirst"));
  const canPromote = reasons.length === 0;

  async function save() {
    if (!teamId || !draft || !baseline) return;

    setSaving(true);
    setError("");

    try {
      // ONLY THE CHANGED FIELDS — each one sent becomes a field the app may never write again.
      const res = await update.mutateAsync({
        teamId,
        draftId: draft.id,
        shopId: shopId !== baseline.shopId ? shopId : undefined,
        warehouseId: warehouseId !== baseline.warehouseId ? warehouseId : undefined,
        customerName: customerName !== baseline.customerName ? customerName : undefined,
        customerPhone: customerPhone !== baseline.customerPhone ? customerPhone : undefined,
        address: JSON.stringify(address) !== JSON.stringify(baseline.address) ? address : undefined,
        shippingCode: shippingCode !== baseline.shippingCode ? shippingCode : undefined,
        items: sameStoredRows(rows, baseline.rows)
          ? undefined
          : {
              lines: rows.map((row) => ({
                id: row.itemId,
                // A bundle or a split saves UNMAPPED (`rowBundle`, `rowSplit`).
                productId: rowSavedProduct(row),
                // The mapping's count; the price stays what the app read (information, not edited).
                quantity: rowSavedQuantity(row),
                unitPrice: toRupiah(row.mpPrice),
              })),
            },
      });

      // A bundle or split row survives the save on screen: re-seed only what the draft stores, and keep
      // those rows' mapping where the server returned them unmapped.
      if (res.draft) {
        const kept = new Map(rows.filter((r) => r.mode !== "product").map((r) => [r.itemId.toString(), r]));
        seed(res.draft);
        setRows((fresh) => fresh.map((r) => kept.get(r.itemId.toString()) ?? r));
      }

      toaster.create({ type: "success", title: t("orderDrafts.saved") });
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  // PROMOTE runs the form's own checks first — an error stops it, a warning can be overruled.
  function tryPromote() {
    if (!canPromote) return;

    const findings = runOrderChecks({
      orderRefId: marketplace.orderExternalRefId,
      trackingCode: receiptCode,
      shippingCode,
      marketplace: marketplace.marketplace,
      scan: null,
      sellPrice,
      orderTotal,
    });

    if (findings.length > 0) {
      setGate(findings);
      return;
    }

    void doPromote();
  }

  async function doPromote() {
    if (!teamId || !draft) return;

    setGate([]);
    setPromoting(true);
    setError("");

    try {
      const res = await promote.mutateAsync({ teamId, draftId: draft.id });
      toaster.create({ type: "success", title: t("orderDrafts.promoted") });
      const id = res.order?.id;
      void navigate(id ? `/orders/${id}` : "/orders");
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setPromoting(false);
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

  if (draftId > 0n && query.isPending) {
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

  const cardTeamId = teamId ?? 0n;

  return (
    <Stack gap="section" data-testid="draft-detail-page">
      {/* THE HEADER — the draft's reference, the app that pushed it, and the way out. */}
      <Flex align="center" gap="card" wrap="wrap">
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
          colorPalette="error"
          data-testid="draft-delete"
          onClick={() => setConfirmDelete(true)}
        >
          <Icon as={Trash2} boxSize="4" />
          {t("orderDrafts.deleteOneTitle")}
        </Button>
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="draft-error">
          {error}
        </Text>
      )}

      {shortRows > 0 && (
        <Alert.Root status="error" data-testid="draft-short">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("orders.shortTitle", { count: shortRows })}</Alert.Title>
            <Alert.Description>{t("orders.shortHelp")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      <NotImplementedSummary list={ORDER_DRAFT_PENDING} />

      <WarehouseBand value={warehouseId} onChange={setWarehouseId} />

      <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" }} gap="section" alignItems="start">
        <GridItem minW="0">
          <Stack gap="section">
            <ShippingReceiptCard
              teamId={cardTeamId}
              receipt={receipt}
              onReceiptChange={setReceipt}
              orderRefId={marketplace.orderExternalRefId}
              onOrderRefIdChange={(orderExternalRefId) => setMarketplace({ ...marketplace, orderExternalRefId })}
              trackingCode={receiptCode}
              onTrackingCodeChange={setReceiptCode}
              shippingCode={shippingCode}
              onShippingCodeChange={setShippingCode}
              marketplace={marketplace.marketplace}
              filledFromFile={false}
            />

            {/* ORDER INFORMATION — as on the create form, with the sell price DERIVED: it is the sum of
                what the platform charged per row, so it is read here rather than typed twice. */}
            <Card.Root>
              <Card.Header>
                <Card.Title>{t("orderForm.source.title")}</Card.Title>
                <Card.Description>{t("orderForm.source.help")}</Card.Description>
              </Card.Header>
              <Card.Body>
                <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
                  <Stack gap="card">
                    <MarketplaceInfoForm
                      teamId={cardTeamId}
                      value={marketplace}
                      onChange={setMarketplace}
                      required
                      hideTotal
                      hideOrderRef
                    />
                    <Field.Root>
                      <Field.Label>
                        <Flex align="center" gap="2" wrap="wrap">
                          {t("orderForm.source.sellPrice")}
                          <NotImplemented list={ORDER_DRAFT_PENDING} id="sellPrice" />
                        </Flex>
                      </Field.Label>
                      <CurrencyInput
                        value={sellPriceInput}
                        data-testid="draft-sell-price"
                        onChange={(value) => setSellPriceTyped(value)}
                      />
                      <Field.HelperText>
                        {sellPriceTyped === null ? (
                          t("orderDraftForm.sellPriceHelp")
                        ) : (
                          <Flex align="center" gap="2" wrap="wrap">
                            {t("orderDraftForm.sellPriceTyped")}
                            <Button
                              type="button"
                              size="2xs"
                              variant="ghost"
                              colorPalette="primary"
                              data-testid="draft-sell-price-reset"
                              onClick={() => setSellPriceTyped(null)}
                            >
                              {t("orderDraftForm.sellPriceReset")}
                            </Button>
                          </Flex>
                        )}
                      </Field.HelperText>
                    </Field.Root>
                  </Stack>
                  <Field.Root>
                    <Field.Label>
                      <Flex align="center" gap="2" wrap="wrap">
                        {t("orderForm.source.orderDate")}
                        <NotImplemented list={ORDER_FORM_PENDING} id="orderDate" />
                      </Flex>
                    </Field.Label>
                    <DatePicker
                      value={orderDate}
                      onChange={setOrderDate}
                      withTime
                      clearable
                      max={todayDateInput()}
                      testId="draft-order-date"
                    />
                    <Field.HelperText>{t("orderForm.source.orderDateHelp")}</Field.HelperText>
                  </Field.Root>
                </SimpleGrid>
              </Card.Body>
            </Card.Root>

            <DraftRowsCard
              teamId={cardTeamId}
              warehouseId={warehouseId}
              rows={namedRows}
              stock={stock}
              costs={costs}
              onPatch={(key, patch) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))}
              onRemove={(key) => setRows((prev) => prev.filter((r) => r.key !== key))}
              onAdd={() => {
                setRows((prev) => [...prev, emptyRow(`new-${added + 1}`)]);
                setAdded((n) => n + 1);
              }}
            />

            <ReturnMappingCard
              teamId={cardTeamId}
              lines={crossLines}
              mapping={mapping}
              onMap={(productId, mapped) =>
                setMapping((prev) => {
                  const next = new Map(prev);
                  if (mapped) next.set(productId.toString(), mapped);
                  else next.delete(productId.toString());
                  return next;
                })
              }
            />

            <CustomerInfoForm
              idPrefix="draft"
              customerName={customerName}
              onCustomerNameChange={setCustomerName}
              customerPhone={customerPhone}
              onCustomerPhoneChange={setCustomerPhone}
              address={address}
              onAddressChange={setAddress}
              teamId={cardTeamId}
              addressKecamatanSearch
            />

            <ExtraInfoCard
              deadline={deadline}
              onDeadlineChange={setDeadline}
              buyerUsername={buyerUsername}
              onBuyerUsernameChange={setBuyerUsername}
            />
          </Stack>
        </GridItem>

        {/* THE MONEY — the create form's rail, and it sticks. */}
        <GridItem position={{ base: "static", lg: "sticky" }} top="4" minW="0">
          <Stack gap={compact ? "card" : "section"}>
            <Flex justify="space-between" align="center" gap="2">
              <Text fontSize="sm" fontWeight="bold" color="fg.muted">
                {t("orderForm.rail.title")}
              </Text>
              <Button type="button" size="xs" variant="outline" onClick={() => setCompact((on) => !on)}>
                <Icon as={compact ? ChevronsUpDown : ChevronsDownUp} boxSize="4" />
                {t(compact ? "orderForm.rail.expand" : "orderForm.rail.collapse")}
              </Button>
            </Flex>

            <CreditLimitPanel rows={credit} compact={compact} />
            <ProfitEstimatePanel sellPrice={sellPrice} orderTotal={orderTotal} compact={compact} />
            <TotalsInvoicePanel
              productsTotal={productsTotal}
              warehouseFee={warehouseFee}
              orderTotal={orderTotal}
              invoice={invoice}
              invoiceTotal={invoiceTotal}
              compact={compact}
            />

            <NoteAndSubmitCard
              note={note}
              onNoteChange={setNote}
              noteMark={<NotImplemented list={ORDER_DRAFT_PENDING} id="draftKeeps" />}
              unmappedReturns={unmappedReturns}
              compact={compact}
              saving={promoting}
              savingDraft={saving}
              canSave={canPromote}
              canDraft={changed}
              onSaveDraft={() => void save()}
              variant={{
                saveLabel: t("orderDrafts.save"),
                saveTestId: "draft-save",
                submitLabel: t("orderDrafts.promote"),
                submitTestId: "draft-promote",
                onSubmit: tryPromote,
              }}
              footer={
                reasons.length > 0 ? (
                  <Stack gap="1" data-testid="draft-gaps">
                    {reasons.map((reason) => (
                      <Flex key={reason} gap="2" align="start">
                        <Icon as={TriangleAlert} boxSize="3.5" color="warning.fg" mt="0.5" />
                        <Text fontSize="xs" color="warning.fg">
                          {reason}
                        </Text>
                      </Flex>
                    ))}
                  </Stack>
                ) : undefined
              }
            />
          </Stack>
        </GridItem>
      </Grid>

      <OrderChecksDialog
        findings={gate}
        placing={promoting}
        onClose={() => setGate([])}
        onPlaceAnyway={() => void doPromote()}
      />

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
