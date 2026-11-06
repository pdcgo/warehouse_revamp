import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Icon,
  IconButton,
  Spacer,
  Stack,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ArrowLeft, ArrowUpRight, PackageCheck } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { ReadyLine } from "../../components/feedback/ReadyLine";
import type { ReadyLineItem } from "../../components/feedback/ReadyLine";
import { toaster } from "../../components/feedback/Toaster";
import { cameFrom } from "../../lib/cameFrom";
import { useElementSize, useElementWidth } from "../../lib/useElementWidth";
import { FLASH_ON_LANDING, jumpTo } from "../../lib/useScrollSpy";
import { useTeamDetail } from "../../features/teams/queries";
import { useProductsByIds } from "../../features/products/queries";
import { useProductPlaces } from "../../features/inventory/queries";
import { toRupiah, unitHpp } from "../../features/restock/counting";
import { useAcceptRestockRequest, useRestockRequest } from "../../features/restock/queries";
import { RESTOCK_STATUS_TABS } from "../../features/restock/statusTabs";
import { useTeam } from "../../features/team/TeamContext";
import { useIsMobile } from "../../layouts/shell";
import { AcceptSummary } from "./components/AcceptSummary";
import { ChargeSection } from "./components/ChargeSection";
import { ConfirmSummary } from "./components/ConfirmSummary";
import { LineCard, lineLayout } from "./components/LineCard";
import { PcsMark } from "./components/PcsMark";
import type { LineDraft, LineState } from "./draft";
import { emptyLine, lineState, receivedLine } from "./draft";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { RESTOCK_ACCEPT_PENDING } from "./pending";

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// Accept takes a restock from ONGOING or ARRIVED only (accept-locks-the-restock) — a box that turns up before anybody
// signed for it can still be counted in.
function acceptable(request: RestockRequest): boolean {
  return request.status === RestockRequestStatus.ONGOING || request.status === RestockRequestStatus.ARRIVED;
}

// What still holds a line up — the FIRST of it, in the card's order: the count, the broken units' rack, the put-away.
// The line itself says the detail (its badge, its error); the ready line only names what to go and finish.
function lineBlocker(st: LineState): string {
  if (!st.counted) return "restock.accept.missing.received";
  if (st.over > 0n || st.brokenOver) return "restock.accept.missing.count";
  if (st.brokenNeedsPlace) return "restock.accept.missing.brokenRack";
  return "restock.accept.missing.placement";
}

// RestockAcceptPage — the receiving warehouse COUNTS THE BOX IN (any-warehouse-member-counts-what-arrived), in one act:
// per line, what is in the box and how many of those are broken; the good units onto placements; the courier's charge
// at the door. Everything else is worked out on screen exactly as the accept handler works it out
// (restock_request_accept.go), so Accept only presses on a count the server takes.
//
//   good    = received − broken      → stock, on placements holding exactly that many (there-is-no-unplaced-pile)
//   missing = ordered − received     → a missing row (a-short-unit-at-the-door-is-missing)
//   more than ordered                → refused: the selling team edits the line first (accept-refuses-more-than-the-line-says)
//   the courier's charge             → its own debt, outside the total, inside the unit price
//                                       (the-couriers-charge-stays-out-of-total)
//   a photo of the broken units      → optional, one per line — ⚠ picked, NOT KEPT yet (a-broken-product-carries-a-photo)
//   where the broken units go        → thrown away, or onto a rack that is then required — ⚠ the rack is NOT KEPT yet
//                                       (a-broken-product-may-go-on-a-rack)
//   a photo of the courier's slip    → optional — ⚠ NOT KEPT yet (the-courier-slip-has-an-optional-photo)
export function RestockAcceptPage() {
  const { current } = useTeam();
  const { requestId: rawId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobile = useIsMobile();
  // THE BOX ON THE LEFT, THE INFO ON THE RIGHT where there is room (the-accept-page-puts-the-box-left-and-the-info-right)
  // — the warehouse detail's breakpoint, so the two pages split at the same width.
  const wide = useBreakpointValue({ base: false, xl: true }, { ssr: false }) ?? false;
  // The lines' column, measured: a line card arranges its three parts by the room IT has (lineLayout).
  const [linesRef, linesWidth] = useElementWidth<HTMLDivElement>();
  // The sticky header's height, published as `--accept-header-h` — a jump lands clear of it.
  const [headerRef, header] = useElementSize<HTMLDivElement>();
  const pageRef = useRef<HTMLDivElement>(null);

  // THE READY LINE TAKES YOU TO WHAT IT NAMES (owner: *"usulan 1 oke"*, the-ready-line-jumps-to-what-it-names) — a line,
  // or the courier's charge; it scrolls there, clear of the header, and the card blinks (a-nav-jump-blinks-where-it-lands).
  function jumpToMissing(id: string) {
    const target = id.startsWith("line-") ? id : "charge";
    const el = pageRef.current?.querySelector<HTMLElement>(`[data-jump="${target}"]`);
    if (el) jumpTo(el);
  }
  const layout = lineLayout(linesWidth);

  const requestId = parseRequestId(rawId);
  // EVERY WAY OUT GOES WHERE THE PAGE WAS OPENED (a-form-returns-where-it-was-opened; owner, on the restock form: *"kalau
  // detail ke detail, kalau list ke list"*) — the list with its filters, or this restock's page. Reached by a link, the
  // restock's page: what Terima was about.
  const openedFrom = cameFrom(useLocation());
  const backTo = openedFrom ?? `/inventories/restock/${rawId ?? ""}`;

  // Only what the person at the door TYPES is state — the restock comes from a query. A line nobody has touched reads
  // as an empty draft, so a line the selling team adds while the box is open simply appears, uncounted.
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  // ASKED FIRST, THEN FILLED (the-charge-is-asked-for-before-it-is-filled) — the tick that reveals the charge.
  const [chargeAsked, setChargeAsked] = useState(false);
  const [charge, setCharge] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  // The courier's slip, optional (the-courier-slip-has-an-optional-photo) — picked, not kept.
  const [chargePhoto, setChargePhoto] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const accept = useAcceptRestockRequest();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  const query = useRestockRequest({ teamId, requestId });
  const request = query.data ?? null;

  // TERIMA STARTS FROM THE CHARGE NOTED AT TIBA (owner: *"tiba dan diterima bisa mengubah ongkir, kalau sudah diset di
  // tiba, diterima tidak perlu set lagi"*, terima-starts-from-the-charge-noted-at-tiba) — the restock's own charge and
  // note, read ONCE per restock so a refetch never overwrites what is being typed; still open to change here.
  // ⚠ Tandai Tiba keeps no charge yet, so this is empty today — the `codFromArrival` mark says so.
  const seededCharge = useRef("");
  useEffect(() => {
    if (!request || seededCharge.current === request.id.toString()) return;
    seededCharge.current = request.id.toString();
    if (request.warehouseAdditionalCost > 0) {
      // A charge already on the restock opens ticked.
      setChargeAsked(true);
      setCharge(String(request.warehouseAdditionalCost));
      setChargeNote(request.warehouseAdditionalCostNote);
    }
  }, [request]);
  const items = request?.items ?? [];
  const loading = query.isPending && teamId !== undefined && requestId !== 0n;
  const loadError = query.isError ? rpcError(query.error) : "";

  const productIds = items.map((i) => i.productId);
  // Where these products already sit, so a put-away joins the existing pile (#156). Help, never a gate.
  const places = useProductPlaces({ warehouseId: teamId, productIds }).data ?? [];
  // The cover pictures, in one batch — someone matching a box recognises the picture before the SKU.
  const products = useProductsByIds({ teamId, productIds }).data;

  const draftOf = (itemId: bigint) => drafts[itemId.toString()] ?? emptyLine();
  const updater = (itemId: bigint) => (fn: (d: LineDraft) => LineDraft) =>
    setDrafts((prev) => ({ ...prev, [itemId.toString()]: fn(prev[itemId.toString()] ?? emptyLine()) }));

  // On Tidak ada, there is no charge, whatever was typed before.
  const courierCharge = chargeAsked ? toRupiah(charge) : 0;
  // On Ada, the amount and the note are both required (the-courier-is-paid-once-per-restock); the note's error shows once
  // there is an amount, so a fresh Ada is not all red.
  const chargeAmountMissing = chargeAsked && courierCharge <= 0;
  const chargeNoteMissing = chargeAsked && courierCharge > 0 && chargeNote.trim() === "";
  // Who owes the charge back — named in the charge's text (the-cod-paid-is-said-in-its-own-section).
  const requester = useTeamDetail({ teamId: request?.requestingTeamId ?? 0n, enabled: (request?.requestingTeamId ?? 0n) > 0n });
  const sellingTeam =
    requester.data?.name || t("restock.teamRef", { id: (request?.requestingTeamId ?? 0n).toString() });

  // The landed unit price: shipping + the courier's charge, spread over every unit ORDERED in the restock
  // (unit-price-is-line-price-plus-costs-per-unit, all-qty-is-every-unit-ordered). It does not move as the box is
  // counted, and a broken or missing unit is worth the same price as a good one. Not SHOWN as a price per piece
  // (the-accept-line-shows-no-price) — only as what a broken or missing unit was worth.
  const costs = (request?.shipmentCost ?? 0) + courierCharge;
  const allQty = items.reduce((sum, i) => sum + i.count, 0n);
  const landedOf = (item: (typeof items)[number]) => unitHpp(item.total, item.count, costs, allQty);

  const lines = items.map((item) => {
    const draft = draftOf(item.id);
    const landed = landedOf(item);
    return { item, draft, landed, st: lineState(item, draft, landed) };
  });

  // WHAT TERIMA WAITS FOR, in the page's order — each unfinished line by its product, then the charge in the info
  // beside or under them (a-save-button-says-what-it-waits-for): one line by the button, the rest on asking.
  const missing: ReadyLineItem[] = [
    ...lines
      .filter((l) => !l.st.ready)
      .map((l) => ({ id: `line-${l.item.productId}`, label: t(lineBlocker(l.st), { name: l.item.name }) })),
    chargeAmountMissing && { id: "chargeAmount", label: t("restock.accept.missing.chargeAmount") },
    chargeNoteMissing && { id: "chargeNote", label: t("restock.accept.missing.chargeNote") },
  ].filter((m): m is ReadyLineItem => Boolean(m));
  const ready = lines.length > 0 && missing.length === 0;
  const busy = accept.isPending;

  const ordered = allQty;
  const inBox = lines.reduce((sum, l) => sum + l.st.received, 0n);
  // HOW THE BOX STANDS, IN ITS COLOUR (owner: *"keterangan n dari n pcs di atas buat lebih kelihatan secara warna"*,
  // the-box-count-says-its-state-in-colour): still counting → info; every line counted and the box whole → success;
  // counted and short → warning (the missing units); more than ordered → error (the selling team edits first).
  const allCounted = lines.length > 0 && lines.every((l) => l.st.counted);
  const boxTone = inBox > ordered ? "error" : !allCounted ? "info" : inBox < ordered ? "warning" : "success";

  async function submit() {
    if (teamId === undefined || !request) return;
    setSubmitError("");

    try {
      await accept.mutateAsync({
        teamId,
        requestId: request.id,
        // Built from the restock's own lines, so every line is counted exactly once — the handler's first check.
        lines: lines.map((l) => receivedLine(l.item, l.draft, l.st)),
        warehouseAdditionalCost: courierCharge,
        warehouseAdditionalCostNote: courierCharge > 0 ? chargeNote.trim() : "",
      });

      toaster.create({ type: "success", title: t("restock.accept.toast.accepted") });
      // WHAT WAS GIVEN AND NOT KEPT — the slip's photo, a broken photo, a rack for broken units — said in one toast, not
      // swallowed (restock-accept/pending.ts).
      const broken = lines.filter((l) => l.st.broken > 0n);
      const notKept = [
        chargeAsked && chargePhoto && t("restock.accept.notKept.courierPhoto"),
        broken.some((l) => l.draft.brokenPhoto) && t("restock.accept.notKept.brokenPhoto"),
        broken.some((l) => l.draft.brokenTo === "rack") && t("restock.accept.notKept.brokenRack"),
      ].filter(Boolean);
      if (notKept.length > 0) {
        toaster.create({ type: "warning", title: t("restock.accept.toast.notKept", { parts: notKept.join(", ") }) });
      }
      navigate(openedFrom ?? `/inventories/restock/${request.id}`);
    } catch (err) {
      setSubmitError(rpcError(err));
      toaster.create({ type: "error", title: t("restock.accept.toast.failed"), description: rpcError(err) });
    }
  }

  // Back is its icon alone, on every width (owner: *"kembali ke restok di accept icon saja"*) — as on the restock's own
  // page (RestockTitleRow); its words are its name and its hover.
  const back = (
    <IconButton
      size="sm"
      variant="ghost"
      flexShrink={0}
      aria-label={t("restock.accept.back")}
      title={t("restock.accept.back")}
      onClick={() => navigate(backTo)}
      data-testid="accept-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  if (!current || !isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.accept.title")}</Heading>
        <Text color="fg.muted" data-testid={current ? "accept-not-warehouse" : "accept-no-team"}>
          {current ? t("restock.accept.warehouseOnly") : t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // The first load shows the page's shape (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={3} testId="accept-loading" />;
  }

  if (loadError || !request || request.warehouseId !== teamId) {
    return (
      <Stack gap="section">
        <Box>{back}</Box>
        <Text color="error.fg" data-testid="accept-error">
          {loadError || t("restock.accept.notFound")}
        </Text>
      </Stack>
    );
  }

  // NOT ACCEPTABLE — already accepted, lost or cancelled. Said plainly, with the way back, rather than a form whose
  // Accept the server would refuse after a full count.
  if (!acceptable(request)) {
    const statusKey = RESTOCK_STATUS_TABS.find((tab) => tab.status === request.status)?.labelKey;

    return (
      <Stack gap="section" animationStyle="enter" data-testid="restock-accept-page">
        <Flex align="center" gap="card" wrap="wrap">
          {back}
          <Heading size="md">{t("restock.accept.title")}</Heading>
          <RestockStatusBadge status={request.status} />
        </Flex>

        <Alert.Root status="info" maxW="3xl" data-testid="accept-not-acceptable">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {t("restock.accept.notAcceptable.title", {
                id: request.id.toString(),
                status: statusKey ? t(statusKey) : "",
              })}
            </Alert.Title>
            <Alert.Description>{t("restock.accept.notAcceptable.description")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>

        <Button
          variant="outline"
          alignSelf="flex-start"
          data-testid="accept-open-restock"
          onClick={() => navigate(`/inventories/restock/${request.id}`)}
        >
          <Icon as={ArrowUpRight} boxSize="4" />
          {t("restock.accept.openRestock")}
        </Button>
      </Stack>
    );
  }

  // How far the count has got, and what Terima still waits for — ONE line (a-save-button-says-what-it-waits-for): the
  // first thing missing, the rest on asking, or ✓ Siap diterima. Beside Terima on a desktop, under the sticky row on a
  // phone.
  const progress = (
    <Stack gap="1" align={mobile ? "flex-start" : "flex-end"} minW="0">
      {/* Only the pcs is highlighted, in the box's tone; the rest is plain (the-pcs-alone-is-highlighted). */}
      <Flex align="center" gap="1.5" fontSize="sm" data-tone={boxTone} data-testid="accept-restock-count">
        <PcsMark tone={boxTone} testId="accept-restock-count-pcs">
          {t("restock.accept.countPcs", { received: inBox.toString(), ordered: ordered.toString() })}
        </PcsMark>
        <Text>{t("restock.accept.countInBox")}</Text>
      </Flex>
      <ReadyLine
        missing={missing}
        readyLabel={t("restock.accept.readyToAccept")}
        testId="accept-ready-line"
        onSelect={jumpToMissing}
      />
    </Stack>
  );

  // EVERY LINE OF THE BOX — measured, so each card arranges its three parts by this column's width.
  const linesColumn = (
    <Stack ref={linesRef} gap="section" minW="0" data-testid="accept-lines">
      {lines.map(({ item, draft, st }) => {
        const product = products?.get(item.productId.toString());

        return (
          <LineCard
            key={item.id.toString()}
            item={item}
            draft={draft}
            st={st}
            warehouseId={teamId ?? 0n}
            imageUrl={product?.defaultImageUrl}
            thumbnailUrl={product?.defaultImageThumbnailUrl}
            // Real placements only — a pile with no placement is not somewhere to put things.
            recommendations={places.filter((p) => p.productId === item.productId && p.rackId !== 0n)}
            brokenPhotoMark={<NotImplemented list={RESTOCK_ACCEPT_PENDING} id="brokenPhoto" />}
            brokenRackMark={<NotImplemented list={RESTOCK_ACCEPT_PENDING} id="brokenRack" />}
            layout={layout}
            update={updater(item.id)}
          />
        );
      })}
    </Stack>
  );

  // THE INFO — the restock's record, then the courier's charge. The charge lives OUTSIDE the summary cards (owner):
  // everything in them is already on the record, and this is a figure the person at the door may change. It says what the
  // warehouse paid, as text, and changes on Ubah (the-cod-paid-is-said-in-its-own-section); it moves every landed price
  // in the lines.
  const infoColumn = (
    <Stack gap="section" minW="0" data-testid="accept-info">
      <AcceptSummary request={request} narrow={wide} />
      <Card.Root data-jump="charge" scrollMarginTop="calc(var(--accept-header-h, 0px) + 1rem)" css={FLASH_ON_LANDING}>
        <Card.Body>
          <ChargeSection
            asked={chargeAsked}
            onAsked={setChargeAsked}
            amount={charge}
            charge={courierCharge}
            note={chargeNote}
            noteMissing={chargeNoteMissing}
            onAmount={setCharge}
            onNote={setChargeNote}
            photo={chargePhoto}
            onPhoto={setChargePhoto}
            team={sellingTeam}
            mark={<NotImplemented list={RESTOCK_ACCEPT_PENDING} id="codFromArrival" />}
            photoMark={<NotImplemented list={RESTOCK_ACCEPT_PENDING} id="courierPhoto" />}
          />
        </Card.Body>
      </Card.Root>
    </Stack>
  );

  return (
    // NOT capped at the page level (owner): the cap belongs to the read-only summary, not to the counting. The page
    // arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack
      ref={pageRef}
      gap="section"
      animationStyle="enter"
      data-testid="restock-accept-page"
      style={{ ["--accept-header-h" as string]: `${header.height}px` }}
    >
      {/* The action header rides at the top of the scroll: on a long delivery Terima and what it waits for must stay in
          reach. On a phone it is ONE row — back, the title, the status, Terima as its icon
          (the-phone-header-is-one-row, a-phone-header-action-is-an-icon) — and the progress comes down under it. */}
      <Box
        ref={headerRef}
        position="sticky"
        top="0"
        zIndex="1"
        bg="bg"
        borderBottomWidth="1px"
        borderColor="border"
        py="card"
      >
        <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"}>
          {back}
          <Heading size="md" truncate>
            {t("restock.accept.title")}
          </Heading>
          <RestockStatusBadge status={request.status} />
          <Spacer />

          {mobile ? (
            <CompactActions
              menuLabel={t("restock.accept.actions")}
              actions={[
                {
                  id: "accept",
                  label: t("restock.accept.action"),
                  icon: PackageCheck,
                  primary: true,
                  disabled: !ready || busy,
                  testId: "accept-submit",
                  onClick: () => setConfirmOpen(true),
                },
              ]}
            />
          ) : (
            <>
              {progress}
              {/* The same icon as the act that opened this page (WarehouseRestockActions) — an-action-button-carries-its-icon. */}
              <Button
                colorPalette="brand"
                disabled={!ready}
                loading={busy}
                data-testid="accept-submit"
                onClick={() => setConfirmOpen(true)}
              >
                <Icon as={PackageCheck} boxSize="4" />
                {t("restock.accept.action")}
              </Button>
            </>
          )}
        </Flex>
      </Box>

      {mobile && progress}

      {submitError && (
        <Text color="error.fg" data-testid="accept-error">
          {submitError}
        </Text>
      )}

      {/* What is not kept yet — the broken photo, the broken rack, the charge from Tiba, the slip (pending.ts). */}
      <NotImplementedSummary list={RESTOCK_ACCEPT_PENDING} />

      {/* THE BOX ON THE LEFT, THE INFO ON THE RIGHT (owner: *"produk semua di kiri, info lain di kanan"*,
          the-accept-page-puts-the-box-left-and-the-info-right) — every line in the main column; the restock's record and
          the courier's charge in a 20rem column beside it from `xl`, as the warehouse's restock page has it. Narrower, one
          column: the lines first, then the info. A JS branch, so no card exists twice. */}
      {wide ? (
        <Grid templateColumns="minmax(0, 1fr) 20rem" gap="section" alignItems="start">
          {linesColumn}
          {infoColumn}
        </Grid>
      ) : (
        <>
          {linesColumn}
          {infoColumn}
        </>
      )}

      {/* Accepting moves stock and cannot be undone, so it confirms first. One dialog for both shells — the desktop
          button and the phone's icon both open it. It SAYS THE COUNT (owner: *"2 oke"*, the-confirm-says-the-count):
          the figures first, then what happens to them. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive={false}
        title={t("restock.accept.confirm.title")}
        confirmLabel={t("restock.accept.confirm.label")}
        onConfirm={submit}
      >
        <ConfirmSummary
          good={lines.reduce((sum, l) => sum + l.st.good, 0n)}
          broken={lines.reduce((sum, l) => sum + l.st.broken, 0n)}
          missing={lines.reduce((sum, l) => sum + l.st.missing, 0n)}
          charge={courierCharge}
        />
        <Text fontSize="sm" color="fg.muted">
          {t("restock.accept.confirm.message")}
        </Text>
      </ConfirmDialog>
    </Stack>
  );
}
