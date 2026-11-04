import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Grid,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Separator,
  Spacer,
  Stack,
  Text,
  Textarea,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ArrowLeft, Lock, Package, PackagePlus, Plus, Save, X } from "lucide-react";

import { productClient, rpcError } from "../../api/clients";
import { productByIdsRowData, productsFromByIds } from "../../features/products/adapt";
import { usePresetProduct } from "../../features/products/presetProduct";
import { cameFrom } from "../../lib/cameFrom";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useRestockRequest, useSaveRestockRequest } from "../../features/restock/queries";
import { useLineSuppliers } from "../../features/restock/LineSupplier";
import { toRupiah } from "../../features/restock/counting";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { OwnProductPicker } from "../../components/products/OwnProductPicker";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import type { SupplierChannelPick } from "../../components/pickers/SupplierChannelPicker";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { ReceiptUpload, type ReceiptValue, emptyReceipt } from "../../components/orders/ReceiptUpload";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { ReadyLine } from "../../components/feedback/ReadyLine";
import { toaster } from "../../components/feedback/Toaster";
import {
  type FormMode,
  type LineDraft,
  lineFromItem,
  lineFromPicked,
  missingParts,
  modeFor,
  sharedSupplier,
  supplierOpen,
  toQty,
} from "./draft";
import { LineCard } from "./components/LineCard";
import { SummaryCard } from "./components/SummaryCard";
import { SupplierBox } from "./components/SupplierBox";

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

// The text fields' limits — the contract's `max_len` — each shown as a count under its field
// (a-limited-field-shows-its-count).
const MAX_ORDER_ID = 100;
const MAX_RECEIPT = 100;
const MAX_NOTE = 1000;

/** How much of a limited field is used — *5/100*, at the field's end. */
function Count({ value, max, testId }: { value: string; max: number; testId: string }) {
  return (
    <Field.HelperText alignSelf="end" data-testid={testId}>
      {value.length}/{max}
    </Field.HelperText>
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

// RestockFormPage — the SELLING team raises a restock, or changes one (docs/business/inventory/restock_decision.md).
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
//
// ON THE SCREEN RULES (owner: *"inisiasi di restock form ini"*, the-restock-form-follows-the-screen-rules): the store's
// reference is the Order ID; every typed field shows an example, and a limited one its count; Buat carries a plus and
// Simpan a disk; the lines are rows of the Produk card, not cards inside it; no lines is an EmptyHint with the picker;
// the warehouse is its name alone; the first load is the page's shape, and the page rises in.
export function RestockFormPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const saveMutation = useSaveRestockRequest();
  const { requestId } = useParams<{ requestId: string }>();

  const isEdit = requestId !== undefined;
  const id = parseRequestId(requestId);
  const teamId = current?.teamId;

  // OPENED FROM A PRODUCT'S PAGE (a-product-page-opens-the-order-and-restock-forms) — `?product=` starts a NEW restock
  // with that product as its first line, `&warehouse=` with that warehouse; Back and Save return to the page.
  const preset = usePresetProduct(isEdit ? undefined : teamId);
  const openedFrom = cameFrom(useLocation());
  const backTo = isEdit ? `/inventories/restock/${id}` : (openedFrom ?? "/inventories/restock");

  // ── The draft ────────────────────────────────────────────────────────────────────────────────
  const [warehouseId, setWarehouseId] = useState<bigint>(() => (isEdit ? 0n : preset.warehouseId));
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
  // THE SUPPLIER FOR ALL PRODUCTS (one-supplier-for-all-in-two-steps, the-supplier-leads-the-produk-card) — Pilih
  // Supplier, then a pick. Every open line follows it unless it picks its own. Never sent: each line saves its own.
  const [allSupplier, setAllSupplier] = useState<SupplierChannelPick | null>(null);

  const [error, setError] = useState("");

  // ── Create from a product's page: that product as the first line, once ───────────────────────
  const seededPreset = useRef("");
  useEffect(() => {
    if (isEdit || !preset.product || seededPreset.current === preset.productId.toString()) return;
    seededPreset.current = preset.productId.toString();
    setLines([{ ...lineFromPicked(preset.product), count: preset.quantity }]);
  }, [isEdit, preset.product, preset.productId, preset.quantity]);

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

    // Open lines that already share one supplier open WITH it as the supplier for all products, following it; lines
    // that differ keep their own, and the form opens without one.
    const seeded = request.items.map(lineFromItem);
    const seededMode = modeFor(request, teamId);
    const shared = sharedSupplier(seededMode, seeded);
    setAllSupplier(shared);
    setLines(shared ? seeded.map((l) => (supplierOpen(seededMode, l) ? { ...l, followsAll: true } : l)) : seeded);
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
  // How many columns the width holds — read on the first render (`ssr: false`), so a wide screen never paints one
  // column first and then jumps.
  const columns = useBreakpointValue({ base: "one", lg: "two", "2xl": "three" }, { ssr: false }) ?? "one";

  // Every line's supplier and store, in two by-id reads — the supplier for all products among them, which no line may
  // be following.
  const lineSuppliers = useLineSuppliers(teamId, allSupplier ? [...lines, allSupplier] : lines);

  // ── Lines ────────────────────────────────────────────────────────────────────────────────────
  function patchLine(productId: bigint, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  // ── The supplier for all products (one-supplier-for-all-in-two-steps) ────────────────────────────
  // Set the FIRST time, it is the same supplier on every open line — that is what it is for. Changed later, it
  // moves only the lines that follow it: a line that picked its own picked it on purpose.
  function setAll(pick: SupplierChannelPick) {
    const first = allSupplier === null;

    setAllSupplier(pick);
    setLines((prev) =>
      prev.map((l) =>
        supplierOpen(mode ?? "create", l) && (first || l.followsAll) ? { ...l, ...pick, followsAll: true } : l,
      ),
    );
  }

  // Cleared, the lines that followed it are connected to nothing again; a line with its own keeps it.
  function clearAll() {
    setAllSupplier(null);
    setLines((prev) =>
      prev.map((l) => (l.followsAll ? { ...l, supplierId: 0n, supplierChannelId: 0n, followsAll: false } : l)),
    );
  }

  function followAll(productId: bigint) {
    if (allSupplier) patchLine(productId, { ...allSupplier, followsAll: true });
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
    // A product added under a supplier for all products follows it.
    const added = products
      .filter((p) => !known.has(p.id.toString()))
      .map(lineFromPicked)
      .map((l) => (allSupplier ? { ...l, ...allSupplier, followsAll: true } : l));

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
  const missing = mode ? missingParts({ mode, warehouseId, financeAccountId, receipt, lines }) : [];
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
      // The first load shows the page's shape (motion-is-small-quick-and-shared).
      return <ListSkeleton heading rows={3} testId="restock-edit-loading" />;
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

  // The picker, with its trigger — the Produk card's action, and the empty hint's.
  const picker = (testId: string) => (
    <OwnProductPicker
      teamId={teamId}
      stockWarehouseId={warehouseId > 0n ? warehouseId : undefined}
      value={pickedIds}
      onChange={pickProducts}
      trigger={
        <Button type="button" size="xs" variant="outline" data-testid={testId}>
          <Icon as={PackagePlus} boxSize="4" />
          {t("restock.form.addProduct")}
        </Button>
      }
    />
  );

  // THE SUPPLIER LEADS THE CARD (owner: *"supplier jadikan semacam div sendiri, 1 section pilih produk dan supplier,
  // supplier di atas dan muncul dari awal"*, the-supplier-leads-the-produk-card) — on screen from the start, so an empty
  // card is the two things to choose rather than a hint in a lot of space. Two steps (one-supplier-for-all-in-two-steps):
  // Pilih Supplier opens the supplier popup, and every product follows the pick.
  //
  // ITS OWN TITLE AND A LINE THAT STAYS (owner: *"kasih judul sub judul tidak hilang keterangan pilih untuk semua atau
  // kustomisasi diproduk sendiri, opsional"*, the-card-is-supplier-then-produk) — the line says what the choice does
  // whether or not one is made; the choice itself sits in a field-like box, and a rule parts it from the products.
  //
  // Not while the box is at the door: the stored lines' suppliers are closed then, and an added line names its own.
  const supplierSection = formMode !== "arrived" && (
    <Stack gap="card" data-testid="restock-all-supplier">
      <Stack gap="0.5">
        <CardTitle>{t("restock.form.supplierTitle")}</CardTitle>
        <Text fontSize="xs" color="fg.muted" data-testid="restock-all-supplier-help">
          {t("restock.form.supplierHelp")}
        </Text>
      </Stack>

      {/* ONE HEIGHT, PICKED OR NOT (owner: *"buat tingginya sama ketika select dan tidak suppliernya"*,
          the-note-sits-over-buat-restok) — and the same box every product's *Dibeli dari* draws
          (a-product-picks-its-supplier-from-the-same-box). */}
      <SupplierBox
        teamId={teamId}
        value={allSupplier ?? { supplierId: 0n, supplierChannelId: 0n }}
        suppliers={lineSuppliers.suppliers}
        channels={lineSuppliers.channels}
        onPick={setAll}
        noneText={t("restock.form.allSupplierNone")}
        testId="restock-all-supplier"
        shownTestId={allSupplier ? "restock-all-supplier-shown" : "restock-all-supplier-none"}
        pickerTestId="restock-all-supplier-picker"
        changeTestId="restock-all-supplier-change"
        actions={
          allSupplier && (
            <IconButton
              type="button"
              size="xs"
              variant="ghost"
              aria-label={t("restock.form.clearAllSupplier")}
              data-testid="restock-all-supplier-clear"
              onClick={clearAll}
            >
              <Icon as={X} boxSize="4" />
            </IconButton>
          )
        }
      />
    </Stack>
  );

  // ── THE CARDS, built once and laid out by the width below ───────────────────────────────────────
  // ONE CARD, SUPPLIER THEN PRODUK (the-card-is-supplier-then-produk): the supplier's part, a rule, then the products'
  // part with Pilih Produk in its own title — under the supplier, not in the card's corner.
  const productsCard = (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          {supplierSection}
          {supplierSection && <Separator my="1" data-testid="restock-supplier-products-rule" />}

          <CardTitle aside={lines.length > 0 && picker("restock-pick-products")}>{t("restock.form.products")}</CardTitle>

          {headerLocked && (
            <Text fontSize="xs" color="fg.muted" data-testid="restock-lines-locked-hint">
              {t("restock.form.linesLockedHint")}
            </Text>
          )}

          {/* No lines yet: the hint, and the picker as its action (an-empty-list-shows-a-hint) — one way to add,
              where the eye already is, rather than a grey line under a button in the corner. */}
          {lines.length === 0 && (
            <EmptyHint
              icon={Package}
              title={t("restock.form.noProducts")}
              description={t("restock.form.noProductsHint")}
              action={picker("restock-pick-products")}
              testId="restock-no-products"
            />
          )}

          {/* THE LINES ARE ROWS OF THIS CARD, a rule between them — never a card inside a card (CLAUDE.md). */}
          <Stack gap="card" separator={<Separator />}>
            {lines.map((line, i) => (
              <LineCard
                key={line.productId.toString()}
                line={line}
                index={i}
                mode={formMode}
                teamId={teamId}
                suppliers={lineSuppliers.suppliers}
                channels={lineSuppliers.channels}
                hasAllSupplier={allSupplier !== null}
                onPatch={(patch) => patchLine(line.productId, patch)}
                onFollowAll={() => followAll(line.productId)}
                onRemove={() => removeLine(line.productId)}
              />
            ))}
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  );

  const paymentCard = (
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

          {/* THE ORDER ID (the-store-reference-is-the-order-id) — what the store calls it, as the list and the
              restock page do; "invoice" is not the word here. */}
          <Field.Root disabled={headerLocked}>
            <Field.Label>{t("restock.form.invoiceRef")}</Field.Label>
            <Input
              value={invoiceRef}
              maxLength={MAX_ORDER_ID}
              placeholder={t("restock.form.invoiceRefPlaceholder")}
              data-testid="restock-invoice-ref"
              onChange={(e) => setInvoiceRef(e.target.value)}
            />
            <Flex w="full" gap="card" justify="space-between" align="start">
              <Field.HelperText>{t("restock.form.invoiceRefHelp")}</Field.HelperText>
              <Count value={invoiceRef} max={MAX_ORDER_ID} testId="restock-invoice-ref-count" />
            </Flex>
          </Field.Root>

          <Field.Root disabled={headerLocked}>
            <Field.Label>
              <HStack gap="1">
                {t("restock.form.courier")}
              </HStack>
            </Field.Label>
            <Box w="full" data-testid="restock-courier">
              <ShipmentChannelSelect value={shipmentId} onChange={setShipmentId} disabled={headerLocked} />
            </Box>
            <Field.HelperText>{t("restock.form.courierHelp")}</Field.HelperText>
          </Field.Root>

          {/* REQUIRED on this form (the-checks-run-products-warehouse-account-resi) — the last thing it checks. */}
          <Field.Root required disabled={headerLocked}>
            <Field.Label>
              {t("restock.form.trackingNumber")}
              <Field.RequiredIndicator />
            </Field.Label>
            <Input
              value={receipt}
              maxLength={MAX_RECEIPT}
              placeholder={t("restock.form.trackingNumberPlaceholder")}
              data-testid="restock-receipt"
              onChange={(e) => setReceipt(e.target.value)}
            />
            <Flex w="full" gap="card" justify="space-between" align="start">
              <Field.HelperText>{t("restock.form.trackingNumberHelp")}</Field.HelperText>
              <Count value={receipt} max={MAX_RECEIPT} testId="restock-receipt-count" />
            </Flex>
          </Field.Root>

          <Field.Root disabled={headerLocked}>
            <Field.Label>
              <HStack gap="1">
                {t("restock.form.labelPhoto")}
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
  );

  // THE WAREHOUSE OVER THE PAYMENT (owner: *"gudang taruh di atas pembayaran dan paket"*,
  // the-note-sits-over-buat-restok) — where the goods go, then how they were paid and sent.
  const warehouseCard = (
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
              {/* Warehouses only, so the pick is the name alone (a-one-type-picker-shows-the-name-alone). */}
              <TeamSelect
                teamType={TeamType.WAREHOUSE}
                showType={false}
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
  );

  // THE NOTE OVER BUAT RESTOK (owner: *"catatan taruh di atas buat restok"*, the-note-sits-over-buat-restok) — the last
  // thing written before the restock is raised, so it sits in the money column between the total and the button. Four
  // rows, not eight: the column is sticky and must still fit a laptop's window.
  const noteCard = (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <CardTitle aside={headerLocked && <LockedNote testId="restock-note-locked" />}>
            {t("restock.form.restockNote")}
          </CardTitle>

          <Field.Root disabled={headerLocked}>
            <Textarea
              rows={4}
              maxLength={MAX_NOTE}
              value={note}
              placeholder={t("restock.form.notePlaceholder")}
              aria-label={t("restock.form.restockNote")}
              data-testid="restock-note"
              onChange={(e) => setNote(e.target.value)}
            />
            <Flex w="full" gap="card" justify="space-between" align="start">
              <Field.HelperText>{t("restock.form.noteHelp")}</Field.HelperText>
              <Count value={note} max={MAX_NOTE} testId="restock-note-count" />
            </Flex>
          </Field.Root>
        </Stack>
      </Card.Body>
    </Card.Root>
  );

  // THE MONEY AND SAVE, STICKY (owner: *"perincian sticky berarti"*) — the column beside the lines stays in view while
  // they scroll, so the total and Save are where the eye is after the last line. One column on a phone: nothing sticks.
  const moneyColumn = (
    // CAPPED AT THE WINDOW while it sticks — with the note in it the column outgrew a laptop's window, hiding Buat
    // Restok under the fold. The cap makes the summary's line list give way instead; the note and the button never do.
    <Stack
      gap="section"
      minW="0"
      position={columns === "one" ? undefined : "sticky"}
      top="page"
      maxH={columns === "one" ? undefined : "calc(100dvh - var(--chakra-spacing-page) * 2)"}
      css={{ "& > *:not([data-testid='restock-summary'])": { flexShrink: 0 } }}
      data-testid="restock-form-money"
    >
      <SummaryCard lines={lines} shippingCost={shippingCost} />

      {noteCard}

      <Stack gap="2">
        {/* READY, OR THE ONE THING IT WAITS FOR — one line over the button (owner: *"catatan di bawah buat tidak butuh,
            atau buat lebih bagus sebelum buat restok, tapi jangan makan tempat"*, then *"aku ingin info 1 aja ditampilkan
            yang belum saja, kalau sudah semua berarti ada tanda siap, masih bisa didetailkan"*,
            a-save-button-says-what-it-waits-for). */}
        <ReadyLine
          missing={missing.map((m) => ({ id: m, label: t(`restock.form.missing.${m}`) }))}
          readyLabel={isEdit ? t("readyLine.readySave") : t("readyLine.readyCreate")}
          testId="restock-form"
        />

        <Button
          type="submit"
          colorPalette="brand"
          loading={saveMutation.isPending}
          disabled={!canSave}
          data-testid="submit-restock"
        >
          {/* Buat with a plus, Simpan with a disk (an-action-button-carries-its-icon), as the product form's. */}
          <Icon as={isEdit ? Save : Plus} boxSize="4" data-testid={isEdit ? "submit-restock-save-icon" : "submit-restock-create-icon"} />
          {isEdit ? t("restock.form.saveChanges") : t("restock.form.submit")}
        </Button>
      </Stack>
    </Stack>
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared). It fills the canvas, as the
    // product form does (owner: *"halaman tidak penuh"*).
    <Stack gap="section" animationStyle="enter" data-testid={isEdit ? "restock-edit-page" : "restock-create-page"}>
      {header}

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

      {/* THREE COLUMNS FROM 2xl (owner: *"3 kotak buat memenuhi halaman 2xl"*) — the lines, the warehouse over the
          payment, the money with the note over Buat Restok (the-note-sits-over-buat-restok):

            2xl   [ Produk 2fr ] [ Gudang · Pembayaran 1fr ] [ Rincian · Catatan · Buat 22rem, sticky ]
            lg    [ Produk · Gudang · Pembayaran          ] [ Rincian · Catatan · Buat 22rem, sticky ]
            below Produk · Gudang · Pembayaran · Rincian · Catatan · Buat   — one column

          A JS breakpoint, so no card exists twice. */}
      <form onSubmit={save} noValidate>
        {columns === "three" ? (
          <Grid templateColumns="minmax(0, 2fr) minmax(0, 1fr) 22rem" gap="section" alignItems="start" data-testid="restock-form-columns" data-columns="3">
            {productsCard}
            <Stack gap="section" minW="0">
              {warehouseCard}
              {paymentCard}
            </Stack>
            {moneyColumn}
          </Grid>
        ) : columns === "two" ? (
          <Grid templateColumns="minmax(0, 1fr) 22rem" gap="section" alignItems="start" data-testid="restock-form-columns" data-columns="2">
            <Stack gap="section" minW="0">
              {productsCard}
              {warehouseCard}
              {paymentCard}
            </Stack>
            {moneyColumn}
          </Grid>
        ) : (
          <Stack gap="section" data-testid="restock-form-columns" data-columns="1">
            {productsCard}
            {warehouseCard}
            {paymentCard}
            {moneyColumn}
          </Stack>
        )}
      </form>
    </Stack>
  );
}
