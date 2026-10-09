import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, Lock, PackagePlus } from "lucide-react";

import { productClient, rpcError } from "../../api/clients";
import { productByIdsRowData, productsFromByIds } from "../../features/products/adapt";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useRestockRequest, useSaveRestockRequest } from "../../features/restock/queries";
import { useLineSuppliers } from "../../features/restock/LineSupplier";
import { toRupiah } from "../../features/restock/counting";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { OwnProductPicker } from "../../components/products/OwnProductPicker";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { ReceiptUpload, type ReceiptValue, emptyReceipt } from "../../components/orders/ReceiptUpload";
import { toaster } from "../../components/feedback/Toaster";
import { type FormMode, type LineDraft, lineFromItem, lineFromPicked, missingParts, modeFor, toQty } from "./draft";
import { RESTOCK_FORM_PENDING } from "./pending";
import { LineCard } from "./components/LineCard";
import { SummaryCard } from "./components/SummaryCard";

// The same defensive parse the detail page makes: a route param is a string from the URL bar, so a non-numeric one is
// a legitimate thing to land on, not a crash. 0n means "not a usable id".
function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// `receipt_file` is ONE string — the uploaded document's key. The upload control speaks a { id, filename, type }
// triple, so a stored key is shown under its last path segment and guessed as a photo unless it ends in .pdf.
function receiptFrom(file: string): ReceiptValue {
  if (!file) return emptyReceipt;

  const filename = file.split("/").pop() || file;

  return { documentId: file, filename, mimeType: filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg" };
}

// A field closed while the box is at the door, and why — said next to it, once per card.
function LockedNote({ testId }: { testId: string }) {
  const { t } = useTranslation();

  return (
    <HStack gap="1" color="fg.muted" data-testid={testId}>
      <Icon as={Lock} boxSize="3.5" />
      <Text fontSize="xs">{t("restock.form.lockedArrived")}</Text>
    </HStack>
  );
}

function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <Flex align="center" gap="card" wrap="wrap">
      <Heading size="sm">{children}</Heading>
      <Spacer />
      {aside}
    </Flex>
  );
}

// RestockRequestFormPage — the SELLING team raises a restock, or changes one (docs/business/inventory/restock_decision.md).
//
// One form for create and edit, because the update RPC is a full replace whose fields mirror create's. The mode comes
// from the ROUTE, and in edit from the restock's STATUS:
//
//   /inventories/restock/new        → create  → RestockRequestCreate → the list
//   /inventories/restock/:id/edit   → ongoing → every field          → RestockRequestUpdate → the detail
//                                   → arrived → the lines only: count, total, note; a product may be ADDED (with a
//                                               note), none REMOVED; the payment and parcel are closed
//                                               (the-lines-stay-editable-until-accepted,
//                                               lines-can-be-added-not-removed-while-arrived)
//                                   → anything else, or another team's restock → "cannot be edited"
//
//   LEFT (2/3)                                   RIGHT (1/3)
//   ┌ Products — one card per line ───────┐      ┌ Warehouse ┐
//   │  count · TOTAL · per piece          │      ├ Summary — goods + shipping = total (never the courier's
//   │  bought from (Connect Supplier …)   │      │           charge: the-couriers-charge-stays-out-of-total)
//   │  line note                          │      ├ Save, and what is still missing
//   └─────────────────────────────────────┘      └───────────┘
//   ┌ Payment and Parcel ┐ ┌ Restock Note ┐
//
// The restock's supplier is GONE — where goods were bought is a fact of each LINE
// (a-line-names-the-channel-it-was-bought-from), connected from a popup that searches every team's suppliers.
export function RestockRequestFormPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const saveMutation = useSaveRestockRequest();
  const { requestId } = useParams<{ requestId: string }>();

  const isEdit = requestId !== undefined;
  const id = parseRequestId(requestId);
  const teamId = current?.teamId;

  const backTo = isEdit ? `/inventories/restock/${id}` : "/inventories/restock";

  // ── The draft ────────────────────────────────────────────────────────────────────────────────
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [lines, setLines] = useState<LineDraft[]>([]);
  // REQUIRED (a-restock-names-its-paying-account) — the operational account that paid.
  const [financeAccountId, setFinanceAccountId] = useState<bigint>(0n);
  // The store's invoice or order number, one per restock (a-restock-has-one-invoice).
  const [invoiceRef, setInvoiceRef] = useState("");
  // The parcel (the-receipt-is-the-tracking-number): the courier, the resi, a photo of the label.
  const [shipmentId, setShipmentId] = useState<bigint>(0n);
  const [receipt, setReceipt] = useState("");
  const [receiptFile, setReceiptFile] = useState<ReceiptValue>(emptyReceipt);
  const [shippingCost, setShippingCost] = useState("");
  // The selling team's note on the whole restock (three-notes-one-writer-each).
  const [note, setNote] = useState("");

  const [error, setError] = useState("");

  // ── Edit: the stored restock, read once into the draft ──────────────────────────────────────
  const detail = useRestockRequest({ teamId: isEdit ? teamId : undefined, requestId: id });
  const [loaded, setLoaded] = useState<RestockRequest | null>(null);
  // Which restock the draft was seeded from. The query refetches (always fresh, HARD RULE 10) — a refetch must never
  // overwrite what somebody is halfway through typing, so the draft is seeded ONCE per restock and team.
  const seededFor = useRef("");

  useEffect(() => {
    const request = detail.data;
    if (!isEdit || !request || teamId === undefined) return;

    const key = `${teamId}:${request.id}`;
    if (seededFor.current === key) return;
    seededFor.current = key;

    setLoaded(request);
    setWarehouseId(request.warehouseId);
    setLines(request.items.map(lineFromItem));
    setFinanceAccountId(request.financeAccountId);
    setInvoiceRef(request.invoiceRefId);
    setShipmentId(request.shipmentId);
    setReceipt(request.receipt);
    setReceiptFile(receiptFrom(request.receiptFile));
    setShippingCost(String(request.shipmentCost));
    setNote(request.note);

    // The covers, in ONE call for every line — decoration, so best-effort and patched in by product id, never over
    // anything typed.
    const productIds = [...new Set(request.items.map((i) => i.productId).filter((pid) => pid > 0n))];
    if (productIds.length === 0) return;

    void (async () => {
      try {
        const found = await productClient.productByIds({
          teamId,
          filter: { ids: productIds },
          dataRequest: productByIdsRowData(),
        });
        const covers = new Map(
          productsFromByIds(found).map((p) => [
            p.id.toString(),
            { imageUrl: p.defaultImageUrl, thumbnailUrl: p.defaultImageThumbnailUrl },
          ]),
        );

        setLines((prev) =>
          prev.map((l) => {
            const cover = covers.get(l.productId.toString());

            return cover ? { ...l, ...cover } : l;
          }),
        );
      } catch {
        // A cover is decoration; the placeholder is a correct rendering of "no picture".
      }
    })();
  }, [isEdit, teamId, detail.data]);

  const mode: FormMode | null = !isEdit ? "create" : loaded && teamId !== undefined ? modeFor(loaded, teamId) : null;
  const headerLocked = mode === "arrived";

  // Every line's supplier and store, in two by-id reads.
  const lineSuppliers = useLineSuppliers(teamId, lines);

  // ── Lines ────────────────────────────────────────────────────────────────────────────────────
  function patchLine(productId: bigint, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  // The picker hands back the WHOLE ticked set, so this RECONCILES: a still-ticked product keeps its line and what was
  // typed into it, a new one is appended — and a product can never be on two lines (a-product-appears-once-per-restock),
  // because a tick is per product.
  //
  // While ARRIVED a stored line is never dropped, even when unticked (lines-can-be-added-not-removed-while-arrived): what
  // was ordered and is not in the box is written as missing at accept, and removing it would erase the shortfall.
  function pickProducts(products: PickedProduct[]) {
    const ticked = new Set(products.map((p) => p.id.toString()));
    let blocked = false;

    const kept = lines.filter((l) => {
      if (ticked.has(l.productId.toString())) return true;
      if (mode === "arrived" && l.stored) {
        blocked = true;
        return true;
      }
      return false;
    });
    const known = new Set(kept.map((l) => l.productId.toString()));
    const added = products.filter((p) => !known.has(p.id.toString())).map(lineFromPicked);

    setLines([...kept, ...added]);

    if (blocked) {
      toaster.create({ type: "info", title: t("restock.form.cannotRemoveArrived") });
    }
  }

  function removeLine(productId: bigint) {
    setLines((prev) => prev.filter((l) => !(l.productId === productId && !(mode === "arrived" && l.stored))));
  }

  const pickedIds = useMemo(() => lines.map((l) => l.productId), [lines]);

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────
  const missing = mode ? missingParts({ mode, warehouseId, financeAccountId, lines }) : [];
  const canSave = mode !== null && mode !== "closed" && missing.length === 0;

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave) return;

    setError("");

    // While ARRIVED the payment and parcel are closed, so they are sent back EXACTLY as stored — a trimmed note or a
    // re-parsed cost would read to the server as a change, and it refuses any.
    const header =
      headerLocked && loaded
        ? {
            warehouseId: loaded.warehouseId,
            receipt: loaded.receipt,
            receiptFile: loaded.receiptFile,
            shipmentId: loaded.shipmentId,
            invoiceRefId: loaded.invoiceRefId,
            financeAccountId: loaded.financeAccountId,
            shipmentCost: loaded.shipmentCost,
            note: loaded.note,
          }
        : {
            warehouseId,
            receipt: receipt.trim(),
            receiptFile: receiptFile.documentId,
            shipmentId,
            invoiceRefId: invoiceRef.trim(),
            financeAccountId,
            shipmentCost: toRupiah(shippingCost),
            note: note.trim(),
          };

    const fields = {
      teamId,
      ...header,
      items: lines.map((l) => ({
        id: l.itemId,
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        count: BigInt(toQty(l.count)),
        total: toRupiah(l.total),
        supplierId: l.supplierId,
        supplierChannelId: l.supplierChannelId,
        note: l.note.trim(),
      })),
    };

    try {
      await saveMutation.mutateAsync(isEdit ? { requestId: id, fields } : { fields });

      toaster.create({
        type: "success",
        title: isEdit ? t("restock.form.toastUpdated") : t("restock.form.toastCreated"),
      });

      void navigate(backTo);
    } catch (err) {
      setError(rpcError(err));
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────────────────────
  const title = isEdit ? t("restock.form.editTitle") : t("restock.form.newTitle");

  const header = (
    <Flex align="center" gap="card">
      <IconButton
        size="xs"
        variant="ghost"
        aria-label={t("restock.form.back")}
        data-testid={isEdit ? "restock-edit-back" : "restock-create-back"}
        onClick={() => navigate(backTo)}
      >
        <Icon as={ArrowLeft} boxSize="4" />
      </IconButton>
      <Heading size="md">{title}</Heading>
      {loaded && <RestockStatusBadge status={loaded.status} />}
    </Flex>
  );

  if (!current || teamId === undefined) {
    return (
      <Stack gap="section">
        <Heading size="md">{title}</Heading>
        <Text color="fg.muted" data-testid="restock-create-no-team">
          {isEdit ? t("restock.form.selectTeamEdit") : t("restock.form.selectTeamCreate")}
        </Text>
      </Stack>
    );
  }

  if (isEdit && mode === null) {
    // Nothing to edit until the restock is in hand; and if it cannot be read, there is no form — an empty one would
    // offer to REPLACE the restock with blanks.
    const loadError =
      id === 0n
        ? t("restock.form.invalidId")
        : detail.isError
          ? rpcError(detail.error)
          : detail.isSuccess && detail.data === null
            ? t("restock.form.notFound")
            : "";

    if (!loadError) {
      return <Spinner colorPalette="brand" />;
    }

    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="restock-edit-back"
          onClick={() => navigate("/inventories/restock")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("restock.form.backToList")}
        </Button>
        <Text color="error.fg" data-testid="restock-edit-load-error">
          {loadError}
        </Text>
      </Stack>
    );
  }

  if (mode === "closed" && loaded) {
    // Accepted, lost or cancelled — or another team's restock. The status says which, and the way back is the detail.
    const ours = loaded.requestingTeamId === teamId;

    return (
      <Stack gap="section" maxW="3xl" data-testid="restock-not-editable">
        {header}
        <Card.Root>
          <Card.Body>
            <Stack gap="card" align="start">
              <HStack gap="2" color="fg.muted">
                <Icon as={Lock} boxSize="4" />
                <Text data-testid="restock-not-editable-reason">
                  {ours ? t("restock.form.notEditable") : t("restock.form.notEditableOwner")}
                </Text>
              </HStack>
              <Button variant="outline" data-testid="restock-not-editable-back" onClick={() => navigate(backTo)}>
                <Icon as={ArrowLeft} boxSize="4" />
                {t("restock.form.backToRestock")}
              </Button>
            </Stack>
          </Card.Body>
        </Card.Root>
      </Stack>
    );
  }

  const formMode = mode ?? "create";

  return (
    <Stack gap="section" maxW="7xl" data-testid={isEdit ? "restock-edit-page" : "restock-create-page"}>
      {header}

      <NotImplementedSummary list={RESTOCK_FORM_PENDING} />

      {headerLocked && (
        <Alert.Root status="info" data-testid="restock-arrived-banner">
          <Alert.Indicator />
          <Alert.Description>{t("restock.form.arrivedBanner")}</Alert.Description>
        </Alert.Root>
      )}

      {error && (
        <Text color="error.fg" data-testid="restock-create-error">
          {error}
        </Text>
      )}

      <form onSubmit={save} noValidate>
        <Flex direction={{ base: "column", lg: "row" }} align="start" gap="section">
          <Stack flex="2" minW="0" w="full" gap="section">
            {/* ─── The lines ─────────────────────────────────────────────────────────────────────── */}
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <CardTitle
                    aside={
                      <OwnProductPicker
                        teamId={teamId}
                        stockWarehouseId={warehouseId > 0n ? warehouseId : undefined}
                        value={pickedIds}
                        onChange={pickProducts}
                        trigger={
                          <Button type="button" size="xs" variant="outline" data-testid="restock-pick-products">
                            <Icon as={PackagePlus} boxSize="4" />
                            {t("restock.form.addProduct")}
                          </Button>
                        }
                      />
                    }
                  >
                    {t("restock.form.products")}
                  </CardTitle>

                  {headerLocked && (
                    <Text fontSize="xs" color="fg.muted" data-testid="restock-lines-locked-hint">
                      {t("restock.form.linesLockedHint")}
                    </Text>
                  )}

                  {lines.length === 0 && (
                    <Text fontSize="sm" color="fg.muted" data-testid="restock-no-products">
                      {t("restock.form.noProducts")}
                    </Text>
                  )}

                  <Stack gap="card">
                    {lines.map((line, i) => (
                      <LineCard
                        key={line.productId.toString()}
                        line={line}
                        index={i}
                        mode={formMode}
                        teamId={teamId}
                        suppliers={lineSuppliers.suppliers}
                        channels={lineSuppliers.channels}
                        onPatch={(patch) => patchLine(line.productId, patch)}
                        onRemove={() => removeLine(line.productId)}
                      />
                    ))}
                  </Stack>
                </Stack>
              </Card.Body>
            </Card.Root>

            <SimpleGrid columns={{ base: 1, md: 2 }} gap="section" alignItems="start">
              {/* ─── The payment and the parcel ──────────────────────────────────────────────────── */}
              <Card.Root>
                <Card.Body>
                  <Stack gap="card">
                    <CardTitle aside={headerLocked && <LockedNote testId="restock-header-locked" />}>
                      {t("restock.form.paymentAndParcel")}
                    </CardTitle>

                    <Field.Root required disabled={headerLocked}>
                      <Field.Label>
                        <HStack gap="1">
                          {t("restock.form.financeAccount")}
                          <Field.RequiredIndicator />
                          <NotImplemented list={RESTOCK_FORM_PENDING} id="financeAccount" />
                        </HStack>
                      </Field.Label>
                      <Box w="full">
                        <FinancialAccountSelect
                          teamId={teamId}
                          operationalOnly
                          // One operational account is the answer; asking would be ceremony. Only on create — an
                          // edit shows what the restock was raised with.
                          autoPickSingle={!isEdit}
                          value={financeAccountId}
                          onChange={setFinanceAccountId}
                          disabled={headerLocked}
                          testId="restock-finance-account"
                        />
                      </Box>
                      <Field.HelperText>{t("restock.form.financeAccountHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root disabled={headerLocked}>
                      <Field.Label>{t("restock.form.invoiceRef")}</Field.Label>
                      <Input
                        value={invoiceRef}
                        maxLength={100}
                        data-testid="restock-invoice-ref"
                        onChange={(e) => setInvoiceRef(e.target.value)}
                      />
                      <Field.HelperText>{t("restock.form.invoiceRefHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root disabled={headerLocked}>
                      <Field.Label>
                        <HStack gap="1">
                          {t("restock.form.courier")}
                          <NotImplemented list={RESTOCK_FORM_PENDING} id="shipment" />
                        </HStack>
                      </Field.Label>
                      <Box w="full" data-testid="restock-courier">
                        <ShipmentChannelSelect value={shipmentId} onChange={setShipmentId} disabled={headerLocked} />
                      </Box>
                      <Field.HelperText>{t("restock.form.courierHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root disabled={headerLocked}>
                      <Field.Label>{t("restock.form.trackingNumber")}</Field.Label>
                      <Input
                        value={receipt}
                        maxLength={100}
                        data-testid="restock-receipt"
                        onChange={(e) => setReceipt(e.target.value)}
                      />
                      <Field.HelperText>{t("restock.form.trackingNumberHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root disabled={headerLocked}>
                      <Field.Label>
                        <HStack gap="1">
                          {t("restock.form.labelPhoto")}
                          <NotImplemented list={RESTOCK_FORM_PENDING} id="receiptFile" />
                        </HStack>
                      </Field.Label>
                      <Box w="full" data-testid="restock-receipt-file">
                        <ReceiptUpload
                          teamId={teamId}
                          value={receiptFile}
                          onChange={setReceiptFile}
                          disabled={headerLocked}
                        />
                      </Box>
                    </Field.Root>

                    <Field.Root disabled={headerLocked}>
                      <Field.Label>{t("restock.form.shippingCost")}</Field.Label>
                      <CurrencyInput
                        value={shippingCost}
                        disabled={headerLocked}
                        data-testid="restock-shipping-cost"
                        onChange={setShippingCost}
                      />
                      <Field.HelperText>{t("restock.form.shippingCostHelp")}</Field.HelperText>
                    </Field.Root>
                  </Stack>
                </Card.Body>
              </Card.Root>

              {/* ─── The restock note ────────────────────────────────────────────────────────────── */}
              <Card.Root>
                <Card.Body>
                  <Stack gap="card">
                    <CardTitle aside={headerLocked && <LockedNote testId="restock-note-locked" />}>
                      {t("restock.form.restockNote")}
                    </CardTitle>

                    <Field.Root disabled={headerLocked}>
                      <Textarea
                        rows={8}
                        maxLength={1000}
                        value={note}
                        placeholder={t("restock.form.notePlaceholder")}
                        data-testid="restock-note"
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <Field.HelperText>{t("restock.form.noteHelp")}</Field.HelperText>
                    </Field.Root>
                  </Stack>
                </Card.Body>
              </Card.Root>
            </SimpleGrid>
          </Stack>

          {/* ─── The sidebar: the warehouse, the money, Save ─────────────────────────────────────── */}
          <Stack flex="1" minW="0" w="full" maxW={{ lg: "sm" }} gap="section">
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  {headerLocked && <LockedNote testId="restock-warehouse-locked" />}
                  <Field.Root required disabled={headerLocked}>
                    <Field.Label>
                      {t("restock.form.warehouse")}
                      <Field.RequiredIndicator />
                    </Field.Label>
                    <Box w="full" data-testid="restock-warehouse">
                      <TeamSelect
                        teamType={TeamType.WAREHOUSE}
                        value={warehouseId}
                        onChange={setWarehouseId}
                        disabled={headerLocked}
                      />
                    </Box>
                    <Field.HelperText>{t("restock.form.warehouseHelp")}</Field.HelperText>
                  </Field.Root>
                </Stack>
              </Card.Body>
            </Card.Root>

            <SummaryCard lines={lines} shippingCost={shippingCost} />

            <Button
              type="submit"
              colorPalette="brand"
              loading={saveMutation.isPending}
              disabled={!canSave}
              data-testid="submit-restock"
            >
              {isEdit ? t("restock.form.saveChanges") : t("restock.form.submit")}
            </Button>

            {/* A disabled button says nothing about WHY — so what is missing is listed under it. */}
            {missing.length > 0 && (
              <Stack gap="1" data-testid="restock-form-missing">
                <Text fontSize="xs" color="fg.muted">
                  {t("restock.form.missing.title")}
                </Text>
                {missing.map((m) => (
                  <Text key={m} fontSize="xs" color="fg.muted" data-testid={`restock-form-missing-${m}`}>
                    · {t(`restock.form.missing.${m}`)}
                  </Text>
                ))}
              </Stack>
            )}
          </Stack>
        </Flex>
      </form>
    </Stack>
  );
}
