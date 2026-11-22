import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Box, Button, Card, Field, Flex, Heading, Icon, IconButton, Input, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Plus, Truck, X } from "lucide-react";

import { rpcError } from "../../api/clients";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockResolutionType } from "../../gen/warehouse/inventory/v1/restock_resolution_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useRestockRequest } from "../../features/restock/queries";
import { brokenQuantity, missingQuantity } from "../../features/restock/summary";
import { unitGoods } from "../../features/restock/counting";
import { useLineSuppliers } from "../../features/restock/LineSupplier";
import { ProductSelect } from "../../components/products/ProductSelect";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { ReadyLine } from "../../components/feedback/ReadyLine";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { toaster } from "../../components/feedback/Toaster";
import { cameFrom } from "../../lib/cameFrom";
import { useRecordResolution } from "../../features/restockResolution/queries";
import { NoteField } from "../../features/restockResolution/ResolutionSection";

interface LineDraft {
  key: string;
  productId: bigint;
  productCode: string;
  name: string;
  count: string;
  price: string;
}

let seq = 0;
const nextKey = () => `l${(seq += 1)}`;

/** What the supplier still owes on a line — a received one's broken + missing units; a lost one's every unit. */
function owedOf(item: RestockRequestItem, lost: boolean): bigint {
  return lost ? item.count : brokenQuantity(item) + missingQuantity(item);
}

function parseId(raw: string | undefined): bigint {
  try {
    return raw ? BigInt(raw) : 0n;
  } catch {
    return 0n;
  }
}

// RECORDING A `reshipping` — the supplier sends the goods again — and its INBOUND custom shipment, in ONE step
// (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 *"A"* — who creates it and when): RestockResolutionCreate
// with type RESHIPPING and its `reshipping` parcel, under the form's one key (a double tap is refused, never recorded
// twice). Reached from the restock's *Catat Resolusi → Kirim Ulang* (route `/inventories/restock/:requestId/reshipping`).
//
//   ← Restok #503                                    Kiriman Ulang dari Supplier
//   Barang yang dikirim ulang                         the lines — product, count, price, typed by the seller; opened on
//     Beras Pandan Wangi 5kg   [ 3 ]  [Rp 65.000]  ×  the restock's problem lines at their unit price (the build's
//     ＋ Tambah Baris                                 default), each free to change — another product, another price
//                                                    (🔄 *"B"*: the price values the stock, moves no money)
//   Pengiriman   Gudang [Gudang Pusat ▾]  Kurir [JNE ▾]  Resi [ ]   the warehouse opens on the restock's; the resi may
//                                                    follow until Tiba
//   Catatan resolusi                                 what was agreed
//   ✓ Siap dicatat                     [Catat Kiriman Ulang]
//
// The supplier is the server's pick (0 = the one supplier every restock line names); the subtitle names it the same way.
// A page, as the outbound parcel's Paket Baru is: a dialog cannot carry its lines and its pickers.
export function RestockReshippingFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId } = useParams();
  const { current } = useTeam();
  const record = useRecordResolution();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const teamId = current?.teamType === TeamType.SELLING ? current.teamId : undefined;
  const id = parseId(requestId);
  const query = useRestockRequest({ teamId, requestId: id });
  const request = query.data ?? null;
  const lost = request?.status === RestockRequestStatus.LOST;
  const { suppliers } = useLineSuppliers(teamId, request?.items ?? []);

  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const [warehouseId, setWarehouseId] = useState(0n);
  const [courierId, setCourierId] = useState(0n);
  const [resi, setResi] = useState("");
  const [note, setNote] = useState("");

  // Opened on the restock's problem: one line per product the supplier still owes, at the line's unit price.
  const opening = useMemo<LineDraft[]>(
    () =>
      (request?.items ?? [])
        .filter((item) => owedOf(item, lost) > 0n)
        .map((item) => ({
          key: nextKey(),
          productId: item.productId,
          productCode: item.productCode,
          name: item.name,
          count: owedOf(item, lost).toString(),
          price: String(Math.round(unitGoods(item.total, item.count))),
        })),
    [request, lost],
  );
  const draft = lines ?? opening;
  const warehouse = warehouseId > 0n ? warehouseId : (request?.warehouseId ?? 0n);
  const back = () => navigate(cameFrom(location) ?? `/inventories/restock/${id}`);

  if (teamId === undefined) {
    return (
      <Text color="fg.muted" data-testid="reshipping-unavailable">
        {t("customShipment.sellingOnly")}
      </Text>
    );
  }
  if (query.isPending) return <ListSkeleton heading rows={3} testId="reshipping-loading" />;
  if (!request) {
    return (
      <Text color="error.fg" data-testid="reshipping-not-found">
        {t("restock.detail.notFound")}
      </Text>
    );
  }

  const setLine = (key: string, patch: Partial<LineDraft>) => setLines(draft.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const firstSupplier = request.items.find((i) => i.supplierId > 0n)?.supplierId ?? 0n;
  const supplierName = suppliers[firstSupplier.toString()]?.name ?? t("restockResolution.inbound.supplierUnknown");

  const missing: { id: string; label: string }[] = [];
  if (draft.length === 0 || draft.some((l) => l.productId === 0n)) missing.push({ id: "product", label: t("restockResolution.form.missing.product") });
  if (draft.some((l) => l.count === "" || l.count === "0")) missing.push({ id: "count", label: t("restockResolution.form.missing.count") });
  if (draft.some((l) => l.price === "")) missing.push({ id: "price", label: t("restockResolution.form.missing.price") });
  if (warehouse === 0n) missing.push({ id: "warehouse", label: t("restockResolution.form.missing.warehouse") });
  if (courierId === 0n) missing.push({ id: "courier", label: t("restockResolution.form.missing.courier") });

  async function save() {
    if (!request) return;
    try {
      await record.mutateAsync({
        teamId: request.requestingTeamId,
        restockId: request.id,
        type: RestockResolutionType.RESHIPPING,
        note: note.trim(),
        reshipping: {
          warehouseId: warehouse,
          shipmentChannelId: courierId,
          resi: resi.trim(),
          // The server's pick: the one supplier every restock line names.
          supplierId: 0n,
          lines: draft.map((l) => ({ productId: l.productId, count: BigInt(l.count), priceUnit: Number(l.price) })),
        },
        idempotencyKey,
      });
      toaster.create({ type: "success", title: t("restockResolution.toast.reshipping") });
      back();
    } catch (err) {
      toaster.create({ type: "error", title: t("restockResolution.toast.failed"), description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section" data-testid="reshipping-form">
      <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="reshipping-back" onClick={back}>
        <Icon as={ArrowLeft} boxSize="4" />
        {t("restockResolution.form.back", { id: request.id.toString() })}
      </Button>
      <Stack gap="1">
        <Heading size="md">{t("restockResolution.form.title")}</Heading>
        <Text fontSize="sm" color="fg.muted">
          {t(lost ? "restockResolution.form.subtitleLost" : "restockResolution.form.subtitle", { id: request.id.toString(), supplier: supplierName })}
        </Text>
      </Stack>

      <Card.Root>
        <Card.Header>
          <Card.Title>{t("restockResolution.form.lines")}</Card.Title>
          <Card.Description>{t("restockResolution.form.linesHint")}</Card.Description>
        </Card.Header>
        <Card.Body>
          <Stack gap="card">
            {draft.map((line) => (
              <Flex key={line.key} gap="field" wrap="wrap" align="flex-end" data-testid={`reshipping-line-${line.productId}`}>
                <Field.Root flex="1" minW="14rem" required>
                  <Field.Label>
                    {t("restock.detail.product")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  {/* A line opened on the restock's problem names its product; a line added picks one (the live picker).
                      Another product = remove the line, add one. */}
                  {line.productId > 0n ? (
                    <Stack gap="0" minH="10" justify="center" data-testid={`reshipping-product-${line.productId}`}>
                      <Text fontWeight="medium">{line.name}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        {line.productCode}
                      </Text>
                    </Stack>
                  ) : (
                    <Box w="full">
                      <ProductSelect
                        teamId={teamId}
                        value={line.productId}
                        placeholder={t("restockResolution.form.pickProduct")}
                        onChange={(p) => setLine(line.key, p ? { productId: p.id, productCode: p.productCode, name: p.name } : { productId: 0n, productCode: "", name: "" })}
                      />
                    </Box>
                  )}
                </Field.Root>
                <Field.Root w="auto" required>
                  <Field.Label>
                    {t("restockResolution.form.count")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  <QuantityInput value={line.count} onChange={(v) => setLine(line.key, { count: v })} min={1} testId={`reshipping-count-${line.productId}`} />
                </Field.Root>
                <Field.Root w={{ base: "full", md: "11rem" }} required>
                  <Field.Label>
                    {t("restockResolution.form.price")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  <CurrencyInput value={line.price} onChange={(v) => setLine(line.key, { price: v })} data-testid={`reshipping-price-${line.productId}`} />
                </Field.Root>
                <IconButton
                  variant="ghost"
                  aria-label={t("restockResolution.form.removeLine")}
                  data-testid={`reshipping-remove-${line.productId}`}
                  onClick={() => setLines(draft.filter((l) => l.key !== line.key))}
                >
                  <Icon as={X} boxSize="4" />
                </IconButton>
              </Flex>
            ))}
            <Button
              size="xs"
              variant="outline"
              alignSelf="flex-start"
              data-testid="reshipping-add-line"
              onClick={() => setLines([...draft, { key: nextKey(), productId: 0n, productCode: "", name: "", count: "1", price: "" }])}
            >
              <Icon as={Plus} boxSize="4" />
              {t("restockResolution.form.addLine")}
            </Button>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>{t("restockResolution.form.shipping")}</Card.Title>
        </Card.Header>
        <Card.Body>
          <Flex gap="field" wrap="wrap" align="flex-start">
            <Field.Root required flex="1" minW="14rem">
              <Field.Label>
                {t("restockResolution.form.warehouse")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Box w="full" data-testid="reshipping-warehouse">
                <TeamSelect value={warehouse > 0n ? warehouse : undefined} teamType={TeamType.WAREHOUSE} onChange={setWarehouseId} />
              </Box>
              <Field.HelperText>{t("restockResolution.form.warehouseHint")}</Field.HelperText>
            </Field.Root>
            <Field.Root required flex="1" minW="12rem">
              <Field.Label>
                {t("restock.detail.courier")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Box w="full" data-testid="reshipping-courier">
                <ShipmentChannelSelect value={courierId} onChange={setCourierId} />
              </Box>
            </Field.Root>
            <Field.Root flex="1" minW="12rem">
              <Field.Label>{t("restock.detail.tracking")}</Field.Label>
              <Input value={resi} maxLength={100} placeholder="JNE0123456789" data-testid="reshipping-resi" onChange={(e) => setResi(e.target.value)} />
              <Field.HelperText>{t("restockResolution.form.resiHint")}</Field.HelperText>
            </Field.Root>
          </Flex>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <NoteField value={note} onChange={setNote} testId="reshipping-note" />
        </Card.Body>
      </Card.Root>

      <Flex justify="flex-end" align="center" gap="card" wrap="wrap">
        <ReadyLine missing={missing} readyLabel={t("restockResolution.form.ready")} testId="reshipping-ready" />
        <Button colorPalette="brand" disabled={missing.length > 0} loading={record.isPending} data-testid="reshipping-save" onClick={() => void save()}>
          <Icon as={Truck} boxSize="4" />
          {t("restockResolution.form.save")}
        </Button>
      </Flex>
    </Stack>
  );
}
