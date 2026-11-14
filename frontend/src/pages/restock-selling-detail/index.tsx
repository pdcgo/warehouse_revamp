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
import { RestockTimeline } from "../../features/restock/RestockTimeline";
import { SellingRestockActions } from "../../features/restock/SellingRestockActions";
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
import { CourierChargeFacts, DeliveryFacts, PaymentFacts } from "../../features/restock/RestockFacts";
import { RestockNotes } from "../../features/restock/RestockNotes";
import { RestockTitleRow } from "../../features/restock/RestockTitleRow";
import { type RestockSectionKey, restockSection, restockSectionDomId } from "../../features/restock/sections";
import { SIDE_COLUMN, useSideBySide } from "../../features/restock/sideBySide";
import { ProductsPanel } from "./components/ProductsPanel";
import { RESTOCK_SELLING_DETAIL_PENDING } from "./pending";

// The page's sections in its own order (owner: *"kurasa selling juga sama, infonya di atas ongkir berarti"*,
// the-restock-page-leads-with-the-box): the box, then the info about it — Kiriman over the money.
const SELLING_ORDER: RestockSectionKey[] = ["products", "delivery", "payment", "courier", "note", "timeline"];

// THE PRODUCTS CARD AT ITS NARROWEST — the warehouse page's rule (owner: *"A"*, the-delivery-card-stacks-when-the-page-is-
// narrow) applied to its twin, which had the same fault: the lines table's min-content, 779px on 503 counted in (the
// store under the supplier, the price, the line total, the broken and missing columns), plus the card's padding and border
// (50) → 830. Where the page area holds less than this + the gap + the side column's 20rem, Kiriman and the money go below
// the products. A column added to ProductsPanel widens it: measure again in the live story (`table.style.width =
// "min-content"` on `restock-detail-items`) and pin it in stories/Layout.stories.tsx.
const PRODUCTS_FLOOR_PX = 830;

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// RestockSellingDetailPage — ONE RESTOCK AS THE SELLING TEAM SEES IT.
//
// The selling team raised it, paid for it, and is the only side that changes it: everything but the two acts at the
// warehouse door is theirs (the-warehouse-signs-and-accepts-the-team-does-the-rest). So the title row carries the
// status and the actions the status allows — Edit · Cancel · Mark Lost while ongoing, Edit Lines once arrived, nothing
// once it is a record (see SellingRestockActions for the matrix).
//
// THE PRODUCT PAGE'S SHAPE (owner: *"kalau menggunakan yang sesuai dengan produk detail … halaman jadi 1 dan tidak
// dipisah berdasarkan tab, di kiri itu cuma jadi navigasi saja"*, the-restock-detail-is-the-product-pages-shape):
//
//   ┌ Kiriman      ┐   ←  Order ID INV/2026/10/1001 ⧉  [Dalam Perjalanan]          [✎ Ubah] [⊘ Batalkan] [⊠ Hilang]
//   │ Pembayaran   │      Resi JNE0123456789 ⧉
//   │ Ongkir COD   │   ┌ Kiriman ────────────────────────────────────────┐
//   │ Produk       │   │ …                                                │
//   │ Catatan      │   ┌ Pembayaran …
//   └ Riwayat      ┘   …
//
// ONE PAGE OF SECTIONS, the left column only the navigation that scrolls to them (Section, SectionNav, useScrollSpy) —
// it was three tabs. The title row is the order id and the tracking number (RestockTitleRow); once it scrolls away the
// same row sticks, small. On a phone the section chips stick at the top and the actions are their icons, ⋯ past two.
export function RestockSellingDetailPage() {
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

  // A malformed id never reaches the server (the query is disabled for it), so its message comes from here.
  const error = id === 0n ? t("restock.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  const warehouseId = request?.warehouseId ?? 0n;

  // TeamDetail is unscoped, so the destination warehouse's NAME is readable here. "Warehouse #3" is not a place.
  const warehouse = useTeamDetail({ teamId: warehouseId, enabled: warehouseId > 0n });

  // ── The layout's own state, before the early returns: hooks may not be conditional. ─────────────────────────────
  // The courier's charge is a section only once accepted — the warehouse enters it at the door.
  const accepted = request?.status === RestockRequestStatus.ACCEPTED;
  const keys = SELLING_ORDER.filter((key) => key !== "courier" || accepted);
  // The info and money column only where the PAGE AREA holds it beside the products (the-delivery-card-stacks-when-the-
  // page-is-narrow) — measured on the main column before the first paint, never the viewport's `xl`, which ignores the
  // sidebar: at 1440 and 1600 with the sidebar open the products table scrolled sideways beside it.
  const [areaRef, wide] = useSideBySide<HTMLDivElement>(PRODUCTS_FLOOR_PX);
  const stick = useStickyTitle(request !== null, isMobile);
  // With the money beside the main column, scrolling lights only the main one — the side cards are short and sit high,
  // so they would win while the reader is halfway down the products; they light when clicked.
  const { active, scrollTo } = useScrollSpy(
    request !== null,
    stick.bar,
    keys,
    restockSectionDomId,
    wide ? keys.filter((key) => key !== "delivery" && key !== "payment" && key !== "courier") : undefined,
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

  // Missing units are a fact about the whole delivery, so they sit in the title row — the reader must not have to scroll
  // to learn it went wrong. 0 until accepted: an uncounted box is not short.
  const missing = shortfall(request);
  const warehouseName = warehouse.data?.name || t("restock.warehouseRef", { id: request.warehouseId.toString() });

  // ⚠ The cancel dialog's warning promises a check nothing does yet — marked in the dialog.
  const reviewMark = <NotImplemented list={RESTOCK_SELLING_DETAIL_PENDING} id="cancelReview" />;

  // ── THE TITLE ROW — back, the order id with the tracking number under it, the status, and the actions held to the right.
  // ONE builder, drawn twice: as the page's title, and as the sticky bar once that title has scrolled behind it. ─────────
  const titleRow = (stuck: boolean) => (
    <RestockTitleRow
      stuck={stuck}
      request={request}
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
        // Labelled buttons on a desktop; on a phone their icons, ⋯ past two (a-phone-header-action-is-an-icon). The bar's
        // copy is always the compact one — the same actions, in small — its test ids suffixed `-sticky`, so a test finds
        // each of the page's once.
        stuck ? (
          <Box data-testid="restock-detail-sticky-actions">
            <SellingRestockActions
              request={request}
              teamId={teamId}
              variant="compact"
              cancelReviewMark={reviewMark}
              idSuffix="-sticky"
            />
          </Box>
        ) : (
          <SellingRestockActions
            request={request}
            teamId={teamId}
            variant={isMobile ? "compact" : "buttons"}
            cancelReviewMark={reviewMark}
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
  const delivery = section(
    "delivery",
    <DeliveryFacts
      request={request}
      // The selling team opens its own label photo, as the file's owner.
      teamId={teamId}
      opensAs="owner"
      narrow={wide}
      party={{ label: t("restock.detail.destination"), name: warehouseName, testId: "restock-detail-warehouse" }}
    />,
    "restock-detail-info",
  );
  const payment = section("payment", <PaymentFacts request={request} teamId={teamId} />, "restock-detail-payment");
  const courier =
    accepted &&
    section(
      "courier",
      <CourierChargeFacts
        request={request}
        owed={t("restock.detail.courierChargeOwedBySelling", { warehouse: warehouseName })}
        slipMark={<NotImplemented list={RESTOCK_SELLING_DETAIL_PENDING} id="courierPhoto" />}
      />,
      "restock-detail-courier-charge-card",
    );
  const products = section(
    "products",
    <ProductsPanel
      request={request}
      teamId={teamId}
      brokenPhotoMark={<NotImplemented list={RESTOCK_SELLING_DETAIL_PENDING} id="brokenPhoto" />}
    />,
    "restock-detail-products",
  );
  // ONE NOTE PER WRITER (the-notes-are-one-per-writer) — the selling team's, real; the warehouse's, not stored yet.
  const note = section(
    "note",
    <RestockNotes
      request={request}
      teamId={teamId}
      sellingByMark={<NotImplemented list={RESTOCK_SELLING_DETAIL_PENDING} id="sellingNoteBy" />}
      lateMark={<NotImplemented list={RESTOCK_SELLING_DETAIL_PENDING} id="lateNote" />}
      warehouseMark={<NotImplemented list={RESTOCK_SELLING_DETAIL_PENDING} id="warehouseNote" />}
    />,
    "restock-detail-note-section",
  );
  // The timeline draws no card of its own inside its section (never a card inside a card); it keeps `restock-detail-timeline`.
  // THE SYSTEM'S VOICE (the-notes-are-one-per-writer) — every move, who and when. ⚠ An edit's row should say what
  // changed; the server writes only that something did.
  const timeline = section(
    "timeline",
    <RestockTimeline request={request} bare />,
    "restock-detail-timeline-section",
    <NotImplemented list={RESTOCK_SELLING_DETAIL_PENDING} id="trailChanges" />,
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack
      gap="section"
      animationStyle="enter"
      data-testid="restock-detail-page"
      style={{ ["--detail-header-h" as string]: `${stick.height}px` }}
    >
      {/* What is not real yet — always, now that the notes and the timeline carry marks of their own. */}
      <NotImplementedSummary list={RESTOCK_SELLING_DETAIL_PENDING} />

      {/* THE STICKY STRIP — the section chips on a phone (always), and the title bar under them, drawn over the page once
          the title has gone behind it. On a desktop the strip has no height: the bar overlays, nothing moves. */}
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

      {/* THE NAVIGATION, THEN THE SECTIONS. ⚠ `minmax(0, 1fr)` so a wide table scrolls in its own box instead of pushing
          the column, and `alignItems="start"` so the nav's cell can stick. */}
      <Grid templateColumns={isMobile ? "minmax(0, 1fr)" : "13rem minmax(0, 1fr)"} gap="section" alignItems="start">
        {!isMobile && (
          <Box position="sticky" top="calc(var(--detail-header-h, 0px) + 1rem)">
            <SectionNav sections={navSections} ariaLabel={t("restock.detail.navLabel")} active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* THE MONEY ON THE RIGHT, SMALL (owner: *"pembayaran terlalu kurang desainnya buat lebih kecil saja taruh kanan"*,
            payment-is-a-receipt-on-the-right) — Pembayaran, and Ongkir COD under it once accepted, a 20rem column beside the
            main one where the page area has room for both (the-delivery-card-stacks-when-the-page-is-narrow); below the
            products otherwise, in the nav's order. A JS branch, so no card exists twice. ⚠ ONE TREE FOR BOTH: the sidebar
            opening or closing flips the layout, and only the info cards move — the products, the note being typed and the
            trail keep their slots. This Stack is what is measured: its width is the room for both columns. */}
        <Stack ref={areaRef} gap="section" minW="0" w="full">
          {title}
          <Grid templateColumns={wide ? `minmax(0, 1fr) ${SIDE_COLUMN}` : "minmax(0, 1fr)"} gap="section" alignItems="start" minW="0">
            <Stack gap="section" minW="0">
              {products}
              {!wide && delivery}
              {!wide && payment}
              {!wide && courier}
              {note}
              {timeline}
            </Stack>
            {/* The info on the right — Kiriman over the money (the-restock-page-leads-with-the-box). */}
            {wide && (
              <Stack gap="section" minW="0">
                {delivery}
                {payment}
                {courier}
              </Stack>
            )}
          </Grid>
        </Stack>
      </Grid>
    </Stack>
  );
}
