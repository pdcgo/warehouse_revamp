import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { restockClient, rpcError } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { TeamSelect } from "../components/TeamSelect";
import { ProductSelect } from "../components/ProductSelect";
import type { PickedProduct } from "../components/ProductSelect";
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
// A price of 0 is LEGITIMATE here (a transfer, a sample), so it is never a validity gate.
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

// The order id is typed by hand (there is no order picker component yet), so it is parsed straight
// from the digits rather than through Number() — Number() would silently round a uint64 id past
// 2^53. Blank / anything non-numeric = 0n, which the contract reads as "not tied to an order".
function toId(raw: string): bigint {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return 0n;
  return BigInt(s);
}

function lineTotal(line: LineDraft): bigint {
  return BigInt(toQty(line.quantity)) * toRupiah(line.price);
}

// RestockRequestCreatePage is the selling-side "ask a warehouse to restock" form (#105, #124). It is a
// dedicated PAGE, not a modal: the warehouse and product pickers render their listboxes through a
// Portal, which is inert inside a modal Dialog — a page sidesteps that entirely (same reason
// OrderCreatePage is a page), and it carries a dynamic list of lines besides.
//
// #124 made a request MULTI-LINE (at least one line) and gave each line a per-unit price, plus three
// pieces of OPTIONAL context: the order the restock is for, the courier's receipt (resi), and the
// supplier the goods are bought from. Money is computed here for display only — the backend stores
// what it is sent.
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

  // The three optional fields (#124). Each has a documented "none" value in the contract:
  // orderId 0, receipt "", supplierId 0 — so an untouched field simply sends its zero.
  const [orderId, setOrderId] = useState("");
  const [receipt, setReceipt] = useState("");
  const [supplierId, setSupplierId] = useState<bigint>(0n);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function patchLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickProduct(key: number, p: PickedProduct) {
    patchLine(key, { productId: p.id, sku: p.sku, name: p.name });
  }

  function addLine() {
    setLines((prev) => [...prev, freshLine()]);
  }

  // The contract requires at least one line, so the last one is never removable.
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const total = useMemo(() => lines.reduce((sum, l) => sum + lineTotal(l), 0n), [lines]);

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
        orderId: toId(orderId),
        receipt: receipt.trim(),
        supplierId,
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
    <Stack gap="section" maxW="3xl" data-testid="restock-create-page">
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
        <Stack gap="section">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
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

                <Field.Root>
                  <Field.Label>{t("restock.form.shipment")}</Field.Label>
                  <ShippingSelect value={shippingCode} onChange={setShippingCode} />
                  <Field.HelperText>{t("restock.form.shipmentHelp")}</Field.HelperText>
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Text fontWeight="medium">{t("restock.form.products")}</Text>

                <Stack gap="card">
                  {lines.map((line, i) => (
                    <Box
                      key={line.key}
                      borderWidth="1px"
                      rounded="md"
                      p="card"
                      data-testid={`restock-line-${i}`}
                    >
                      <Flex gap="card" align="start" wrap="wrap">
                        <Box flex="1" minW="52">
                          <ProductSelect
                            teamId={teamId ?? 0n}
                            scope="all"
                            value={line.productId}
                            onChange={(p) => pickProduct(line.key, p)}
                          />
                          {line.productId > 0n && (
                            <Text
                              fontSize="xs"
                              color="fg.muted"
                              mt="1"
                              data-testid={`restock-line-picked-${i}`}
                            >
                              {line.sku} — {line.name}
                            </Text>
                          )}
                        </Box>

                        <Field.Root w="20">
                          <Field.Label fontSize="xs">{t("restock.form.quantity")}</Field.Label>
                          <Input
                            type="number"
                            min="1"
                            value={line.quantity}
                            data-testid={`restock-qty-${i}`}
                            onChange={(e) => patchLine(line.key, { quantity: e.target.value })}
                          />
                        </Field.Root>

                        <Field.Root w="32">
                          <Field.Label fontSize="xs">{t("restock.form.price")}</Field.Label>
                          <Input
                            type="number"
                            min="0"
                            value={line.price}
                            data-testid={`restock-price-${i}`}
                            onChange={(e) => patchLine(line.key, { price: e.target.value })}
                          />
                        </Field.Root>

                        <Stack gap="0.5" minW="24" pt="6" align="end">
                          <Text fontSize="sm" data-testid={`restock-line-total-${i}`}>
                            {formatRupiah(lineTotal(line))}
                          </Text>
                        </Stack>

                        <Box pt="5">
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
                        </Box>
                      </Flex>
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

                <Flex align="center" gap="card">
                  <Text fontWeight="semibold">{t("restock.form.total")}</Text>
                  <Text fontWeight="semibold" data-testid="restock-total">
                    {formatRupiah(total)}
                  </Text>
                </Flex>
              </Stack>
            </Card.Body>
          </Card.Root>

          {/* The three #124 optionals get their own card: none of them gates the submit button, and
              grouping them keeps the required warehouse/products path visually first. */}
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Text fontWeight="medium">{t("restock.form.optionalDetails")}</Text>

                <Field.Root>
                  <Field.Label>{t("restock.form.supplier")}</Field.Label>
                  <SupplierSelect teamId={teamId ?? 0n} value={supplierId} onChange={setSupplierId} />
                  <Field.HelperText>{t("restock.form.supplierHelp")}</Field.HelperText>
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("restock.form.receipt")}</Field.Label>
                  <Input
                    value={receipt}
                    data-testid="restock-receipt"
                    onChange={(e) => setReceipt(e.target.value)}
                  />
                  <Field.HelperText>{t("restock.form.receiptHelp")}</Field.HelperText>
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("restock.form.orderId")}</Field.Label>
                  <Input
                    type="number"
                    min="1"
                    w="40"
                    value={orderId}
                    data-testid="restock-order-id"
                    onChange={(e) => setOrderId(e.target.value)}
                  />
                  <Field.HelperText>{t("restock.form.orderIdHelp")}</Field.HelperText>
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Flex justify="end">
            <Button
              type="submit"
              colorPalette="brand"
              loading={saving}
              disabled={!canSave}
              data-testid="submit-restock"
            >
              {t("restock.form.submit")}
            </Button>
          </Flex>
        </Stack>
      </form>
    </Stack>
  );
}
