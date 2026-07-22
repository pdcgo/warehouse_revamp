import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Input,
  Separator,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { rpcError } from "../api/clients";
import { AddressPicker, emptyAddress } from "../components/AddressPicker";
import type { AddressValue } from "../components/AddressPicker";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CurrencyInput } from "../components/CurrencyInput";
import { ProductSelect } from "../components/ProductSelect";
import type { PickedProduct } from "../components/ProductSelect";
import { ShopSelect } from "../components/ShopSelect";
import { TeamSelect } from "../components/TeamSelect";
import { toaster } from "../components/Toaster";
import { ShippingSelect } from "../shipping/ShippingSelect";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import type { OrderDraft } from "../gen/warehouse/selling/v1/order_draft_pb";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";
import { draftGaps } from "./draftReadiness";
import {
  useDeleteOrderDrafts,
  useOrderDraft,
  usePromoteOrderDraft,
  useUpdateOrderDraft,
} from "./queries";

// One line as this screen holds it. The scraped text rides along READ-ONLY: it is the evidence of
// what the buyer ordered, and it stays on screen next to the mapping so a wrong mapping is visible.
interface LineDraft {
  id: bigint;
  externalSku: string;
  externalName: string;
  productId: bigint;
  productLabel: string;
  quantity: string;
  unitPrice: string;
}

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

function linesOf(draft: OrderDraft): LineDraft[] {
  return draft.items.map((item) => ({
    id: item.id,
    externalSku: item.externalSku,
    externalName: item.externalName,
    productId: item.productId,
    productLabel: "",
    quantity: String(item.quantity),
    unitPrice: item.unitPrice.toString(),
  }));
}

function sameLines(a: LineDraft[], b: LineDraft[]): boolean {
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
  const [lines, setLines] = useState<LineDraft[]>([]);

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

  function patchLine(id: bigint, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function pickProduct(id: bigint, p: PickedProduct) {
    patchLine(id, { productId: p.id, productLabel: `${p.sku} — ${p.name}` });
  }

  function removeLine(id: bigint) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + BigInt(toQty(l.quantity)) * toRupiah(l.unitPrice), 0n),
    [lines],
  );

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

  const gaps = pending ? draftGaps(pending) : [];
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
    <Stack gap="section" maxW="3xl" data-testid="draft-detail-page">
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

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontWeight="medium">{t("orders.customerAndShop")}</Text>

            <Field.Root required>
              <Field.Label>{t("orders.customerName")}</Field.Label>
              <Input
                value={customerName}
                data-testid="draft-customer-name"
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>{t("orders.phone")}</Field.Label>
              <Input
                value={customerPhone}
                data-testid="draft-customer-phone"
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </Field.Root>

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
            <Text fontWeight="medium">{t("orders.deliveryAddress")}</Text>
            <AddressPicker value={address} onChange={setAddress} />
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontWeight="medium">{t("orderDrafts.mapLines")}</Text>
            <Text fontSize="sm" color="fg.muted">
              {t("orderDrafts.mapLinesHelp")}
            </Text>

            <Stack gap="card">
              {lines.map((line, i) => (
                <Box
                  key={line.id.toString()}
                  borderWidth="1px"
                  rounded="md"
                  p="card"
                  data-testid={`draft-line-${i}`}
                >
                  {/* THE SCRAPED TEXT, ABOVE THE MAPPING AND NEVER REPLACED BY IT. It is the evidence
                      of what the buyer actually ordered — the only thing anybody can check a mapping
                      against, and the reason a wrong one is visible at all. */}
                  <Stack gap="1" mb="card">
                    <HStack gap="2">
                      <Badge colorPalette="gray">{t("orderDrafts.scraped")}</Badge>
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

                  <Flex gap="card" align="start" wrap="wrap">
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
                          {line.productLabel || t("orderDrafts.mapped")}
                        </Text>
                      ) : (
                        <Text fontSize="xs" color="orange.fg" mt="1" data-testid={`draft-line-unmapped-${i}`}>
                          {t("orderDrafts.notMappedYet")}
                        </Text>
                      )}
                    </Box>

                    <Field.Root w="20">
                      <Field.Label fontSize="xs">{t("orders.qty")}</Field.Label>
                      <Input
                        type="number"
                        min="1"
                        value={line.quantity}
                        data-testid={`draft-line-qty-${i}`}
                        onChange={(e) => patchLine(line.id, { quantity: e.target.value })}
                      />
                    </Field.Root>

                    <Field.Root w="32">
                      <Field.Label fontSize="xs">{t("orders.unitPrice")}</Field.Label>
                      <CurrencyInput
                        value={line.unitPrice}
                        data-testid={`draft-line-price-${i}`}
                        onChange={(v) => patchLine(line.id, { unitPrice: v })}
                      />
                    </Field.Root>

                    <Box pt="5">
                      {/* A buyer who cancelled one line of three must be able to say so, or the
                          draft stays unpromotable forever over a line nobody wants. */}
                      <IconButton
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        aria-label={t("orderDrafts.removeLine")}
                        data-testid={`draft-line-remove-${i}`}
                        onClick={() => removeLine(line.id)}
                      >
                        <Icon as={Trash2} boxSize="4" />
                      </IconButton>
                    </Box>
                  </Flex>
                </Box>
              ))}
            </Stack>

            {lines.length === 0 && (
              <Text color="fg.muted" data-testid="draft-no-lines">
                {t("orderDrafts.missingLines")}
              </Text>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Flex align="center" gap="card">
              <Text color="fg.muted">{t("orders.subtotal")}</Text>
              <Text data-testid="draft-subtotal">{formatRupiah(subtotal)}</Text>
            </Flex>

            <Field.Root>
              <Field.Label>{t("orders.shippingCost")}</Field.Label>
              <CurrencyInput
                w="40"
                value={shippingCost}
                data-testid="draft-shipping-cost"
                onChange={setShippingCost}
              />
            </Field.Root>

            <Separator />

            <Flex align="center" gap="card">
              <Text fontWeight="semibold">{t("orders.total")}</Text>
              <Text fontWeight="semibold" data-testid="draft-total">
                {formatRupiah(subtotal + toRupiah(shippingCost))}
              </Text>
            </Flex>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Flex align="center" gap="card" wrap="wrap">
        {/* WHY Promote is disabled, beside the button rather than behind a click. The alternative is
            a person pressing it and reading a rejection to learn what they already could have seen. */}
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

        <Spacer />

        <Button
          variant="outline"
          loading={saving}
          disabled={!dirty}
          data-testid="draft-save"
          onClick={() => void save()}
        >
          {t("orderDrafts.save")}
        </Button>

        {/* Promote refuses an unsaved edit rather than silently saving first: it destroys the draft,
            and a button that quietly does two things is the wrong one to be surprised by. */}
        <Button
          colorPalette="brand"
          loading={saving}
          disabled={!ready || dirty}
          data-testid="draft-promote"
          onClick={() => void doPromote()}
        >
          {dirty ? t("orderDrafts.saveFirst") : t("orderDrafts.promote")}
        </Button>
      </Flex>

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
