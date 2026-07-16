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
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { orderClient, rpcError } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { ShopSelect } from "../components/ShopSelect";
import { ProductSelect } from "../components/ProductSelect";
import type { PickedProduct } from "../components/ProductSelect";
import { ShippingSelect } from "../shipping/ShippingSelect";
import { formatRupiah } from "../lib/money";
import { toaster } from "../components/Toaster";

// One editable order line. product id/sku/name come from the picker (a snapshot); quantity and the
// buyer-paid unit price are typed. The numeric fields are kept as strings while editing (an empty
// input is not 0) and parsed on submit.
interface LineDraft {
  key: number;
  productId: bigint;
  sku: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

// Whole rupiah only: parse an input string to a non-negative int64, treating blank/invalid as 0.
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
  return BigInt(toQty(line.quantity)) * toRupiah(line.unitPrice);
}

// OrderCreatePage is the selling-side "place an order" form (#90), a dedicated PAGE (like the product
// editor) because it carries a dynamic list of lines. It creates via OrderCreate on the #67 contract:
// no inventory is touched (that is #69) and no fulfillment happens here. Money is computed on the
// client for display, but the backend is the source of truth for what it stores.
export function OrderCreatePage() {
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
    unitPrice: "0",
  });

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [shopId, setShopId] = useState<bigint>(0n);
  const [shippingCode, setShippingCode] = useState("");
  const [shippingCost, setShippingCost] = useState("0");
  const [lines, setLines] = useState<LineDraft[]>(() => [freshLine()]);

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

  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + lineTotal(l), 0n), [lines]);
  const total = subtotal + toRupiah(shippingCost);

  const linesValid = lines.every((l) => l.productId > 0n && toQty(l.quantity) >= 1);
  const canSave = customerName.trim() !== "" && shopId > 0n && lines.length >= 1 && linesValid;

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await orderClient.orderCreate({
        teamId,
        shopId,
        customerName,
        customerPhone,
        customerAddress,
        shippingCode,
        subtotal,
        shippingCost: toRupiah(shippingCost),
        total,
        items: lines.map((l) => ({
          id: 0n,
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          quantity: toQty(l.quantity),
          unitPrice: toRupiah(l.unitPrice),
        })),
      });

      toaster.create({ type: "success", title: t("orders.orderCreated") });
      const id = res.order?.id;
      void navigate(id ? `/orders/${id}` : "/orders");
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
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
    <Stack gap="section" maxW="3xl" data-testid="order-create-page">
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

      <form onSubmit={save} noValidate>
        <Stack gap="section">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Text fontWeight="medium">{t("orders.customerAndShop")}</Text>

                <Field.Root required>
                  <Field.Label>{t("orders.customerName")}</Field.Label>
                  <Input
                    value={customerName}
                    data-testid="order-create-customer-name"
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("orders.phone")}</Field.Label>
                  <Input
                    value={customerPhone}
                    data-testid="order-create-customer-phone"
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("orders.address")}</Field.Label>
                  <Textarea
                    value={customerAddress}
                    data-testid="order-create-customer-address"
                    onChange={(e) => setCustomerAddress(e.target.value)}
                  />
                </Field.Root>

                <Field.Root required>
                  <Field.Label>{t("orders.shop")}</Field.Label>
                  <ShopSelect teamId={teamId ?? 0n} value={shopId} onChange={setShopId} />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("orders.shipping")}</Field.Label>
                  <ShippingSelect value={shippingCode} onChange={setShippingCode} />
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Flex align="center">
                  <Text fontWeight="medium">{t("orders.items")}</Text>
                </Flex>

                <Stack gap="card">
                  {lines.map((line, i) => (
                    <Box
                      key={line.key}
                      borderWidth="1px"
                      rounded="md"
                      p="card"
                      data-testid={`order-line-${i}`}
                    >
                      <Flex gap="card" align="start" wrap="wrap">
                        <Box flex="1" minW="52">
                          <ProductSelect
                            teamId={teamId ?? 0n}
                            value={line.productId}
                            onChange={(p) => pickProduct(line.key, p)}
                          />
                          {line.productId > 0n && (
                            <Text fontSize="xs" color="fg.muted" mt="1" data-testid={`order-line-picked-${i}`}>
                              {line.sku} — {line.name}
                            </Text>
                          )}
                        </Box>

                        <Field.Root w="20">
                          <Field.Label fontSize="xs">{t("orders.qty")}</Field.Label>
                          <Input
                            type="number"
                            min="1"
                            value={line.quantity}
                            data-testid={`order-line-qty-${i}`}
                            onChange={(e) => patchLine(line.key, { quantity: e.target.value })}
                          />
                        </Field.Root>

                        <Field.Root w="32">
                          <Field.Label fontSize="xs">{t("orders.unitPrice")}</Field.Label>
                          <Input
                            type="number"
                            min="0"
                            value={line.unitPrice}
                            data-testid={`order-line-price-${i}`}
                            onChange={(e) => patchLine(line.key, { unitPrice: e.target.value })}
                          />
                        </Field.Root>

                        <Stack gap="0.5" minW="24" pt="6" align="end">
                          <Text fontSize="sm" data-testid={`order-line-total-${i}`}>
                            {formatRupiah(lineTotal(line))}
                          </Text>
                        </Stack>

                        <Box pt="5">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            aria-label="Remove line"
                            disabled={lines.length <= 1}
                            data-testid={`order-line-remove-${i}`}
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
                  size="xs"
                  variant="outline"
                  alignSelf="flex-start"
                  data-testid="order-create-add-line"
                  onClick={addLine}
                >
                  <Icon as={Plus} boxSize="4" />
                  {t("orders.addLine")}
                </Button>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Flex align="center" gap="card">
                  <Text color="fg.muted">{t("orders.subtotal")}</Text>
                  <Text data-testid="order-create-subtotal">{formatRupiah(subtotal)}</Text>
                </Flex>

                <Field.Root>
                  <Field.Label>{t("orders.shippingCost")}</Field.Label>
                  <Input
                    type="number"
                    min="0"
                    w="40"
                    value={shippingCost}
                    data-testid="order-create-shipping-cost"
                    onChange={(e) => setShippingCost(e.target.value)}
                  />
                </Field.Root>

                <Separator />

                <Flex align="center" gap="card">
                  <Text fontWeight="semibold">{t("orders.total")}</Text>
                  <Text fontWeight="semibold" data-testid="order-create-total">
                    {formatRupiah(total)}
                  </Text>
                </Flex>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Flex justify="end">
            <Button
              type="submit"
              colorPalette="brand"
              loading={saving}
              disabled={!canSave}
              data-testid="order-create-save"
            >
              {t("orders.createOrder")}
            </Button>
          </Flex>
        </Stack>
      </form>
    </Stack>
  );
}
