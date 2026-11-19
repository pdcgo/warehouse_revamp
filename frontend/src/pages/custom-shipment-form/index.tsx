import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Field,
  Flex,
  Icon,
  IconButton,
  Input,
  Select,
  SimpleGrid,
  Span,
  Spacer,
  Stack,
  Text,
  Textarea,
  createListCollection,
} from "@chakra-ui/react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useStockAvailability } from "../../features/inventory/queries";
import type {
  CustomShipmentKind,
  CustomShipmentPayer,
  CustomShipmentRecipient,
  ReshipLine,
  ReshipSupplier,
} from "../../features/customShipment/customShipments";
import { CUSTOM_SHIPMENTS_PATH, customShipmentPath, reshipLeft } from "../../features/customShipment/customShipments";
import { useCustomShipmentPrototype } from "../../features/customShipment/customShipmentPrototype";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { OwnStockedProductPicker } from "../../components/products/OwnStockedProductPicker";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { RadioPills } from "../../components/inputs/RadioPills";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import { ReadyLine } from "../../components/feedback/ReadyLine";
import { toaster } from "../../components/feedback/Toaster";
import { cameFrom } from "../../lib/cameFrom";
import { formatUnixDate } from "../../lib/datetime";

interface SampleLine {
  productId: bigint;
  productCode: string;
  name: string;
  count: string;
}

const countOf = (raw: string) => (/^\d+$/.test(raw) ? BigInt(raw) : 0n);
const EMPTY_RECIPIENT: CustomShipmentRecipient = { name: "", phone: "", address: "" };
/** The supplier key of a reship line — its supplier's id, or "none" for a line that named none. */
const supplierKey = (line: ReshipLine) => line.supplier?.id.toString() ?? "none";

// PAKET BARU — the selling team asks its warehouse to send a parcel that is not an order
// (the-selling-team-asks-the-warehouse-ships). The form asks only what the TEAM decides — what goes, to whom, by which
// courier, and who pays it; what the warehouse does (the pick, the handover, a *Gudang bayar* cost) is the warehouse's.
//
//   Jenis       (• Sampel) ( Kirim balik ke supplier )             a-custom-shipment-is-a-parcel-that-is-not-an-order
//   Barang      SAMPLE: the warehouse, then the team's products it holds and how many (≤ what it holds) — the stock is
//                 taken at create, oldest batch first, the system picking the racks, as an order and a transfer out;
//               RESHIP: a problem restock (Diterima, *Barang rusak*), its supplier when its broken lines name several
//                 (one parcel, one supplier), and its broken units — at most the broken count less what a live reship
//                 already carries. Broken units were never on a rack, so a reship takes no rack stock
//                 (a-restocks-broken-units-are-just-broken-for-now).
//   Penerima    name · phone · address — free text. A reship's is the supplier, PREFILLED from what supplier_service keeps
//               (its name, its `contact`, its `address`), each still editable; a fact it lacks is left to type.
//   Pengiriman  the courier (a shipment channel) and WHO PAYS (the-courier-is-paid-by-the-team-or-by-the-warehouse, 🔄 A):
//                 (• Gudang bayar) — nothing more now: the warehouse types the real cost at the handover;
//                 ( Kami bayar )   — the team's account (required) and its cost (may follow, until the handover).
//               Asked first, then filled (the-charge-is-asked-for-before-it-is-filled): Kami bayar's fields are hidden
//               until it is picked.
//   Catatan     for the warehouse.
// One ready line over the button (a-save-button-says-what-it-waits-for).
export function CustomShipmentFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { current } = useTeam();
  const prototype = useCustomShipmentPrototype();
  const teamId = current?.teamId;

  const [kind, setKind] = useState<CustomShipmentKind>("SAMPLE");
  // SAMPLE
  const [warehouseId, setWarehouseId] = useState(0n);
  const [lines, setLines] = useState<SampleLine[]>([]);
  // RESHIP
  const [restockId, setRestockId] = useState(0n);
  const [supplierPick, setSupplierPick] = useState("");
  const [reshipCounts, setReshipCounts] = useState<Record<string, string>>({});
  // BOTH
  const [recipient, setRecipient] = useState<CustomShipmentRecipient>(EMPTY_RECIPIENT);
  const [courierId, setCourierId] = useState(0n);
  const [payer, setPayer] = useState<CustomShipmentPayer>("WAREHOUSE");
  const [accountId, setAccountId] = useState(0n);
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");

  const availability = useStockAvailability({
    teamId,
    warehouseId: kind === "SAMPLE" ? warehouseId : 0n,
    productIds: lines.map((l) => l.productId),
  });
  const availableOf = (id: bigint) => availability.data?.get(id.toString());

  const options = prototype?.reshipOptions ?? [];
  const option = options.find((o) => o.restockId === restockId);
  const teams = useTeamsByIds({ ids: options.map((o) => o.warehouseId) });
  const warehouseName = (id: bigint) => teams.data?.[id.toString()]?.name || t("customShipment.teamRef", { id: id.toString() });

  // One parcel goes to ONE supplier: the restock's broken lines grouped by theirs — picked for the person when there is
  // only one, asked when there are several.
  const suppliers = useMemo(() => {
    const seen = new Map<string, ReshipSupplier | undefined>();
    for (const line of option?.lines ?? []) seen.set(supplierKey(line), line.supplier);

    return [...seen.entries()].map(([key, supplier]) => ({ key, supplier }));
  }, [option]);
  const supplierChosen = suppliers.length === 1 ? suppliers[0]!.key : supplierPick;
  const reshipLines = (option?.lines ?? []).filter((line) => supplierKey(line) === supplierChosen);
  const chosenSupplier = suppliers.find((s) => s.key === supplierChosen)?.supplier;

  const restockCollection = useMemo(
    () =>
      createListCollection({
        items: options.map((o) => ({
          value: o.restockId.toString(),
          label: t("customShipment.form.restockOption", {
            id: o.restockId.toString(),
            // The team names arrive later than the options — the labels follow them (teams.data below).
            warehouse: teams.data?.[o.warehouseId.toString()]?.name || t("customShipment.teamRef", { id: o.warehouseId.toString() }),
            count: Number(o.lines.reduce((sum, line) => sum + reshipLeft(line), 0n)),
          }),
        })),
      }),
    [options, teams.data, t],
  );

  const back = () => navigate(cameFrom(location) ?? CUSTOM_SHIPMENTS_PATH);

  if (!prototype) {
    return (
      <Text color="fg.muted" data-testid="custom-shipment-unavailable">
        {t("customShipment.unavailable")}
      </Text>
    );
  }

  if (teamId === undefined || prototype.side !== "selling") {
    return (
      <Text color="fg.muted" data-testid="custom-shipment-wrong-team">
        {t("customShipment.sellingOnly")}
      </Text>
    );
  }

  // A different kind or a different restock asks every line again — the units come from somewhere else.
  function changeKind(next: CustomShipmentKind) {
    setKind(next);
    setLines([]);
    setRestockId(0n);
    setSupplierPick("");
    setReshipCounts({});
    setRecipient(EMPTY_RECIPIENT);
  }

  function changeWarehouse(id: bigint) {
    setWarehouseId(id);
    setLines([]);
  }

  // THE SUPPLIER AS THE RECIPIENT — prefilled from its three facts; what it lacks is left to type.
  function prefill(supplier: ReshipSupplier | undefined) {
    setRecipient({ name: supplier?.name ?? "", phone: supplier?.contact ?? "", address: supplier?.address ?? "" });
  }

  function pickRestock(id: bigint) {
    const picked = options.find((o) => o.restockId === id);
    setRestockId(id);
    setSupplierPick("");
    // Every broken unit left, by default — a reship usually sends them all back.
    setReshipCounts(Object.fromEntries((picked?.lines ?? []).map((line) => [line.restockItemId.toString(), reshipLeft(line).toString()])));
    const keys = new Set((picked?.lines ?? []).map(supplierKey));
    prefill(keys.size === 1 ? picked?.lines[0]?.supplier : undefined);
  }

  function pickSupplier(key: string) {
    setSupplierPick(key);
    prefill(suppliers.find((s) => s.key === key)?.supplier);
  }

  function pick(products: PickedProduct[]) {
    setLines((before) =>
      products.map((p) => before.find((l) => l.productId === p.id) ?? { productId: p.id, productCode: p.productCode, name: p.name, count: "1" }),
    );
  }

  const setCount = (productId: bigint, count: string) =>
    setLines((before) => before.map((l) => (l.productId === productId ? { ...l, count } : l)));

  const sending =
    kind === "SAMPLE"
      ? lines.map((l) => ({ productId: l.productId, productCode: l.productCode, name: l.name, quantity: countOf(l.count), restockItemId: 0n, brokenNote: "" }))
      : reshipLines
          .map((line) => ({
            productId: line.productId,
            productCode: line.productCode,
            name: line.name,
            quantity: countOf(reshipCounts[line.restockItemId.toString()] ?? ""),
            restockItemId: line.restockItemId,
            brokenNote: line.brokenNote,
          }))
          .filter((l) => l.quantity > 0n);
  const pieces = sending.reduce((sum, l) => sum + l.quantity, 0n);
  const overStock = lines.some((l) => {
    const available = availableOf(l.productId);
    return available !== undefined && countOf(l.count) > available;
  });
  const overBroken = reshipLines.some((line) => countOf(reshipCounts[line.restockItemId.toString()] ?? "") > reshipLeft(line));

  // WHAT STILL STANDS BETWEEN THE FORM AND THE PARCEL — in the order the form asks (a-save-button-says-what-it-waits-for).
  const missing: { id: string; label: string }[] = [];
  if (kind === "SAMPLE") {
    if (warehouseId === 0n) missing.push({ id: "warehouse", label: t("customShipment.form.missing.warehouse") });
    if (lines.length === 0) missing.push({ id: "lines", label: t("customShipment.form.missing.lines") });
    if (lines.some((l) => countOf(l.count) === 0n)) missing.push({ id: "count", label: t("customShipment.form.missing.count") });
    if (overStock) missing.push({ id: "stock", label: t("customShipment.form.missing.stock") });
  } else {
    if (restockId === 0n) missing.push({ id: "restock", label: t("customShipment.form.missing.restock") });
    else if (supplierChosen === "") missing.push({ id: "supplier", label: t("customShipment.form.missing.supplier") });
    else if (pieces === 0n) missing.push({ id: "broken", label: t("customShipment.form.missing.broken") });
    if (overBroken) missing.push({ id: "overBroken", label: t("customShipment.form.missing.overBroken") });
  }
  if (recipient.name.trim() === "") missing.push({ id: "name", label: t("customShipment.form.missing.name") });
  if (recipient.phone.trim() === "") missing.push({ id: "phone", label: t("customShipment.form.missing.phone") });
  if (recipient.address.trim() === "") missing.push({ id: "address", label: t("customShipment.form.missing.address") });
  if (courierId === 0n) missing.push({ id: "courier", label: t("customShipment.form.missing.courier") });
  if (payer === "TEAM" && accountId === 0n) missing.push({ id: "account", label: t("customShipment.form.missing.account") });

  function submit() {
    if (teamId === undefined || !prototype) return;

    const created = prototype.create({
      teamId,
      kind,
      warehouseId: kind === "SAMPLE" ? warehouseId : (option?.warehouseId ?? 0n),
      restockId: kind === "SAMPLE" ? 0n : restockId,
      supplierId: kind === "SAMPLE" ? 0n : (chosenSupplier?.id ?? 0n),
      lines: sending,
      recipient: { name: recipient.name.trim(), phone: recipient.phone.trim(), address: recipient.address.trim() },
      shipmentChannelId: courierId,
      payer,
      financeAccountId: payer === "TEAM" ? accountId : 0n,
      shippingCost: payer === "TEAM" && cost !== "" ? Number(cost) : 0,
      note: note.trim(),
    });
    toaster.create({ type: "success", title: t("customShipment.toast.created") });
    navigate(customShipmentPath(created.id));
  }

  const setField = (field: keyof CustomShipmentRecipient) => (value: string) => setRecipient((r) => ({ ...r, [field]: value }));

  return (
    <Stack gap="section" data-testid="custom-shipment-form">
      <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="custom-shipment-form-back" onClick={back}>
        <Icon as={ArrowLeft} boxSize="4" />
        {t("customShipment.form.back")}
      </Button>

      {/* JENIS — the two kinds the owner named; the in-person sample stays on Rack detail. */}
      <Card.Root>
        <Card.Header>
          <Card.Title>{t("customShipment.form.kind")}</Card.Title>
        </Card.Header>
        <Card.Body>
          <Stack gap="2">
            <RadioPills
              value={kind}
              onChange={changeKind}
              ariaLabel={t("customShipment.form.kind")}
              testId="custom-shipment-form-kind"
              options={[
                { value: "SAMPLE", label: t("customShipment.kind.sample"), testId: "custom-shipment-form-kind-sample" },
                { value: "RESTOCK_RESHIP", label: t("customShipment.kind.reship"), testId: "custom-shipment-form-kind-reship" },
              ]}
            />
            <Text fontSize="sm" color="fg.muted" data-testid="custom-shipment-form-kind-hint">
              {t(kind === "SAMPLE" ? "customShipment.form.sampleHint" : "customShipment.form.reshipHint")}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* BARANG */}
      {kind === "SAMPLE" ? (
        <Card.Root data-testid="custom-shipment-form-sample">
          <Card.Header>
            <Card.Title>{t("customShipment.form.goods")}</Card.Title>
          </Card.Header>
          <Card.Body>
            <Stack gap="card">
              <Field.Root required>
                <Field.Label>
                  {t("customShipment.form.warehouse")}
                  <Field.RequiredIndicator />
                </Field.Label>
                <Box w="full" maxW={{ md: "sm" }} data-testid="custom-shipment-form-warehouse">
                  <TeamSelect
                    value={warehouseId > 0n ? warehouseId : undefined}
                    teamType={TeamType.WAREHOUSE}
                    placeholder={t("customShipment.form.warehousePlaceholder")}
                    onChange={changeWarehouse}
                  />
                </Box>
              </Field.Root>

              <Flex align="center" gap="card" wrap="wrap">
                <Text fontWeight="bold" fontSize="sm">
                  {t("customShipment.form.products")}
                </Text>
                <Spacer />
                <OwnStockedProductPicker
                  teamId={teamId}
                  warehouseId={warehouseId}
                  value={lines.map((l) => l.productId)}
                  onChange={pick}
                  disabled={warehouseId === 0n}
                  trigger={
                    <Button size="xs" variant="outline" disabled={warehouseId === 0n} data-testid="custom-shipment-form-pick">
                      <Icon as={Plus} boxSize="4" />
                      {t("customShipment.form.pickProducts")}
                    </Button>
                  }
                />
              </Flex>

              {warehouseId === 0n ? (
                <Text color="fg.muted" data-testid="custom-shipment-form-warehouse-first">
                  {t("customShipment.form.warehouseFirst")}
                </Text>
              ) : lines.length === 0 ? (
                <Text color="fg.muted" data-testid="custom-shipment-form-no-lines">
                  {t("customShipment.form.noLines")}
                </Text>
              ) : (
                <Stack gap="card">
                  {lines.map((line) => {
                    const available = availableOf(line.productId);
                    const over = available !== undefined && countOf(line.count) > available;

                    return (
                      <Flex key={line.productId.toString()} gap="card" align="center" wrap="wrap" data-testid={`custom-shipment-form-line-${line.productId}`}>
                        <Stack gap="0" flex="1" minW="48">
                          <Span fontWeight="medium">{line.name}</Span>
                          <Span fontSize="xs" color="fg.muted">
                            {line.productCode}
                          </Span>
                        </Stack>
                        <Stack gap="0" align="end">
                          <QuantityInput
                            value={line.count}
                            onChange={(v) => setCount(line.productId, v)}
                            min={1}
                            max={available !== undefined ? Number(available) : undefined}
                            testId={`custom-shipment-form-count-${line.productId}`}
                          />
                          <Span fontSize="xs" color={over ? "error.fg" : "fg.muted"} data-testid={`custom-shipment-form-available-${line.productId}`}>
                            {available === undefined
                              ? t("customShipment.form.availableUnknown")
                              : t("customShipment.form.available", { count: available.toString() })}
                          </Span>
                        </Stack>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t("customShipment.form.removeLine")}
                          data-testid={`custom-shipment-form-remove-${line.productId}`}
                          onClick={() => setLines((before) => before.filter((l) => l.productId !== line.productId))}
                        >
                          <Icon as={Trash2} boxSize="4" />
                        </IconButton>
                      </Flex>
                    );
                  })}
                </Stack>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>
      ) : (
        <Card.Root data-testid="custom-shipment-form-reship">
          <Card.Header>
            <Card.Title>{t("customShipment.form.goods")}</Card.Title>
          </Card.Header>
          <Card.Body>
            <Stack gap="card">
              <Field.Root required>
                <Field.Label>
                  {t("customShipment.form.restock")}
                  <Field.RequiredIndicator />
                </Field.Label>
                {options.length === 0 ? (
                  <Text color="fg.muted" data-testid="custom-shipment-form-no-restock">
                    {t("customShipment.form.noRestock")}
                  </Text>
                ) : (
                  <Select.Root
                    collection={restockCollection}
                    value={restockId > 0n ? [restockId.toString()] : []}
                    onValueChange={(e) => e.value[0] && pickRestock(BigInt(e.value[0]))}
                    maxW={{ md: "md" }}
                  >
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger data-testid="custom-shipment-form-restock">
                        <Select.ValueText placeholder={t("customShipment.form.restockPlaceholder")} />
                      </Select.Trigger>
                      <Select.IndicatorGroup>
                        <Select.Indicator />
                      </Select.IndicatorGroup>
                    </Select.Control>
                    <Select.Positioner>
                      <Select.Content>
                        {restockCollection.items.map((item) => (
                          <Select.Item item={item} key={item.value} data-testid={`custom-shipment-form-restock-option-${item.value}`}>
                            <Select.ItemText>{item.label}</Select.ItemText>
                            <Select.ItemIndicator />
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Positioner>
                  </Select.Root>
                )}
                {option && (
                  <Field.HelperText data-testid="custom-shipment-form-restock-facts">
                    {t("customShipment.form.restockFacts", {
                      warehouse: warehouseName(option.warehouseId),
                      date: formatUnixDate(option.acceptedAtUnix),
                    })}
                  </Field.HelperText>
                )}
              </Field.Root>

              {/* ONE PARCEL, ONE SUPPLIER — asked only when the restock's broken lines name several. */}
              {suppliers.length > 1 && (
                <Field.Root required>
                  <Field.Label>
                    {t("customShipment.form.supplier")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  <RadioPills
                    value={supplierPick}
                    onChange={pickSupplier}
                    ariaLabel={t("customShipment.form.supplier")}
                    testId="custom-shipment-form-supplier"
                    options={suppliers.map((s) => ({
                      value: s.key,
                      label: s.supplier?.name ?? t("customShipment.form.noSupplier"),
                      testId: `custom-shipment-form-supplier-${s.key}`,
                    }))}
                  />
                  <Field.HelperText>{t("customShipment.form.supplierHint")}</Field.HelperText>
                </Field.Root>
              )}

              {reshipLines.length > 0 && (
                <Stack gap="card" data-testid="custom-shipment-form-broken-lines">
                  {reshipLines.map((line) => {
                    const key = line.restockItemId.toString();
                    const left = reshipLeft(line);
                    const over = countOf(reshipCounts[key] ?? "") > left;

                    return (
                      <Flex key={key} gap="card" align="center" wrap="wrap" data-testid={`custom-shipment-form-broken-${line.productId}`}>
                        <Stack gap="0" flex="1" minW="48">
                          <Span fontWeight="medium">{line.name}</Span>
                          <Span fontSize="xs" color="fg.muted">
                            {line.productCode}
                            {line.storeName && ` · ${line.storeName}`}
                          </Span>
                          {line.brokenNote && (
                            <Span fontSize="xs" color="fg.muted">
                              {t("customShipment.form.brokenNote", { note: line.brokenNote })}
                            </Span>
                          )}
                        </Stack>
                        <Stack gap="0" align="end">
                          <QuantityInput
                            value={reshipCounts[key] ?? ""}
                            onChange={(v) => setReshipCounts((c) => ({ ...c, [key]: v }))}
                            min={0}
                            max={Number(left)}
                            testId={`custom-shipment-form-broken-count-${line.productId}`}
                          />
                          <Span fontSize="xs" color={over ? "error.fg" : "fg.muted"} data-testid={`custom-shipment-form-broken-left-${line.productId}`}>
                            {line.alreadySent > 0n
                              ? t("customShipment.form.brokenLeftAfterSent", {
                                  count: left.toString(),
                                  broken: line.broken.toString(),
                                  sent: line.alreadySent.toString(),
                                })
                              : t("customShipment.form.brokenLeft", { count: left.toString() })}
                          </Span>
                        </Stack>
                      </Flex>
                    );
                  })}
                </Stack>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>
      )}

      {/* PENERIMA — free text, the label the warehouse writes. A reship's comes from its supplier. */}
      <Card.Root data-testid="custom-shipment-form-recipient">
        <Card.Header>
          <Card.Title>{t("customShipment.form.recipient")}</Card.Title>
          {kind === "RESTOCK_RESHIP" && supplierChosen !== "" && restockId > 0n && (
            <Card.Description data-testid="custom-shipment-form-prefilled">
              {chosenSupplier
                ? chosenSupplier.contact && chosenSupplier.address
                  ? t("customShipment.form.prefilled", { name: chosenSupplier.name })
                  : t("customShipment.form.prefilledPartly", { name: chosenSupplier.name })
                : t("customShipment.form.prefilledNone")}
            </Card.Description>
          )}
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
            <Field.Root required>
              <Field.Label>
                {t("customShipment.form.name")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Input
                value={recipient.name}
                maxLength={200}
                placeholder={t("customShipment.form.namePlaceholder")}
                data-testid="custom-shipment-form-name"
                onChange={(e) => setField("name")(e.target.value)}
              />
            </Field.Root>
            <Field.Root required>
              <Field.Label>
                {t("customShipment.form.phone")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Input
                value={recipient.phone}
                maxLength={50}
                placeholder={t("customShipment.form.phonePlaceholder")}
                data-testid="custom-shipment-form-phone"
                onChange={(e) => setField("phone")(e.target.value)}
              />
            </Field.Root>
            <Field.Root required gridColumn={{ md: "span 2" }}>
              <Field.Label>
                {t("customShipment.form.address")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Textarea
                value={recipient.address}
                maxLength={500}
                rows={2}
                placeholder={t("customShipment.form.addressPlaceholder")}
                data-testid="custom-shipment-form-address"
                onChange={(e) => setField("address")(e.target.value)}
              />
            </Field.Root>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      {/* PENGIRIMAN — the courier, then who pays it. */}
      <Card.Root data-testid="custom-shipment-form-shipping">
        <Card.Header>
          <Card.Title>{t("customShipment.form.shipping")}</Card.Title>
        </Card.Header>
        <Card.Body>
          <Stack gap="card">
            <Field.Root required maxW={{ md: "sm" }}>
              <Field.Label>
                {t("customShipment.form.courier")}
                <Field.RequiredIndicator />
              </Field.Label>
              <ShipmentChannelSelect
                value={courierId > 0n ? courierId : undefined}
                onChange={setCourierId}
                placeholder={t("customShipment.form.courierPlaceholder")}
              />
            </Field.Root>
            <Field.Root required>
              <Field.Label>
                {t("customShipment.form.payer")}
                <Field.RequiredIndicator />
              </Field.Label>
              <RadioPills
                value={payer}
                onChange={setPayer}
                ariaLabel={t("customShipment.form.payer")}
                testId="custom-shipment-form-payer"
                options={[
                  { value: "WAREHOUSE", label: t("customShipment.payer.warehouse"), testId: "custom-shipment-form-payer-warehouse" },
                  { value: "TEAM", label: t("customShipment.payer.team"), testId: "custom-shipment-form-payer-team" },
                ]}
              />
              <Field.HelperText data-testid="custom-shipment-form-payer-hint">
                {t(payer === "WAREHOUSE" ? "customShipment.form.warehousePaysHint" : "customShipment.form.teamPaysHint")}
              </Field.HelperText>
            </Field.Root>
            {payer === "TEAM" && (
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" data-testid="custom-shipment-form-team-pays">
                <Field.Root required>
                  <Field.Label>
                    {t("customShipment.form.account")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  <FinancialAccountSelect
                    teamId={teamId}
                    value={accountId > 0n ? accountId : undefined}
                    onChange={setAccountId}
                    testId="custom-shipment-form-account"
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("customShipment.form.cost")}</Field.Label>
                  <CurrencyInput value={cost} onChange={setCost} data-testid="custom-shipment-form-cost" />
                  <Field.HelperText>{t("customShipment.form.costHint")}</Field.HelperText>
                </Field.Root>
              </SimpleGrid>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      <Field.Root>
        <Field.Label>{t("customShipment.form.note")}</Field.Label>
        <Textarea
          value={note}
          maxLength={1000}
          rows={2}
          placeholder={t("customShipment.form.notePlaceholder")}
          data-testid="custom-shipment-form-note"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field.Root>

      <Card.Root data-testid="custom-shipment-form-summary">
        <Card.Body>
          <Flex gap="card" align="center" wrap="wrap">
            <Stack gap="0">
              <Text fontWeight="bold" data-testid="custom-shipment-form-pieces">
                {t("customShipment.table.itemsSummary", { count: sending.length, pieces: pieces.toString() })}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {t(kind === "SAMPLE" ? "customShipment.form.sampleValueHint" : "customShipment.form.reshipValueHint")}
              </Text>
            </Stack>
            <Spacer />
            <Stack gap="1" align={{ base: "stretch", sm: "end" }}>
              <ReadyLine missing={missing} readyLabel={t("customShipment.form.ready")} testId="custom-shipment-form" />
              <Button colorPalette="brand" disabled={missing.length > 0} data-testid="custom-shipment-form-submit" onClick={submit}>
                <Icon as={Plus} boxSize="4" />
                {t("customShipment.form.submit")}
              </Button>
            </Stack>
          </Flex>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
