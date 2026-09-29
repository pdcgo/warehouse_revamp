import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Icon,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { useTeam } from "../../features/team/TeamContext";
import { useOrder } from "../../features/orders/queries";
import { useActors } from "../../features/users/queries";
import { useTeams } from "../../features/teams/queries";
import { useShopOptions } from "../../features/shops/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { StageBadge } from "../../features/orders/StageBadge";
import { stageOfStatus } from "../../features/orders/stages";
import { TIMELINE_TITLE, timelineKindSlug } from "./components/TimelinePanel";
import { SettlementTab } from "./components/SettlementTab";
import { ReceiptFile } from "./components/ReceiptCard";
import type { OrderAddress } from "../../gen/warehouse/selling/v1/order_pb";
import { ProductListItem } from "../../components/products/ProductListItem";
import { CustomerLineItem } from "../../components/customers/CustomerLineItem";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import { mockDeadline } from "../orders/deadlineMock";
import { mockReceiptCode } from "../orders/rowMock";
import { DeadlineCell } from "../orders/components/OrderRowCells";
import { Fact, Section, SectionEmpty } from "./components/Section";
import { OrderActionBar } from "./components/OrderActionBar";
import { SectionNav } from "./components/SectionNav";
import { sectionDomId, sectionIcon } from "./sections";
import type { SectionKey } from "./sections";
import { useScrollSpy } from "./useScrollSpy";
import { useIsMobile } from "../../layouts/shell";
import { MoneyBreakdown } from "./components/MoneyBreakdown";
import { ORDER_DETAIL_PENDING } from "./pending";
import { mockWithdrawals } from "./withdrawalMock";
import { formatMarginPct } from "../../features/orders/margin";
import { mockExternalName, mockOutboundTrail, mockReturnLeg } from "./shipmentMock";
import { ShipmentLeg } from "./components/ShipmentLeg";
import { ScrapedName } from "./components/ScrapedName";
import { OrderReferences } from "./components/OrderReferences";
import { NotesSection } from "./components/NotesSection";
import { mockNotes } from "./notesMock";
import { Rail } from "./components/Rail";
import { StageStepper } from "./components/StageStepper";
import { SummaryTiles } from "./components/SummaryTiles";
import { CopyText } from "../orders/components/CopyText";

// THE SELLER'S ORDER DETAIL — the owner's page of sections, approved as a preview and now routed at
// `/orders/:orderId` for every team that is not a warehouse (the picker is `index.tsx`).
//
// Sections down one page: info, notes, items (with the money derived under them), timeline, shipping,
// recipient, settlement, withdrawal. The warehouse's page files its facts under three TABS; the
// difference is argued in `components/Section.tsx`.
//
// ⚠ WHAT IS REAL AND WHAT IS NOT is the pending list (`pending.ts`), and every entry has its ⚠ on
// screen. Two wired features came across from the page this replaced so that applying the preview took
// nothing away: the settlement ledger, and the uploaded receipt document.

function parseOrderId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/** The frozen address as lines — street, region narrowest first, kode pos — or nothing at all. */
function addressLines(address: OrderAddress | undefined) {
  const region = [address?.desaName, address?.kecamatanName, address?.kabupatenName, address?.provinsiName]
    .filter((part) => part)
    .join(", ");
  const lines = [address?.addressLine ?? "", region, address?.kodePos ?? ""].filter((line) => line !== "");

  if (lines.length === 0) {
    return undefined;
  }

  return (
    <Stack gap="0" data-testid="order-detail-address">
      {lines.map((line) => (
        <Text key={line} fontSize="sm">
          {line}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * The sections that live in the MAIN column when there is a side one — and so the only ones scrolling
 * lights. Info is NOT among them even though it opens the page: it tops the side column at the same
 * height as Items, so it would tie with Items and win for the whole of the items card. Before anything
 * has passed the line the spy falls back to the first section, which is Info anyway.
 */
const MAIN_COLUMN: SectionKey[] = ["items", "timeline", "shipping", "settlement", "withdrawal"];

export function SellerOrderDetailPage() {
  const { t } = useTranslation();
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

  const id = parseOrderId(orderId);
  const teamId = current?.teamId;

  const query = useOrder({ teamId, orderId: id });
  const order = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  // The people on the timeline. The ids come from the EVENTS — the order row records no actor at all.
  const actors = useActors(order?.events.map((event) => event.actorUserId) ?? []);

  // The selling team's name, for the items table's Team column. One batched read.
  const teamOptions = useTeams({ page: 1, pageSize: 200, reference: true });
  const teamName =
    teamOptions.data?.teams.find((team) => team.id === order?.teamId)?.name ?? "";

  // The fulfilling warehouse BY NAME — it is a team, so the same lookup. An id with no name still says
  // something ("Gudang #14"), where a blank would read as an order with no warehouse.
  const warehouseName =
    order && order.warehouseId > 0n
      ? (teamOptions.data?.teams.find((team) => team.id === order.warehouseId)?.name ??
        t("orderDetail.info.warehouseRef", { id: order.warehouseId.toString() }))
      : undefined;

  // ⚠ THE MARKETPLACE IS THE SHOP'S, NOT THE ORDER'S. An order records which shop sold it; which
  // storefront that shop is on lives on the Shop. Same lookup the list uses for its Toko column.
  const shopOptions = useShopOptions({ teamId: order?.teamId ?? 0n });
  const shop = shopOptions.data?.find((item) => item.id === order?.shopId);

  // ── The layout's own state. All of it before the early returns: hooks may not be conditional.
  const mobile = useIsMobile();
  // The side column only where there is room for it beside the nav: Chakra's `xl`.
  const wide = useBreakpointValue({ base: false, xl: true }) ?? false;

  // THE STICKY HEADER'S HEIGHT, measured and published as `--order-header-h`. The sections' scroll
  // margin and the nav's sticky offset both read it, so a jump lands the title just below the header
  // however tall the header has grown — it gains a line when the action buttons wrap, and on a phone
  // it carries the section chips too.
  const header = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  const { active, scrollTo } = useScrollSpy(order !== null, header, wide ? MAIN_COLUMN : undefined);

  useEffect(() => {
    const el = header.current;

    if (!el) {
      return;
    }

    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(el);

    return () => observer.disconnect();
  }, [order !== null, mobile]);

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  // ⚠ AN ORDER THIS TEAM MAY NOT READ IS "NOT FOUND", and a malformed id never reaches the server —
  // both carried over from the page this replaced. The way back stays: a dead end with no back button
  // is how somebody gets stuck on a URL they mistyped.
  if (!order) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="order-detail-back"
          onClick={() => navigate("/orders")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("orders.backToOrders")}
        </Button>
        <Text color="fg.muted" data-testid="order-detail-error">
          {id === 0n ? t("orders.invalidOrderId") : t("orders.orderNotFound")}
        </Text>
      </Stack>
    );
  }

  const stage = stageOfStatus(order.status);
  const deadline = mockDeadline(order.id, order.status);
  const receiptCode = mockReceiptCode(order.id, order.status);
  const withdrawals = mockWithdrawals(order.id, order.createdAtUnix, order.marketplaceTotal);
  // What came in, and what was taken back — the two halves the old system reported per order.
  const wdIn = withdrawals.filter((row) => row.amount > 0n).reduce((sum, row) => sum + row.amount, 0n);
  const wdAdjust = withdrawals.filter((row) => row.amount < 0n).reduce((sum, row) => sum + row.amount, 0n);
  const outboundTrail = mockOutboundTrail(order.id, order.status, order.createdAtUnix);
  const returnLeg = mockReturnLeg(order.id, order.createdAtUnix);

  // ⚠ THE COST SIDE, summed off the lines — see `MoneyBreakdown` for why this is what "total produk"
  // means. A line with no recorded cost contributes nothing, and the panel then refuses rather than
  // showing a total that quietly left a product out.
  const productCost = order.items.reduce(
    (sum, item) => sum + item.unitCost * BigInt(item.quantity),
    0n,
  );
  const anyCostMissing = order.items.some((item) => item.unitCost <= 0n);

  // ⚠ SAMPLE, and the same figure the list's Beli column adds. Flat per order, matching `mockTerms`
  // on the order form, so the three screens do not each invent a different fee.
  const fees = BigInt(2000 + (Number(order.id) % 5) * 500);

  // ── The sections, built once and placed by the layout below.
  // ── 1. INFO ORDER — the facts the create form asked for, read back ────────────────────────
  const infoSection = (
    <Section title={t("orderDetail.info.title")} id={sectionDomId("info")}
      icon={sectionIcon("info")}
      testId="section-info">
      <Stack gap="card">
        {/* THE REFERENCES FIRST — the resi and the marketplace id, the two numbers somebody opened
            this page to carry elsewhere. In the first card rather than the sticky header (owner:
            *"jangan di sticky"*), so they are read on arrival and scroll away. */}
        <OrderReferences
          courier={order.shippingCode}
          receiptCode={receiptCode}
          orderRefId={order.orderExternalRefId}
          returnLeg={returnLeg}
        />

        <Separator />

        <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="card">
          <Fact label={t("orders.team")}>{teamName}</Fact>
          <Fact label={t("orders.marketplace")}>
            {shop ? <MarketplaceBadge marketplace={shop.marketplace} size="sm" /> : undefined}
          </Fact>
          <Fact label={t("orderDetail.info.createdAt")}>{formatUnixDateTime(order.createdAtUnix)}</Fact>
          <Fact label={t("orders.warehouse")}>{warehouseName}</Fact>
          {/* THE RECEIPT DOCUMENT — real, uploaded on the order form and opened through a signed URL.
              Carried over from the page this replaced: the resi CODE above is still a sample, but the
              slip itself is not, and the seller's page must not lose it. */}
          {order.receipt?.documentId ? (
            <Fact label={t("orders.receipt")} full>
              <ReceiptFile order={order} teamId={teamId} />
            </Fact>
          ) : null}
        </SimpleGrid>
      </Stack>
    </Section>
  );

  // ── CATATAN — several notes, two kinds, the person's ones editable ───────────────────────
  // Second, right after Info: a note is usually an instruction to the people packing, and it is
  // read before the lines it is about. `key` resets the local list when the order changes.
  const notesSection = (
    <Section
      title={t("orderDetail.notes.title")}
      id={sectionDomId("notes")}
      icon={sectionIcon("notes")}
      testId="section-notes"
      marks={<NotImplemented list={ORDER_DETAIL_PENDING} id="notes" />}
    >
      <NotesSection
          key={order.id.toString()}
          initial={mockNotes(order)}
          addMark={<NotImplemented list={ORDER_DETAIL_PENDING} id="notes" />}
        />
    </Section>
  );

  // ── 2. ORDER ITEMS, with the money derived under them ─────────────────────────────────────
  const itemsSection = (
    <Section
      title={t("orderDetail.items.title")}
      id={sectionDomId("items")}
      icon={sectionIcon("items")}
      testId="section-items"
    >
      <Stack gap="card">
        {order.items.length === 0 ? (
          <SectionEmpty>{t("orderDetail.items.empty")}</SectionEmpty>
        ) : (
          <Box overflowX="auto" maxW="full">
            {/* ⚠ ITS OWN SCROLL BOX. A table is the one thing allowed to be wider than a phone, and
                only inside its own container — unwrapped, this one pushed the whole page sideways. */}
            <Table.Root size="sm" data-testid="order-items-table">
              <Table.Header>
                <Table.Row>
                  {/* The picture and the marketplace's title both live in this column, so their marks do. */}
                  <Table.ColumnHeader>
                    <Flex gap="1" align="center">
                      {t("orders.product")}
                      <NotImplemented list={ORDER_DETAIL_PENDING} id="productImage" />
                      <NotImplemented list={ORDER_DETAIL_PENDING} id="externalName" />
                    </Flex>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orders.team")}</Table.ColumnHeader>
                  {/* ⚠ HARGA BELI, not the selling price — see `MoneyBreakdown`. */}
                  <Table.ColumnHeader textAlign="end">{t("orderDetail.items.unitCost")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("orders.qty")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("orders.lineTotal")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
  
              <Table.Body>
                {order.items.map((item, index) => (
                  <Table.Row key={item.id.toString()} data-testid={`order-item-${item.id}`}>
                    <Table.Cell>
                      <ScrapedName evidence={mockExternalName(order.orderExternalRefId, item.name, index)} />
                      {/* ⚠ NO PICTURE ON THE WIRE. `OrderItem` carries sku and name; the cover lives on
                          `Product`, so this renders the placeholder until the page batches a
                          `ProductByIds`. The component already draws one rather than a gap. */}
                      <ProductListItem
                        product={{ id: item.productId, sku: item.sku, name: item.name }}
                      />
                    </Table.Cell>
                    <Table.Cell>{teamName || "—"}</Table.Cell>
                    <Table.Cell textAlign="end" whiteSpace="nowrap">
                      {item.unitCost > 0n ? formatRupiah(item.unitCost) : "—"}
                    </Table.Cell>
                    <Table.Cell textAlign="end">{item.quantity}</Table.Cell>
                    <Table.Cell textAlign="end" whiteSpace="nowrap">
                      {item.unitCost > 0n
                        ? formatRupiah(item.unitCost * BigInt(item.quantity))
                        : "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        )}

        {/* ⚠ A LINE WITH NO RECORDED COST MAKES THE WHOLE DERIVATION UNSAFE, so it is said here
            rather than left for the reader to notice that a total looks small. */}
        {anyCostMissing && (
          <Text fontSize="xs" color="warning.fg" data-testid="order-cost-missing">
            {t("orderDetail.items.costMissing")}
          </Text>
        )}

        <MoneyBreakdown
          productCost={anyCostMissing ? 0n : productCost}
          fees={fees}
          marketplaceTotal={order.marketplaceTotal}
        />
      </Stack>
    </Section>
  );

  // ── 3. TIMELINE — when the status changed, and who changed it ─────────────────────────────
  const timelineSection = (
    <Section
      title={t("orderDetail.timeline.title")}
      id={sectionDomId("timeline")}
      icon={sectionIcon("timeline")}
      testId="section-timeline"
      marks={<NotImplemented list={ORDER_DETAIL_PENDING} id="statusSet" />}
    >
      {order.events.length === 0 ? (
        <SectionEmpty>{t("orderDetail.timeline.empty")}</SectionEmpty>
      ) : (
        // THE SAME RAIL AS THE COURIER TRAIL, newest first — a sequence of moments is drawn one way
        // on this page. The event names are the built timeline's own map (`TIMELINE_TITLE`), and an
        // actor of 0 is "not recorded", so it names nobody rather than inventing one.
        <Rail
          testId="timeline-rail"
          items={[...order.events].reverse().map((event) => {
            const who = actors.data?.get(event.actorUserId.toString())?.name ?? "";

            return {
              key: event.id.toString(),
              testId: `order-timeline-${timelineKindSlug(event.kind)}`,
              title: t(TIMELINE_TITLE[event.kind] ?? "orders.timeline.unknown"),
              meta: who
                ? `${formatUnixDateTime(event.atUnix)} · ${who}`
                : formatUnixDateTime(event.atUnix),
            };
          })}
        />
      )}
    </Section>
  );

  // ── 4. PENGIRIMAN — and it is usually empty, on purpose ───────────────────────────────────
  const shippingSection = (
    <Section
      title={t("orderDetail.shipping.title")}
      id={sectionDomId("shipping")}
      icon={sectionIcon("shipping")}
      testId="section-shipping"
    >
      {/* TWO LEGS, ONE SHAPE (owner: *"resi bisa 2 dan jejak pengiriman juga bisa 2, dari order dan
          return"*). Out to the buyer, and back from them under a different number. The return leg is
          absent on almost every order, so it says so in one line rather than drawing an empty frame. */}
      {/* SIDE BY SIDE on a wide screen: two legs of the same shape read as a pair, out and back. */}
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="section">
        <ShipmentLeg
          title={t("orderDetail.shipping.outbound")}
          courier={order.shippingCode}
          receiptCode={receiptCode}
          extra={{
            label: t("orderDetail.shipping.deadline"),
            value: deadline !== undefined ? formatUnixDateTime(deadline) : undefined,
            mark: <NotImplemented list={ORDER_DETAIL_PENDING} id="deadline" />,
          }}
          trail={outboundTrail}
          receiptMark={<NotImplemented list={ORDER_DETAIL_PENDING} id="receiptCode" />}
          trailMark={<NotImplemented list={ORDER_DETAIL_PENDING} id="shippingTracking" />}
          testId="shipment-outbound"
        />

        {returnLeg ? (
          <ShipmentLeg
            title={t("orderDetail.shipping.return")}
            courier={returnLeg.courier}
            receiptCode={returnLeg.receiptCode}
            trail={returnLeg.trail}
            titleMark={<NotImplemented list={ORDER_DETAIL_PENDING} id="returnShipment" />}
            receiptMark={<NotImplemented list={ORDER_DETAIL_PENDING} id="returnShipment" />}
            trailMark={<NotImplemented list={ORDER_DETAIL_PENDING} id="shippingTracking" />}
            testId="shipment-return"
          />
        ) : (
          <Stack gap="1" data-testid="shipment-return-none">
            <Flex gap="1" align="center">
              <Text fontWeight="bold" fontSize="sm">
                {t("orderDetail.shipping.return")}
              </Text>
              {/* "No return" is itself a guess: there is no return record to say otherwise. */}
              <NotImplemented list={ORDER_DETAIL_PENDING} id="returnShipment" />
            </Flex>
            <SectionEmpty>{t("orderDetail.shipping.noReturn")}</SectionEmpty>
          </Stack>
        )}
      </SimpleGrid>
    </Section>
  );

  // ── 5. PENERIMA ───────────────────────────────────────────────────────────────────────────
  const recipientSection = (
    <Section title={t("orderDetail.recipient.title")} id={sectionDomId("recipient")}
      icon={sectionIcon("recipient")}
      testId="section-recipient">
      {/* `OrderAddress` has no name field, so the buyer and the recipient are the same person here —
          the same reading the list's Penerima column had before it came off the row. */}
      <Stack gap="card">
        <CustomerLineItem name={order.customerName} phone="" testId={order.id} />
        {/* The number is something you ACT on — paste into WhatsApp, dial — so it is a copy
            button rather than text beside the name. */}
        <Fact label={t("orders.phone")}>
          {order.customerPhone ? <CopyText value={order.customerPhone} /> : undefined}
        </Fact>
        {/* ⚠ THE WHOLE ADDRESS, street and kode pos included, and never clamped — the one-line region
            summary a list uses drops the street, which is the part a parcel cannot go without. */}
        <Fact label={t("orders.address")}>{addressLines(order.address)}</Fact>
      </Stack>
    </Section>
  );

  // ── 6. WITHDRAWAL & PENYESUAIAN — the section the owner is undecided about ─────────────────
  // ── SETTLEMENT — the real ledger, carried over from the page this replaced ───────────────────────────
  // ⚠ IT IS WIRED AND THE WITHDRAWAL SECTION IS NOT. The built page had it as a tab
  // (`order-detail-manages-the-ledger`), reading `OrderSettlement` and posting entries for real; the
  // approved preview had only the invented withdrawal table. Applying the preview without it would have
  // taken a working feature off the seller's order page — so it comes across as a section, and whether
  // "withdrawal & penyesuaian" IS this ledger stays the open question it was, now with both on screen.
  //
  // The four values passed down are the ones settlement is forbidden to know — it never sees the
  // marketplace reference, and the names and cogs belong to selling_service.
  const settlementSection = (
    <Section
      title={t("orderDetail.settlement.title")}
      id={sectionDomId("settlement")}
      icon={sectionIcon("settlement")}
      testId="section-settlement"
    >
      <SettlementTab
        orderId={order.id}
        shopId={order.shopId}
        orderRef={order.orderExternalRefId || String(order.id)}
        cogs={order.cogs}
      />
    </Section>
  );

  const withdrawalSection = (
    <Section
      title={t("orderDetail.withdrawal.title")}
      id={sectionDomId("withdrawal")}
      icon={sectionIcon("withdrawal")}
      testId="section-withdrawal"
      marks={<NotImplemented list={ORDER_DETAIL_PENDING} id="withdrawal" />}
    >
      <Stack gap="card">
        {withdrawals.length === 0 ? (
          <SectionEmpty>{t("orderDetail.withdrawal.empty")}</SectionEmpty>
        ) : (
          <Box overflowX="auto" maxW="full">
            {/* ⚠ ITS OWN SCROLL BOX. A table is the one thing allowed to be wider than a phone, and
                only inside its own container — unwrapped, this one pushed the whole page sideways. */}
            <Table.Root size="sm" data-testid="withdrawal-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("orderDetail.withdrawal.withdrawnAt")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderDetail.withdrawal.importedAt")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderDetail.withdrawal.source")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("orderDetail.withdrawal.amount")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderDetail.withdrawal.foreign")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderDetail.withdrawal.description")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
  
              <Table.Body>
                {withdrawals.map((row) => (
                  <Table.Row key={row.id} data-testid={`withdrawal-${row.id}`}>
                    <Table.Cell whiteSpace="nowrap">{formatUnixDateTime(row.withdrawnAt)}</Table.Cell>
                    <Table.Cell whiteSpace="nowrap">{formatUnixDateTime(row.importedAt)}</Table.Cell>
                    <Table.Cell>{row.source}</Table.Cell>
                    {/* ⚠ A NEGATIVE ROW IS MONEY GOING BACK, which is what most penyesuaian are — so it
                        is coloured as a loss rather than printed as a smaller positive. */}
                    <Table.Cell
                      textAlign="end"
                      whiteSpace="nowrap"
                      color={row.amount < 0n ? "error.fg" : undefined}
                    >
                      {formatRupiah(row.amount)}
                    </Table.Cell>
                    <Table.Cell>{row.foreign || "—"}</Table.Cell>
                    <Table.Cell>{row.description}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        )}

        {/* THE WD FIGURES THE OLD SYSTEM SHOWED PER ORDER — nilai withdrawal, penyesuaian, and what
            arrived as a share of the marketplace total (owner: *"wd dan sebagainya"*). Summed from the
            rows above, so they are exactly as invented as the rows, and carry the same mark. */}
        {withdrawals.length > 0 && (
          <SimpleGrid minChildWidth="9rem" gap="card" data-testid="withdrawal-summary">
            <Fact
              label={t("orderDetail.withdrawal.total")}
              mark={<NotImplemented list={ORDER_DETAIL_PENDING} id="withdrawal" />}
            >
              {formatRupiah(wdIn)}
            </Fact>
            <Fact label={t("orderDetail.withdrawal.adjustments")}>
              <Text as="span" color={wdAdjust < 0n ? "error.fg" : undefined}>
                {formatRupiah(wdAdjust)}
              </Text>
            </Fact>
            <Fact label={t("orderDetail.withdrawal.net")}>{formatRupiah(wdIn + wdAdjust)}</Fact>
            <Fact label={t("orderDetail.withdrawal.ofMp")}>
              {order.marketplaceTotal > 0n
                ? formatMarginPct(Number(((wdIn + wdAdjust) * 1000n) / order.marketplaceTotal) / 10)
                : undefined}
            </Fact>
          </SimpleGrid>
        )}

        <Text fontSize="xs" color="fg.muted" data-testid="withdrawal-question">
          {t("orderDetail.withdrawal.question")}
        </Text>
      </Stack>
    </Section>
  );

  return (
    <Stack
      gap="section"
      data-testid="order-detail-page"
      style={{ ["--order-header-h" as string]: `${headerHeight}px` }}
    >
      {/* THE HEADER IS THE ORDER ITSELF — its number, where it has got to, when it must be out, and
          what can be done to it — and it STAYS while the sections scroll under it. On a long page the
          actions were otherwise gone after the first card, which is the thing somebody came to do.

          ⚠ ITS BACKGROUND IS OPAQUE, or the sections scroll visibly through it. */}
      <Box
        ref={header}
        position="sticky"
        top="0"
        zIndex={10}
        bg="bg"
        py="3"
        borderBottomWidth="1px"
        borderColor="border"
        data-testid="order-detail-header"
      >
        <Stack gap="3">
          <Flex align="center" gap="card" wrap="wrap">
            <Button
              size="xs"
              variant="ghost"
              data-testid="order-detail-back"
              onClick={() => navigate("/orders")}
            >
              <Icon as={ArrowLeft} boxSize="4" />
              {mobile ? null : t("orders.backToOrders")}
            </Button>
            {/* The number is the thing people QUOTE — in a chat, to a colleague, in a complaint — so the
                title copies it (just the number, without "Pesanan"). */}
            <Heading size="md" data-testid="order-detail-title">
              <Flex gap="1.5" align="center">
                {t("orders.orderTitleLabel")}
                <CopyText value={`#${order.id.toString()}`} fontSize="lg" />
              </Flex>
            </Heading>
            {stage && <StageBadge stage={stage} />}
            {/* ⚠ THE DEADLINE IS INVENTED, so its mark rides beside it — in the header, where it is most
                prominent, not only on the shipping card further down. */}
            {deadline !== undefined && (
              <Flex gap="1" align="center">
                <DeadlineCell unix={deadline} />
                <NotImplemented list={ORDER_DETAIL_PENDING} id="deadline" />
              </Flex>
            )}
            <Spacer />
            {/* Buttons, not a kebab — see `OrderActionBar`. The same per-status table as the list. */}
            <Flex gap="1" align="center">
              <OrderActionBar
                teamId={teamId}
                orderId={order.id}
                status={order.status}
                stage={stage?.id}
                warehouseId={order.warehouseId}
                compact={mobile}
              />
              {/* The life of an order past "shipped" has no RPCs — retur, selesai, lost, sengketa. Marked
                  here always, like every other gap, not only when this order happens to offer one. */}
              <NotImplemented list={ORDER_DETAIL_PENDING} id="lifecycle" />
            </Flex>
          </Flex>

          {/* On a phone the navigation lives IN the sticky block, as chips — there is no left. */}
          {mobile && <SectionNav compact active={active} onSelect={scrollTo} />}
        </Stack>
      </Box>

      <NotImplementedSummary list={ORDER_DETAIL_PENDING} />

      {/* ① WHERE THE ORDER IS, as a picture — under the header, not in it (owner: *"jangan di sticky"*),
          so the sticky block stays one line. */}
      <Flex gap="2" align="flex-start">
        <Box flex="1" minW="0">
          <StageStepper stage={stage} />
        </Box>
        {/* "Selesai" is a step no order can reach until the enum grows past the old six. */}
        <NotImplemented list={ORDER_DETAIL_PENDING} id="statusSet" />
      </Flex>

      {/* ② FOUR NUMBERS TO LAND ON — the answer before the working. */}
      <SummaryTiles
        marketplaceTotal={order.marketplaceTotal}
        productCost={anyCostMissing ? 0n : productCost}
        fees={fees}
        itemCount={order.items.reduce((sum, item) => sum + item.quantity, 0)}
      />

      {/* TWO COLUMNS ON A DESKTOP: the navigation, then the sections.

          ⚠ `minmax(0, 1fr)`, NOT `1fr`. A grid track's minimum is `auto` — the width of its widest
          child — so a wide table would push the whole column past the screen instead of scrolling in
          its own box. ⚠ And `alignItems="start"`, or the nav's cell stretches to the full height of
          the sections and `position: sticky` has nothing to stick within. */}
      <Grid
        templateColumns={mobile ? "minmax(0, 1fr)" : "13rem minmax(0, 1fr)"}
        gap="section"
        alignItems="start"
      >
        {!mobile && (
          <Box position="sticky" top="calc(var(--order-header-h, 0px) + 1rem)">
            <SectionNav active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* ③ MAIN + SIDE ON A WIDE SCREEN. The work — the lines and their money, the journey, the parcel,
            the settlement — in the main column; the reference facts — the numbers people copy, the
            notes, the recipient — as compact cards beside it. Two card widths instead of seven identical
            ones. Narrower than that, one column in the nav's own order.

            ⚠ A JS BRANCH, not CSS columns with reordering: the same card must not exist twice, and a
            grid would line the two columns' rows up and leave holes under the short side cards. */}
        {wide ? (
          <Stack gap="section" minW="0">
            {/* ⚠ INFO SPANS BOTH COLUMNS (owner: *"info order terlalu kecil dan compact"*). In the 20rem side
                column the two references and four facts were squeezed into a strip; it is the order's
                identity — the numbers people copy — and it gets the full width above the split. */}
            {infoSection}
            <Grid templateColumns="minmax(0, 1fr) 20rem" gap="section" alignItems="start" minW="0">
              <Stack gap="section" minW="0">
                {itemsSection}
                {timelineSection}
                {shippingSection}
                {settlementSection}
                {withdrawalSection}
              </Stack>
              <Stack gap="section" minW="0">
                {notesSection}
                {recipientSection}
              </Stack>
            </Grid>
          </Stack>
        ) : (
          <Stack gap="section" maxW="5xl" minW="0" w="full">
            {infoSection}
            {notesSection}
            {itemsSection}
            {timelineSection}
            {shippingSection}
            {recipientSection}
            {settlementSection}
            {withdrawalSection}
          </Stack>
        )}
      </Grid>
    </Stack>
  );
}
