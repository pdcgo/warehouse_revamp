import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Field,
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
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, PackagePlus, Trash2 } from "lucide-react";
import { restockClient, rpcError } from "../api/clients";
import { RestockPaymentType } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { useInvalidateRestock } from "./queries";
import { TeamSelect } from "../components/TeamSelect";
import { ProductPicker } from "../components/ProductPicker";
import type { PickedProduct } from "../components/ProductSelect";
import { ProductListItem } from "../components/ProductListItem";
import { CurrencyInput } from "../components/CurrencyInput";
import { SupplierSelect } from "../components/SupplierSelect";
import { PaymentTypeSelect } from "../components/PaymentTypeSelect";
import { ShippingSelect } from "../shipping/ShippingSelect";
import { formatRupiah } from "../lib/money";
import { toaster } from "../components/Toaster";

// One editable restock line. product id/sku/name come from the picker (a snapshot — the product may
// live in another team's catalogue); quantity and the line's TOTAL supplier price are typed (#140). The
// numeric fields are kept as strings while editing (an empty input is not 0) and parsed on submit.
interface LineDraft {
  // THE IDENTITY of a line, not merely one of its fields (#165). The picker cannot tick the same
  // product twice, so a product appears on at most one line — which is why there is no synthetic key
  // here any more. There used to be one because a line could exist with nothing picked yet, and 0
  // identifies nothing; the picker removed that state.
  productId: bigint;
  sku: string;
  name: string;
  quantity: string;
  totalPrice: string;
}

// Whole rupiah only: parse an input string to a non-negative int64, treating blank/invalid as 0.
// A price of 0 is LEGITIMATE here (a transfer, a sample, collected in person), so it is never a
// validity gate — neither for a line's price nor for the shipping cost.
function toRupiah(raw: string): bigint {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.trunc(n));
}

function toQty(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 0;
  return n;
}

// The line total is TYPED now (#140), not computed from a per-unit price. People buying stock read a
// total off an invoice — "that box of 12 cost 240.000" — and making them divide by 12 first only
// invites a rounded number whose product no longer equals what they paid.
function lineTotal(line: LineDraft): bigint {
  return toRupiah(line.totalPrice);
}

// The same defensive parse the detail page makes: a route param is a string from the URL bar, so a
// non-numeric one is a legitimate thing to land on, not a crash. 0n means "not a usable id".
function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// RestockRequestFormPage is the selling-side "ask a warehouse to restock" form (#105, #124, #127). It
// is a dedicated PAGE, not a modal: the warehouse and product pickers render their listboxes through a
// Portal, which is inert inside a modal Dialog — a page sidesteps that entirely (same reason
// OrderCreatePage is a page), and it carries a dynamic list of lines besides.
//
// It serves BOTH create and edit (#131), because the edit screen IS this form re-opened on an existing
// row — the update RPC is a full REPLACE whose fields mirror create's one-for-one, so a second form
// would be the same 500 lines drifting apart. The mode comes from the ROUTE, not a prop:
//
//   /inventories/restock/new         → no :requestId  → create → RestockRequestCreate → back to the list
//   /inventories/restock/:id/edit    → :requestId     → edit   → RestockRequestUpdate → back to the detail
//
// Only a PENDING request is editable — once the warehouse has accepted it the goods have moved, and the
// server refuses with FailedPrecondition. The detail page is what gates the way in here (it only offers
// Edit while pending); this page does not re-check, so a hand-typed URL onto a fulfilled request loads
// the form and is refused on submit. That is the server's answer to state that changed under us anyway.
//
// #127 laid it out as a two-column "cart" screen, which is what the sections below are named after:
//
//   LEFT (2/3)                          RIGHT (1/3, the sidebar)
//   ┌───────────────────────────┐       ┌──────────────┐
//   │ A — picked products       │       │ D — warehouse│
//   └───────────────────────────┘       ├──────────────┤
//   ┌─────────────┬─────────────┐       │ E — products │
//   │ B — order   │ C — note    │       ├──────────────┤
//   └─────────────┴─────────────┘       │ F — shipping │
//                                       ├──────────────┤
//                                       │ G — total    │
//                                       └──────────────┘
//
// Money is computed here for DISPLAY only — the backend stores what it is sent. The grand total is
// the products' total (Σ line totals) plus the freight, which is the one number the person
// filling this in is actually agreeing to pay.
export function RestockRequestFormPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const invalidateRestock = useInvalidateRestock();
  const { requestId } = useParams<{ requestId: string }>();

  // The route param IS the mode: present ⇒ editing that row, absent ⇒ creating a new one.
  const isEdit = requestId !== undefined;
  const id = parseRequestId(requestId);

  const teamId = current?.teamId;

  // Where both the back button and a successful submit go. Editing came FROM the detail page, so it
  // returns there; creating has no row to return to, so it lands on the list.
  const backTo = isEdit ? `/inventories/restock/${id}` : "/inventories/restock";

  const lineFor = (p: PickedProduct): LineDraft => ({
    productId: p.id,
    sku: p.sku,
    name: p.name,
    quantity: "1",
    totalPrice: "0",
  });

  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [shippingCode, setShippingCode] = useState("");
  // EVERY line holds a product (#165). Since the picker is the only way in, there is no such thing as
  // a half-filled line any more, and the list starts genuinely empty rather than at one blank row.
  const [lines, setLines] = useState<LineDraft[]>([]);

  // The optional context (#124, #127). Each has a documented "none" value in the contract —
  // orderRef "", receipt "", supplierId 0, shippingCost 0, paymentType UNSPECIFIED, note "" — so an
  // untouched field simply sends its zero and none of them gates the submit button.
  const [orderRef, setOrderRef] = useState("");
  const [receipt, setReceipt] = useState("");
  const [supplierId, setSupplierId] = useState<bigint>(0n);
  const [shippingCost, setShippingCost] = useState("");
  const [paymentType, setPaymentType] = useState<RestockPaymentType>(RestockPaymentType.UNSPECIFIED);
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Two DIFFERENT failures, so two states. `error` is a rejected SUBMIT — the form stays on screen with
  // everything typed into it. `loadError` is edit mode failing to read the row at all: there is nothing
  // to edit, so the form must not render blank fields that a submit would then WRITE as cleared.
  const [loading, setLoading] = useState(isEdit);
  // Either an i18n KEY (ours) or a literal message (the server's, already translated by rpcError).
  // Holding the key rather than the translated string is what lets the load effect below avoid
  // depending on `t` — and as a bonus an error already on screen re-translates on a language switch.
  const [loadError, setLoadError] = useState<{ key?: string; text?: string } | null>(null);

  // Edit mode prefills from the row. Every field is set — the update RPC is a full replace, so a field
  // this effect forgot would silently be submitted as cleared.
  useEffect(() => {
    if (!isEdit || teamId === undefined) return;

    if (id === 0n) {
      setLoadError({ key: "restock.detail.invalidId" });
      setLoading(false);
      return;
    }

    // The effect refires on team/id, so two loads can be in flight and land out of order. `ignore`
    // retires the older one: without it a stale response overwrites what the newer one just prefilled.
    let ignore = false;

    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const res = await restockClient.restockRequestDetail({ teamId, requestId: id });
        if (ignore) return;

        const request = res.request;
        if (!request) {
          setLoadError({ key: "restock.detail.notFound" });
          return;
        }

        setWarehouseId(request.warehouseId);
        setShippingCode(request.shippingCode);
        // Quantity and price go back to STRINGS: they are typed fields, and a bigint here would make
        // clearing the input impossible. A row that somehow has no items loads as an empty list, and
        // the picker below is how it gets some — there is no blank line to fall back to now (#165).
        setLines(
          request.items.map((item) => ({
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            quantity: String(item.quantity),
            totalPrice: String(item.totalPrice),
          })),
        );
        setReceipt(request.receipt);
        setSupplierId(request.supplierId);
        setOrderRef(request.orderRef);
        setShippingCost(String(request.shippingCost));
        setPaymentType(request.paymentType);
        setNote(request.note);
      } catch (err) {
        if (!ignore) setLoadError({ text: rpcError(err) });
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
    // `t` is deliberately NOT a dependency, which is why the error states above are KEYS. react-i18next
    // hands back a new `t` IDENTITY on every language change, so depending on it would refire this whole
    // load when someone switches language mid-edit — refetching the row and overwriting every unsaved
    // change on screen with the stored values. Nothing warns them; the work is simply gone. Storing keys
    // means the effect never calls `t`, so it has no reason to re-run.
    //
  }, [isEdit, teamId, id]);

  function patchLine(productId: bigint, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  // The picker hands back the WHOLE ticked set, so this RECONCILES — it does not append (#165).
  //
  // A product that is still ticked keeps the line it already had, with the quantity and price typed
  // into it. Rebuilding the list from the picked set would be shorter to write and would silently
  // reset every number on screen the next time somebody opened the picker to add one more product.
  // Kept lines hold their on-screen ORDER too: rows jumping around after a dialog closes is its own
  // small betrayal of somebody who was halfway through typing.
  function pickProducts(products: PickedProduct[]) {
    setLines((prev) => {
      const ticked = new Set(products.map((p) => p.id.toString()));
      const kept = prev.filter((l) => ticked.has(l.productId.toString()));

      const known = new Set(kept.map((l) => l.productId.toString()));
      const added = products.filter((p) => !known.has(p.id.toString())).map(lineFor);

      return [...kept, ...added];
    });
  }

  // Dropping ONE product without opening the dialog. Unticking it in the picker does the same thing —
  // they are the same edit, because the picker's ticks are derived from these lines rather than held
  // separately. The last line IS removable now: an empty list is a legitimate half-filled form (the
  // Save button is what refuses it), where before there was always a blank line that could not be got
  // rid of.
  function removeLine(productId: bigint) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  // What the picker shows as ticked. Derived from the lines, never stored beside them — two copies of
  // "which products are on this request" is how a tick and a row start disagreeing.
  const pickedIds = useMemo(() => lines.map((l) => l.productId), [lines]);

  // E — the products' money: Σ (line totals), in whole rupiah (#140).
  const productsTotal = useMemo(() => lines.reduce((sum, l) => sum + lineTotal(l), 0n), [lines]);

  // F — the freight as typed. Parsed every render so E/F/G track the input live.
  const shippingCostValue = toRupiah(shippingCost);

  // G — what this restock costs in full.
  const grandTotal = productsTotal + shippingCostValue;

  // Every line carries a product by construction now, so the only thing left to be wrong is the
  // quantity. The productId check stays anyway: it costs nothing and it is the assertion that would
  // catch a future path putting a line here some way other than the picker.
  const linesValid = lines.every((l) => l.productId > 0n && toQty(l.quantity) >= 1);
  const canSave = warehouseId > 0n && lines.length >= 1 && linesValid;

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave) {
      return;
    }

    setSaving(true);
    setError("");

    // Create and update take the SAME fields — update only adds the request_id naming the row to
    // replace — so the payload is built once and the mode picks the RPC.
    const fields = {
      teamId,
      warehouseId,
      shippingCode,
      items: lines.map((l) => ({
        id: 0n,
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        quantity: BigInt(toQty(l.quantity)),
        totalPrice: toRupiah(l.totalPrice),
      })),
      receipt: receipt.trim(),
      supplierId,
      orderRef: orderRef.trim(),
      shippingCost: shippingCostValue,
      paymentType,
      note: note.trim(),
    };

    try {
      if (isEdit) {
        await restockClient.restockRequestUpdate({ ...fields, requestId: id });
        toaster.create({ type: "success", title: t("restock.toast.updated") });
      } else {
        await restockClient.restockRequestCreate(fields);
        toaster.create({ type: "success", title: t("restock.toast.created") });
      }

      // Invalidate before leaving (#176): this page writes and navigates away, so the list and the
      // detail it returns to have no way to hear about the change otherwise.
      await invalidateRestock();

      // Editing returns to the row it changed so the result is right there; creating has no row yet.
      void navigate(backTo);
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  const title = isEdit ? t("restock.editRequestTitle") : t("restock.newRequestTitle");

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{title}</Heading>
        {/* Mode-aware, like the heading above it: a request is loaded and saved in a team's scope, so
            with none chosen there is nothing to edit either — but telling someone who came to EDIT to
            "select a team to create a request" describes a task they are not doing. */}
        <Text color="fg.muted" data-testid="restock-create-no-team">
          {isEdit ? t("restock.selectTeamEdit") : t("restock.selectTeamCreate")}
        </Text>
      </Stack>
    );
  }

  // Edit mode has nothing to show until the row is in hand — the same spinner the detail page shows.
  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  // The row could not be read, so there is no form: an empty one here would offer to REPLACE the
  // request with blanks. The way back is the only thing on offer — and it goes to the LIST, not to
  // `backTo`: whatever stopped this row loading (bad id, not found, not ours) stops its detail page too.
  if (loadError) {
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
          {t("restock.detail.back")}
        </Button>
        <Text color="red.fg" data-testid="restock-edit-load-error">
          {loadError.key ? t(loadError.key) : loadError.text}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack
      gap="section"
      maxW="7xl"
      data-testid={isEdit ? "restock-edit-page" : "restock-create-page"}
    >
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("restock.back")}
          data-testid={isEdit ? "restock-edit-back" : "restock-create-back"}
          onClick={() => navigate(backTo)}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{title}</Heading>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="restock-create-error">
          {error}
        </Text>
      )}

      <form onSubmit={save} noValidate>
        {/* The two columns collapse to one below `lg`: on a narrow screen the sidebar's summary
            reads as the tail of the form, which is the right order to fill it in anyway. */}
        <Flex direction={{ base: "column", lg: "row" }} align="start" gap="section">
          <Stack flex="2" minW="0" w="full" gap="section">
            {/* ─── A — the picked products ─────────────────────────────────────────────────── */}
            {/* No count and no total here (#165, owner): the sidebar already carries both, and the
                two columns sit side by side on a wide screen — so the same two numbers appeared
                twice, a hand's width apart. When they agree the repetition is noise, and if they
                ever disagree the screen has no way to say which one is right. */}
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Flex align="center" gap="card">
                    <Text fontWeight="medium">{t("restock.form.products")}</Text>
                    <Spacer />

                    {/* THE way products get onto this request (#165, owner: "not product select but
                        product-picker"). A restock is a shopping list — you decide what to buy in one
                        sitting — and picking a dozen products one combobox at a time made the form
                        fight that. Ticking a dozen in one dialog is the same job in one pass.

                        `stockWarehouseId` is the part that only works here: the picker shows what the
                        DESTINATION warehouse already holds, which is the question being answered while
                        choosing what to restock. Before a warehouse is chosen there is no such number,
                        so it is omitted rather than guessed — undefined shows no badge, and no badge is
                        honest where a wrong "out of stock" would not be.

                        No `teamId` = browse EVERY team's catalogue, which is what the combobox's
                        scope="all" did: a warehouse restocks goods it does not own. */}
                    <ProductPicker
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
                  </Flex>

                  {lines.length === 0 && (
                    <Text fontSize="sm" color="fg.muted" data-testid="restock-no-products">
                      {t("restock.form.noProducts")}
                    </Text>
                  )}

                  <Stack gap="card">
                    {lines.map((line, i) => (
                      <Box
                        key={line.productId.toString()}
                        borderWidth="1px"
                        rounded="md"
                        p="card"
                        data-testid={`restock-line-${i}`}
                      >
                        <ProductListItem
                          product={{ id: line.productId, sku: line.sku, name: line.name }}
                          action={
                            <Flex gap="card" align="end" justify="end" wrap="wrap">
                              <Field.Root w="20">
                                <Field.Label fontSize="xs">{t("restock.form.quantity")}</Field.Label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={line.quantity}
                                  data-testid={`restock-qty-${i}`}
                                  onChange={(e) =>
                                    patchLine(line.productId, { quantity: e.target.value })
                                  }
                                />
                              </Field.Root>

                              <Field.Root w="28">
                                <Field.Label fontSize="xs">{t("restock.form.totalPrice")}</Field.Label>
                                <CurrencyInput
                                  value={line.totalPrice}
                                  data-testid={`restock-total-price-${i}`}
                                  onChange={(v) => patchLine(line.productId, { totalPrice: v })}
                                />
                              </Field.Root>

                              <Text
                                fontSize="sm"
                                fontWeight="medium"
                                minW="24"
                                pb="1.5"
                                textAlign="end"
                                data-testid={`restock-line-total-${i}`}
                              >
                                {formatRupiah(lineTotal(line))}
                              </Text>

                              {/* No "change product" beside it any more: swapping one product for
                                  another is picking, and picking is the dialog. Remove stays because
                                  dropping one line should not need one. */}
                              <IconButton
                                type="button"
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                mb="1"
                                aria-label={t("restock.form.removeProduct")}
                                data-testid={`restock-remove-${i}`}
                                onClick={() => removeLine(line.productId)}
                              >
                                <Icon as={Trash2} boxSize="4" />
                              </IconButton>
                            </Flex>
                          }
                        />
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              </Card.Body>
            </Card.Root>

            {/* ─── B and C, side by side under A ───────────────────────────────────────────── */}
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="section" alignItems="start">
              {/* ─── B — everything about the order the goods come from ────────────────────── */}
              <Card.Root>
                <Card.Body>
                  <Stack gap="card">
                    <Text fontWeight="medium">{t("restock.form.orderDetails")}</Text>

                    <Field.Root>
                      <Field.Label>{t("restock.form.shippingCost")}</Field.Label>
                      <CurrencyInput
                        value={shippingCost}
                        placeholder="0"
                        data-testid="restock-shipping-cost"
                        onChange={setShippingCost}
                      />
                      <Field.HelperText>{t("restock.form.shippingCostHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("restock.form.shipment")}</Field.Label>
                      <ShippingSelect value={shippingCode} onChange={setShippingCode} />
                      <Field.HelperText>{t("restock.form.shipmentHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("restock.form.receipt")}</Field.Label>
                      <Input
                        value={receipt}
                        maxLength={100}
                        data-testid="restock-receipt"
                        onChange={(e) => setReceipt(e.target.value)}
                      />
                      <Field.HelperText>{t("restock.form.receiptHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("restock.form.orderRef")}</Field.Label>
                      <Input
                        value={orderRef}
                        maxLength={100}
                        data-testid="restock-order-ref"
                        onChange={(e) => setOrderRef(e.target.value)}
                      />
                      <Field.HelperText>{t("restock.form.orderRefHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("restock.form.supplier")}</Field.Label>
                      <SupplierSelect
                        teamId={teamId ?? 0n}
                        value={supplierId}
                        onChange={setSupplierId}
                      />
                      <Field.HelperText>{t("restock.form.supplierHelp")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("restock.form.paymentType")}</Field.Label>
                      <PaymentTypeSelect value={paymentType} onChange={setPaymentType} />
                      <Field.HelperText>{t("restock.form.paymentTypeHelp")}</Field.HelperText>
                    </Field.Root>
                  </Stack>
                </Card.Body>
              </Card.Root>

              {/* ─── C — the restock note ──────────────────────────────────────────────────── */}
              <Card.Root>
                <Card.Body>
                  <Stack gap="card">
                    <Text fontWeight="medium">{t("restock.form.note")}</Text>

                    <Field.Root>
                      <Textarea
                        rows={12}
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

          {/* ─── The sidebar: D, then the E/F/G summary ──────────────────────────────────── */}
          <Stack flex="1" minW="0" w="full" maxW={{ lg: "sm" }} gap="section">
            {/* ─── D — which warehouse receives the stock ────────────────────────────────── */}
            <Card.Root>
              <Card.Body>
                <Field.Root required>
                  <Field.Label>{t("restock.form.warehouse")}</Field.Label>
                  <Box w="full" data-testid="restock-warehouse">
                    <TeamSelect
                      teamType={TeamType.WAREHOUSE}
                      value={warehouseId}
                      onChange={setWarehouseId}
                    />
                  </Box>
                  <Field.HelperText>{t("restock.form.warehouseHelp")}</Field.HelperText>
                </Field.Root>
              </Card.Body>
            </Card.Root>

            {/* ─── E — the products, each at its per-piece price, and their total ────────── */}
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Flex align="center" justify="space-between" gap="card">
                    <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                      {t("restock.summary.totalProducts")}
                    </Text>
                    <Text fontSize="sm" fontWeight="medium" data-testid="restock-summary-count">
                      {lines.length}
                    </Text>
                  </Flex>

                  <Separator />

                  {lines.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">
                      {t("restock.summary.noProducts")}
                    </Text>
                  ) : (
                    <Stack gap="card">
                      {lines.map((line) => (
                        <Flex key={line.productId.toString()} gap="card" justify="space-between" align="start">
                          <Stack gap="0" flex="1" minW="0">
                            <Text fontSize="sm" lineClamp={1}>
                              {line.name || line.sku}
                            </Text>
                            <Text fontSize="xs" color="fg.muted">
                              {t("restock.summary.perPiece", {
                                qty: toQty(line.quantity),
                                // Derived for the eye only (#140) — the TOTAL is what is stored and sent.
                                price: formatRupiah(
                                  toQty(line.quantity) > 0
                                    ? toRupiah(line.totalPrice) / BigInt(toQty(line.quantity))
                                    : 0n,
                                ),
                              })}
                            </Text>
                          </Stack>
                          <Text fontSize="sm" flexShrink={0}>
                            {formatRupiah(lineTotal(line))}
                          </Text>
                        </Flex>
                      ))}
                    </Stack>
                  )}

                  <Separator />

                  <Flex align="center" justify="space-between" gap="card">
                    <Text fontSize="sm" fontWeight="medium">
                      {t("restock.summary.productsTotal")}
                    </Text>
                    <Text fontSize="sm" fontWeight="semibold" data-testid="restock-summary-products">
                      {formatRupiah(productsTotal)}
                    </Text>
                  </Flex>
                </Stack>
              </Card.Body>
            </Card.Root>

            {/* ─── F — the freight, as entered in B ──────────────────────────────────────── */}
            <Card.Root>
              <Card.Body>
                <Flex align="center" justify="space-between" gap="card">
                  <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                    {t("restock.form.shippingCost")}
                  </Text>
                  <Text fontSize="sm" fontWeight="semibold" data-testid="restock-summary-shipping">
                    {formatRupiah(shippingCostValue)}
                  </Text>
                </Flex>
              </Card.Body>
            </Card.Root>

            {/* ─── G — products + freight, the number being agreed to ────────────────────── */}
            <Card.Root bg="brand.subtle" borderColor="brand.emphasized">
              <Card.Body>
                <Flex align="center" justify="space-between" gap="card">
                  <Text fontWeight="semibold">{t("restock.summary.grandTotal")}</Text>
                  <Text fontSize="lg" fontWeight="bold" data-testid="restock-summary-total">
                    {formatRupiah(grandTotal)}
                  </Text>
                </Flex>
              </Card.Body>
            </Card.Root>

            <Button
              type="submit"
              colorPalette="brand"
              loading={saving}
              disabled={!canSave}
              data-testid="submit-restock"
            >
              {isEdit ? t("restock.form.saveChanges") : t("restock.form.submit")}
            </Button>
          </Stack>
        </Flex>
      </form>
    </Stack>
  );
}
