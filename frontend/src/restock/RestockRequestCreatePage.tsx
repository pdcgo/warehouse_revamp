import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  NativeSelect,
  Separator,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, Plus, Replace, Trash2 } from "lucide-react";
import { restockClient, rpcError } from "../api/clients";
import { RestockPaymentType } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { TeamSelect } from "../components/TeamSelect";
import { ProductSelect } from "../components/ProductSelect";
import type { PickedProduct } from "../components/ProductSelect";
import { ProductListItem } from "../components/ProductListItem";
import { SupplierSelect } from "../components/SupplierSelect";
import { ShippingSelect } from "../shipping/ShippingSelect";
import { formatRupiah } from "../lib/money";
import { toaster } from "../components/Toaster";

// One editable restock line. product id/sku/name come from the picker (a snapshot — the product may
// live in another team's catalogue); quantity and the expected per-unit supplier price are typed. The
// numeric fields are kept as strings while editing (an empty input is not 0) and parsed on submit.
interface LineDraft {
  key: number;
  productId: bigint;
  sku: string;
  name: string;
  quantity: string;
  price: string;
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

function lineTotal(line: LineDraft): bigint {
  return BigInt(toQty(line.quantity)) * toRupiah(line.price);
}

// RestockRequestCreatePage is the selling-side "ask a warehouse to restock" form (#105, #124, #127). It
// is a dedicated PAGE, not a modal: the warehouse and product pickers render their listboxes through a
// Portal, which is inert inside a modal Dialog — a page sidesteps that entirely (same reason
// OrderCreatePage is a page), and it carries a dynamic list of lines besides.
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
// the products' total (Σ qty × per-unit price) plus the freight, which is the one number the person
// filling this in is actually agreeing to pay.
export function RestockRequestCreatePage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const teamId = current?.teamId;

  const nextKey = useRef(1);
  const freshLine = (): LineDraft => ({
    key: nextKey.current++,
    productId: 0n,
    sku: "",
    name: "",
    quantity: "1",
    price: "0",
  });

  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [shippingCode, setShippingCode] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [freshLine()]);

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

  function patchLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickProduct(key: number, p: PickedProduct) {
    patchLine(key, { productId: p.id, sku: p.sku, name: p.name });
  }

  // Clearing a line's product drops it back to the picker without losing the line (or its typed
  // quantity/price) — the re-pick path, now that a picked line renders as a ProductListItem rather
  // than as a combobox that stays on screen.
  function clearProduct(key: number) {
    patchLine(key, { productId: 0n, sku: "", name: "" });
  }

  function addLine() {
    setLines((prev) => [...prev, freshLine()]);
  }

  // The contract requires at least one line, so the last one is never removable.
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const picked = useMemo(() => lines.filter((l) => l.productId > 0n), [lines]);

  // E — the products' money: Σ (quantity × per-unit price), in whole rupiah.
  const productsTotal = useMemo(() => picked.reduce((sum, l) => sum + lineTotal(l), 0n), [picked]);

  // F — the freight as typed. Parsed every render so E/F/G track the input live.
  const shippingCostValue = toRupiah(shippingCost);

  // G — what this restock costs in full.
  const grandTotal = productsTotal + shippingCostValue;

  const linesValid = lines.every((l) => l.productId > 0n && toQty(l.quantity) >= 1);
  const canSave = warehouseId > 0n && lines.length >= 1 && linesValid;

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await restockClient.restockRequestCreate({
        teamId,
        warehouseId,
        shippingCode,
        items: lines.map((l) => ({
          id: 0n,
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          quantity: BigInt(toQty(l.quantity)),
          price: toRupiah(l.price),
        })),
        receipt: receipt.trim(),
        supplierId,
        orderRef: orderRef.trim(),
        shippingCost: shippingCostValue,
        paymentType,
        note: note.trim(),
      });

      toaster.create({ type: "success", title: t("restock.toast.created") });
      void navigate("/inventories/restock");
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.newRequestTitle")}</Heading>
        <Text color="fg.muted" data-testid="restock-create-no-team">
          {t("restock.selectTeamCreate")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" maxW="7xl" data-testid="restock-create-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("restock.back")}
          data-testid="restock-create-back"
          onClick={() => navigate("/inventories/restock")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{t("restock.newRequestTitle")}</Heading>
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
            {/* ─── A — the picked products, with the count and the products' total ─────────── */}
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Flex align="center" gap="card">
                    <Text fontWeight="medium">{t("restock.form.products")}</Text>
                    <Badge colorPalette="gray" data-testid="restock-product-count">
                      {t("restock.form.productCount", { n: picked.length })}
                    </Badge>
                  </Flex>

                  <Stack gap="card">
                    {lines.map((line, i) => (
                      <Box
                        key={line.key}
                        borderWidth="1px"
                        rounded="md"
                        p="card"
                        data-testid={`restock-line-${i}`}
                      >
                        {line.productId === 0n ? (
                          // Nothing picked yet: the line IS the picker.
                          <Flex gap="card" align="center">
                            <Box flex="1" minW="0">
                              <ProductSelect
                                teamId={teamId ?? 0n}
                                scope="all"
                                value={line.productId}
                                onChange={(p) => pickProduct(line.key, p)}
                              />
                            </Box>
                            <IconButton
                              type="button"
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              aria-label={t("restock.form.removeProduct")}
                              disabled={lines.length <= 1}
                              data-testid={`restock-remove-${i}`}
                              onClick={() => removeLine(line.key)}
                            >
                              <Icon as={Trash2} boxSize="4" />
                            </IconButton>
                          </Flex>
                        ) : (
                          <ProductListItem
                            product={{ id: line.productId, sku: line.sku, name: line.name }}
                            action={
                              <Flex gap="card" align="end" justify="end" wrap="wrap">
                                <Field.Root w="20">
                                  <Field.Label fontSize="xs">
                                    {t("restock.form.quantity")}
                                  </Field.Label>
                                  <Input
                                    type="number"
                                    min="1"
                                    value={line.quantity}
                                    data-testid={`restock-qty-${i}`}
                                    onChange={(e) =>
                                      patchLine(line.key, { quantity: e.target.value })
                                    }
                                  />
                                </Field.Root>

                                <Field.Root w="28">
                                  <Field.Label fontSize="xs">{t("restock.form.price")}</Field.Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={line.price}
                                    data-testid={`restock-price-${i}`}
                                    onChange={(e) => patchLine(line.key, { price: e.target.value })}
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

                                <Flex gap="1" pb="1">
                                  <IconButton
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    aria-label={t("restock.form.changeProduct")}
                                    data-testid={`restock-change-${i}`}
                                    onClick={() => clearProduct(line.key)}
                                  >
                                    <Icon as={Replace} boxSize="4" />
                                  </IconButton>
                                  <IconButton
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    colorPalette="red"
                                    aria-label={t("restock.form.removeProduct")}
                                    disabled={lines.length <= 1}
                                    data-testid={`restock-remove-${i}`}
                                    onClick={() => removeLine(line.key)}
                                  >
                                    <Icon as={Trash2} boxSize="4" />
                                  </IconButton>
                                </Flex>
                              </Flex>
                            }
                          />
                        )}
                      </Box>
                    ))}
                  </Stack>

                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    alignSelf="flex-start"
                    data-testid="restock-add-line"
                    onClick={addLine}
                  >
                    <Icon as={Plus} boxSize="4" />
                    {t("restock.form.addProduct")}
                  </Button>

                  <Separator />

                  <Flex align="center" justify="space-between" gap="card">
                    <Text fontWeight="semibold">{t("restock.form.total")}</Text>
                    <Text fontWeight="semibold" data-testid="restock-total">
                      {formatRupiah(productsTotal)}
                    </Text>
                  </Flex>
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
                      <Input
                        type="number"
                        min="0"
                        value={shippingCost}
                        placeholder="0"
                        data-testid="restock-shipping-cost"
                        onChange={(e) => setShippingCost(e.target.value)}
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

                    {/* UNSPECIFIED is a legitimate value here ("not recorded"), so — unlike the
                        pickers — the empty option stays selectable rather than being a disabled
                        placeholder. */}
                    <Field.Root>
                      <Field.Label>{t("restock.form.paymentType")}</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          data-testid="restock-payment-type"
                          value={
                            paymentType === RestockPaymentType.UNSPECIFIED ? "" : String(paymentType)
                          }
                          onChange={(e) =>
                            setPaymentType(
                              e.target.value
                                ? (Number(e.target.value) as RestockPaymentType)
                                : RestockPaymentType.UNSPECIFIED,
                            )
                          }
                        >
                          <option value="">{t("restock.form.paymentTypeNone")}</option>
                          <option value={String(RestockPaymentType.SHOPEE_PAY)}>
                            {t("restock.form.paymentShopeePay")}
                          </option>
                          <option value={String(RestockPaymentType.BANK_ACCOUNT)}>
                            {t("restock.form.paymentBankAccount")}
                          </option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
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
                      {picked.length}
                    </Text>
                  </Flex>

                  <Separator />

                  {picked.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">
                      {t("restock.summary.noProducts")}
                    </Text>
                  ) : (
                    <Stack gap="card">
                      {picked.map((line) => (
                        <Flex key={line.key} gap="card" justify="space-between" align="start">
                          <Stack gap="0" flex="1" minW="0">
                            <Text fontSize="sm" lineClamp={1}>
                              {line.name || line.sku}
                            </Text>
                            <Text fontSize="xs" color="fg.muted">
                              {t("restock.summary.perPiece", {
                                qty: toQty(line.quantity),
                                price: formatRupiah(toRupiah(line.price)),
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
              {t("restock.form.submit")}
            </Button>
          </Stack>
        </Flex>
      </form>
    </Stack>
  );
}
