import { useEffect, useMemo, useRef, useState } from "react";
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
import { orderClient, rpcError, teamClient } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { useInvalidateOrders } from "./queries";
import { ShopSelect } from "../components/ShopSelect";
import { TeamSelect } from "../components/TeamSelect";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { ProductSelect } from "../components/ProductSelect";
import type { PickedProduct } from "../components/ProductSelect";
import { AddressPicker, emptyAddress } from "../components/AddressPicker";
import type { AddressValue } from "../components/AddressPicker";
import { CurrencyInput } from "../components/CurrencyInput";
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

// The address is OPTIONAL (#118) — exactly as the free text it replaces was: an order can be taken
// before the address is known. An untouched picker sends NOTHING rather than a message full of empty
// strings, so "no address" stays distinguishable from "an address of blanks".
function addressTouched(a: AddressValue): boolean {
  return Object.values(a).some((v) => v.trim() !== "");
}

// OrderCreatePage is the selling-side "place an order" form (#90), a dedicated PAGE (like the product
// editor) because it carries a dynamic list of lines. It creates via OrderCreate on the #67 contract:
// no inventory is touched (that is #69) and no fulfillment happens here. Money is computed on the
// client for display, but the backend is the source of truth for what it stores.
export function OrderCreatePage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const invalidateOrders = useInvalidateOrders();

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
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [shopId, setShopId] = useState<bigint>(0n);

  // Which warehouse fulfils this order (#72). Still REQUIRED: from #69 the order takes its stock out
  // of this warehouse the moment it is placed, so the form cannot submit without one.
  //
  // Pre-filled from the team's configured default (#145), which is not the same as guessing. The
  // earlier note here said there was "no sensible default to fall back on", and that was right about a
  // default the SYSTEM invents — that would move real goods out of the wrong building. A default the
  // TEAM configured is the team stating where it ships from, and it stays visible and changeable on
  // every order. The server also still refuses an order that names no warehouse, so nothing here can
  // let one through.
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [shippingCode, setShippingCode] = useState("");
  const [shippingCost, setShippingCost] = useState("0");
  const [lines, setLines] = useState<LineDraft[]>(() => [freshLine()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
  const canSave =
    customerName.trim() !== "" && shopId > 0n && warehouseId > 0n && lines.length >= 1 && linesValid;

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
        warehouseId,
        customerName,
        customerPhone,
        address: addressTouched(address) ? address : undefined,
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

      // Invalidate before leaving (#176): this page writes and then navigates away, so the list it
      // leaves behind has no way to learn about the order just created.
      await invalidateOrders();

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

                <Field.Root required>
                  <Field.Label>{t("orders.shop")}</Field.Label>
                  <ShopSelect teamId={teamId ?? 0n} value={shopId} onChange={setShopId} />
                </Field.Root>

                {/* Which warehouse ships it (#72). Required, and starts unchosen: from #69 this is
                    the building the stock actually leaves, so a default would move real goods out of
                    somewhere nobody picked. */}
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

                <Field.Root>
                  <Field.Label>{t("orders.shipping")}</Field.Label>
                  <ShippingSelect value={shippingCode} onChange={setShippingCode} />
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          {/* The address gets its own card: the shared AddressPicker is seven controls tall, and
              wedging it between "Phone" and "Shop" would push the shop/shipping pair out of sight.
              It is NOT required — nothing here gates the Create button. */}
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Text fontWeight="medium">{t("orders.deliveryAddress")}</Text>
                <AddressPicker value={address} onChange={setAddress} />
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
                          <CurrencyInput
                            value={line.unitPrice}
                            data-testid={`order-line-price-${i}`}
                            onChange={(v) => patchLine(line.key, { unitPrice: v })}
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
                  <CurrencyInput
                    w="40"
                    value={shippingCost}
                    data-testid="order-create-shipping-cost"
                    onChange={setShippingCost}
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
