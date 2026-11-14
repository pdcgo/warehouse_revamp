import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Box, Button, Grid, Heading, Icon, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { rpcError } from "../../api/clients";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamDetail } from "../../features/teams/queries";
import { useRestockRequest } from "../../features/restock/queries";
import { shortfall } from "../../features/restock/summary";
import { CourierChargeFacts, DeliveryFacts } from "../../features/restock/RestockFacts";
import { RestockNotes } from "../../features/restock/RestockNotes";
import { RestockTimeline } from "../../features/restock/RestockTimeline";
import { RestockTitleRow } from "../../features/restock/RestockTitleRow";
import { WarehouseRestockActions } from "../../features/restock/WarehouseRestockActions";
import { type RestockSectionKey, restockSection, restockSectionDomId } from "../../features/restock/sections";
import { SIDE_COLUMN, useSideBySide } from "../../features/restock/sideBySide";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ProductStickyStrip } from "../../features/products/ProductTitleRow";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { Section } from "../../components/chrome/DetailSection";
import { SectionNav } from "../../components/chrome/SectionNav";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { useIsMobile } from "../../layouts/shell";
import { useScrollSpy } from "../../lib/useScrollSpy";
import { useStickyTitle } from "../../lib/useStickyTitle";
import { LinesCard } from "./components/LinesCard";
import { RESTOCK_WAREHOUSE_DETAIL_PENDING } from "./pending";

// The warehouse's sections, in its own order (the-restock-page-leads-with-the-box): the box, then the info about it.
// No Pembayaran (the-warehouse-reads-the-box-not-the-purchase).
// The Ongkir COD it paid is a fact in Kiriman, not a section (the-warehouse-sees-the-ongkir-it-paid).
const WAREHOUSE_ORDER: RestockSectionKey[] = ["products", "delivery", "note", "timeline"];

// THE PRODUCTS CARD AT ITS NARROWEST (the-delivery-card-stacks-when-the-page-is-narrow) — the lines table's min-content,
// 660px on 503 counted in (its places, a broken row's worth and note — LinesCard holds no cell wider than its words must,
// backlog #48), plus the card's padding and border (50). Where the page area holds less than this + the gap + Kiriman's
// 20rem, Kiriman goes below the products. A column added to LinesCard widens it: measure again in the live story
// (`table.style.width = "min-content"` on `restock-detail-items`) and pin it in stories/Layout.stories.tsx.
const PRODUCTS_FLOOR_PX = 710;

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// RestockWarehouseDetailPage — ONE DELIVERY AS THE RECEIVING WAREHOUSE SEES IT.
//
// The warehouse owns the two acts at its door (the-warehouse-signs-and-accepts-the-team-does-the-rest): it SIGNS for the
// box (ongoing → arrived, or a lost parcel that turned up, lost → arrived — a-late-lost-box-is-signed-for-as-arrived) and
// ACCEPTS it (ongoing or arrived → accepted). Those are the title row's actions, with Print Labels and Receipt once it is
// counted in. Everything else about the restock is the selling team's, and is only read here.
//
// THE SCREEN RULES, AND THE SELLING PAGE'S SHAPE (owner: *"inisiasi untuk detail restok warehouse"*,
// the-warehouse-restock-detail-follows-the-screen-rules) — the two sides of one restock read alike:
//
//   ┌ Kiriman      ┐   ←  JNE0123456789 ⧉  [Dalam Perjalanan]                    [⊡ Tandai Tiba] [✓ Terima]
//   │ Kiriman      │   ┌ Produk ── the cards, the lines ──────────────────────┐   ┌ Kiriman ── Dari · Kurir ·   ┐
//   │              │                                                            │   Ongkir COD · Foto label · … ┘
//   │              │   ┌ Produk ── picture, the count, the places ─────────────┐
//   │ Produk       │   ┌ Catatan ── the selling team's, read · this warehouse's, written ┐
//   │ Catatan      │   ┌ Riwayat                                                 ┐
//   └ Riwayat      ┘
//
// ONE PAGE OF SECTIONS, the nav on the left (Section, SectionNav, useScrollSpy); the title row sticks once it scrolls
// away; on a phone the chips stick at the top, the actions are their icons and each line is a block. The TITLE is the
// tracking number — what finds the box at the door — never the order id.
//
// NOT HERE: which account paid, the order id, the supplier, the goods' price and the restock's total
// (the-warehouse-reads-the-box-not-the-purchase). They are the selling team's purchase, and nothing at the door turns on
// them — and its accounts are not readable from the warehouse (FinancialAccountByIds is scoped to the owning team).
export function RestockWarehouseDetailPage() {
  const { t } = useTranslation();
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const isMobile = useIsMobile();

  const id = parseRequestId(requestId);
  const teamId = current?.teamId;

  const query = useRestockRequest({ teamId, requestId: id });

  const request = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  const error = id === 0n ? t("restock.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  const requestingTeamId = request?.requestingTeamId ?? 0n;

  // Who the goods are coming FROM. TeamDetail is unscoped, so the name resolves for either side.
  const requester = useTeamDetail({ teamId: requestingTeamId, enabled: requestingTeamId > 0n });

  // ── The layout's own state, before the early returns: hooks may not be conditional. ─────────────────────────────
  // NO PEMBAYARAN (owner: *"harga barang dan totalnya juga tidak perlu"*, the-warehouse-reads-the-box-not-the-purchase) —
  // the goods' price and the restock's total are the selling team's purchase; the warehouse's own money is the courier's
  // charge it paid, a fact in Kiriman.
  const accepted = request?.status === RestockRequestStatus.ACCEPTED;
  // THE BOX FIRST (owner: *"karena ini gudang, produk taruh atas, lalu info ada di kanan"*,
  // the-restock-page-leads-with-the-box) — what is in it leads, then where it came from; the nav follows that order.
  const keys = WAREHOUSE_ORDER;
  // The info on the right only where the PAGE AREA holds it beside the products (owner: *"A"*,
  // the-delivery-card-stacks-when-the-page-is-narrow) — measured on the main column, never the viewport's `xl`, which
  // ignores the sidebar: at 1440 with the sidebar open the products would get 521px for a table of ≈660.
  const [areaRef, wide] = useSideBySide<HTMLDivElement>(PRODUCTS_FLOOR_PX);
  const stick = useStickyTitle(request !== null, isMobile);
  const { active, scrollTo } = useScrollSpy(
    request !== null,
    stick.bar,
    keys,
    restockSectionDomId,
    wide ? keys.filter((key) => key !== "delivery") : undefined,
  );
  const navSections = keys.map((key) => {
    const entry = restockSection(key);
    return { key, label: t(entry.titleKey), icon: entry.icon };
  });

  const back = () => navigate("/inventories/restock");

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.detail.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-detail-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // The first load shows the page's shape (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={3} testId="restock-detail-loading" />;
  }

  if (error || !request || teamId === undefined) {
    return (
      <Stack gap="section">
        <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="restock-detail-back" onClick={back}>
          <Icon as={ArrowLeft} boxSize="4" />
          {t("restock.detail.back")}
        </Button>
        <Text color="error.fg" data-testid="restock-detail-error">
          {error || t("restock.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  // Missing units are a fact about the whole delivery, so they sit in the title row. 0 until accepted.
  const missing = shortfall(request);
  const fromName = requester.data?.name || t("restock.teamRef", { id: request.requestingTeamId.toString() });

  // The sign dialog's courier charge is typed and not kept (the-cod-can-be-noted-when-the-box-arrives).
  const codMark = <NotImplemented list={RESTOCK_WAREHOUSE_DETAIL_PENDING} id="arrivalCod" />;

  // ── THE TITLE ROW — back, the tracking number, the status, and the acts at the door held to the right. ONE builder,
  // drawn twice: as the page's title, and as the sticky bar once that title has scrolled behind it. ───────────────────
  const titleRow = (stuck: boolean) => (
    <RestockTitleRow
      stuck={stuck}
      request={request}
      withOrderId={false}
      backLabel={t("restock.detail.back")}
      onBack={back}
      titleRef={stick.title}
      badges={
        <>
          <Box flexShrink={0} data-testid={stuck ? undefined : "restock-detail-status"}>
            <RestockStatusBadge status={request.status} />
          </Box>
          {missing > 0n && (
            <Badge colorPalette="warning" flexShrink={0} data-testid={stuck ? undefined : "restock-detail-missing"}>
              {t("restock.detail.missingBadge", { count: Number(missing) })}
            </Badge>
          )}
        </>
      }
      actions={
        // Labelled buttons on a desktop; on a phone their icons (a-phone-header-action-is-an-icon). The bar's copy is
        // always the compact one, its test ids suffixed `-sticky`, so a test finds each of the page's once.
        stuck ? (
          <Box data-testid="restock-detail-sticky-actions">
            <WarehouseRestockActions request={request} teamId={teamId} variant="compact" codMark={codMark} idSuffix="-sticky" />
          </Box>
        ) : (
          <WarehouseRestockActions
            request={request}
            teamId={teamId}
            variant={isMobile ? "compact" : "buttons"}
            codMark={codMark}
          />
        )
      }
    />
  );

  /** A section card, keyed by its entry in `sections.ts` — its id, icon and title come from there. */
  const section = (key: RestockSectionKey, children: ReactNode, testId: string, marks?: ReactNode) => {
    const entry = restockSection(key);

    return (
      <Section id={restockSectionDomId(key)} icon={entry.icon} title={t(entry.titleKey)} marks={marks} testId={testId}>
        {children}
      </Section>
    );
  };

  const title = titleRow(false);
  // KIRIMAN — what finds the box at the door: who sent it, the courier, THE ONGKIR THIS WAREHOUSE PAID — the charge at the
  // door, its note and slip, owed back by the selling team (owner: *"ongkirnya yang dibayar gudang … dibayar selling kita
  // tidak perlu tahu"*, the-warehouse-sees-the-ongkir-it-paid) — the label's photo, when. The tracking number is the title.
  // Before the box is counted the charge is not on the restock, so it reads "—".
  const delivery = section(
    "delivery",
    <DeliveryFacts
      request={request}
      // The photo is the selling team's document: the warehouse opens it through RestockReceiptPhoto, which checks the
      // restock is coming here (the-restocks-warehouse-opens-its-label-photo).
      teamId={teamId}
      opensAs="warehouse"
      narrow={wide}
      party={{ label: t("restock.detail.from"), name: fromName, testId: "restock-detail-from" }}
      withCourierCharge
      courierCharge={
        accepted ? (
          <CourierChargeFacts
            request={request}
            owed={t("restock.detail.courierChargeOwedToUs", { team: fromName })}
            slipMark={<NotImplemented list={RESTOCK_WAREHOUSE_DETAIL_PENDING} id="courierPhoto" />}
          />
        ) : undefined
      }
    />,
    "restock-detail-info",
  );
  const products = section(
    "products",
    <LinesCard
      request={request}
      brokenPhotoMark={<NotImplemented list={RESTOCK_WAREHOUSE_DETAIL_PENDING} id="brokenPhoto" />}
      brokenRackMark={<NotImplemented list={RESTOCK_WAREHOUSE_DETAIL_PENDING} id="brokenRack" />}
    />,
    "restock-detail-products",
  );
  // ONE NOTE PER WRITER (the-notes-are-one-per-writer) — the selling team's, READ here, never changed; this warehouse's,
  // WRITTEN here (the-warehouse-writes-its-own-note), which nothing stores yet.
  const note = section(
    "note",
    <RestockNotes
      request={request}
      teamId={teamId}
      side="warehouse"
      sellingByMark={<NotImplemented list={RESTOCK_WAREHOUSE_DETAIL_PENDING} id="sellingNoteBy" />}
      warehouseMark={<NotImplemented list={RESTOCK_WAREHOUSE_DETAIL_PENDING} id="warehouseNoteKept" />}
    />,
    "restock-detail-note-section",
  );
  const timeline = section(
    "timeline",
    <RestockTimeline request={request} bare />,
    "restock-detail-timeline-section",
    <NotImplemented list={RESTOCK_WAREHOUSE_DETAIL_PENDING} id="trailChanges" />,
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack
      gap="section"
      animationStyle="enter"
      data-testid="restock-detail-page"
      style={{ ["--detail-header-h" as string]: `${stick.height}px` }}
    >
      {/* What is not real yet (pending.ts). */}
      <NotImplementedSummary list={RESTOCK_WAREHOUSE_DETAIL_PENDING} />

      {/* THE STICKY STRIP — the section chips on a phone (always), and the title bar under them, drawn over the page once
          the title has gone behind it. */}
      <ProductStickyStrip
        prefix="restock-detail"
        stripRef={stick.strip}
        barRef={stick.bar}
        shown={stick.past}
        isMobile={isMobile}
        chips={<SectionNav compact sections={navSections} ariaLabel={t("restock.detail.navLabel")} active={active} onSelect={scrollTo} />}
      >
        {titleRow(true)}
      </ProductStickyStrip>

      {/* THE NAVIGATION, THEN THE SECTIONS. ⚠ `minmax(0, 1fr)` so the wide table scrolls in its own box. */}
      <Grid templateColumns={isMobile ? "minmax(0, 1fr)" : "13rem minmax(0, 1fr)"} gap="section" alignItems="start">
        {!isMobile && (
          <Box position="sticky" top="calc(var(--detail-header-h, 0px) + 1rem)">
            <SectionNav sections={navSections} ariaLabel={t("restock.detail.navLabel")} active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* THE BOX ON THE LEFT, THE INFO ON THE RIGHT (the-restock-page-leads-with-the-box) — Produk, Catatan, Riwayat
            in the main column; Kiriman, the Ongkir COD it paid among its facts, a 20rem column beside it where the page area
            has room for both (the-delivery-card-stacks-when-the-page-is-narrow); below the products, in the nav's order,
            otherwise. A JS branch, so no card exists twice. ⚠ ONE TREE FOR BOTH: the sidebar opening or closing flips the
            layout, and only Kiriman moves — the products, the note being typed and the trail keep their slots. This Stack
            is what is measured: its width is the room for both columns (`minmax(0, 1fr)`, never its content's). */}
        <Stack ref={areaRef} gap="section" minW="0" w="full">
          {title}
          <Grid templateColumns={wide ? `minmax(0, 1fr) ${SIDE_COLUMN}` : "minmax(0, 1fr)"} gap="section" alignItems="start" minW="0">
            <Stack gap="section" minW="0">
              {products}
              {!wide && delivery}
              {note}
              {timeline}
            </Stack>
            {wide && (
              <Stack gap="section" minW="0">
                {delivery}
              </Stack>
            )}
          </Grid>
        </Stack>
      </Grid>
    </Stack>
  );
}
