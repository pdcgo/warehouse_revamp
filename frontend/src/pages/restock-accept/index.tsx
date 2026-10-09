import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  IconButton,
  Menu,
  Portal,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, CheckCheck, MoreHorizontal } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useProductsByIds } from "../../features/products/queries";
import { useProductPlaces } from "../../features/inventory/queries";
import { useLineSuppliers } from "../../features/restock/LineSupplier";
import { toRupiah, unitGoods, unitHpp } from "../../features/restock/counting";
import { useAcceptRestockRequest, useRestockRequest } from "../../features/restock/queries";
import { RESTOCK_STATUS_TABS } from "../../features/restock/statusTabs";
import { useTeam } from "../../features/team/TeamContext";
import { useIsMobile } from "../../layouts/shell";
import { AcceptSummary } from "./components/AcceptSummary";
import { CourierCharge } from "./components/CourierCharge";
import { LineCard } from "./components/LineCard";
import type { LineDraft } from "./draft";
import { emptyLine, lineState, receivedLine } from "./draft";
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
export function RestockAcceptPage() {
  const { current } = useTeam();
  const { requestId: rawId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobile = useIsMobile();

  const requestId = parseRequestId(rawId);

  // Only what the person at the door TYPES is state — the restock comes from a query. A line nobody has touched reads
  // as an empty draft, so a line the selling team adds while the box is open simply appears, uncounted.
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [charge, setCharge] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const accept = useAcceptRestockRequest();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  const query = useRestockRequest({ teamId, requestId });
  const request = query.data ?? null;
  const items = request?.items ?? [];
  const loading = query.isPending && teamId !== undefined && requestId !== 0n;
  const loadError = query.isError ? rpcError(query.error) : "";

  const productIds = items.map((i) => i.productId);
  // Where these products already sit, so a put-away joins the existing pile (#156). Help, never a gate.
  const places = useProductPlaces({ warehouseId: teamId, productIds }).data ?? [];
  // The cover pictures, in one batch — someone matching a box recognises the picture before the SKU.
  const products = useProductsByIds({ teamId, productIds }).data;
  const { suppliers, channels } = useLineSuppliers(teamId, items);

  const draftOf = (itemId: bigint) => drafts[itemId.toString()] ?? emptyLine();
  const updater = (itemId: bigint) => (fn: (d: LineDraft) => LineDraft) =>
    setDrafts((prev) => ({ ...prev, [itemId.toString()]: fn(prev[itemId.toString()] ?? emptyLine()) }));

  const lines = items.map((item) => {
    const draft = draftOf(item.id);
    return { item, draft, st: lineState(item, draft) };
  });

  const courierCharge = toRupiah(charge);
  // The charge's note is required once it is above 0 (the-courier-is-paid-once-per-restock).
  const chargeNoteMissing = courierCharge > 0n && chargeNote.trim() === "";

  // The HPP preview mirrors the handler: shipping + the courier's charge, spread over every good unit of the restock.
  const freight = (request?.shipmentCost ?? 0n) + courierCharge;
  const goodAcross = lines.reduce((sum, l) => sum + l.st.good, 0n);

  const unfinished = lines.filter((l) => !l.st.ready).length;
  const ready = lines.length > 0 && unfinished === 0 && !chargeNoteMissing;
  const busy = accept.isPending;

  const ordered = items.reduce((sum, i) => sum + i.count, 0n);
  const inBox = lines.reduce((sum, l) => sum + l.st.received, 0n);

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
        warehouseAdditionalCostNote: courierCharge > 0n ? chargeNote.trim() : "",
      });

      toaster.create({ type: "success", title: t("restock.accept.toast.accepted") });
      navigate(`/inventories/restock/${request.id}`);
    } catch (err) {
      setSubmitError(rpcError(err));
      toaster.create({ type: "error", title: t("restock.accept.toast.failed"), description: rpcError(err) });
    }
  }

  const back = (
    <Button
      size="xs"
      variant="ghost"
      aria-label={t("restock.accept.back")}
      onClick={() => navigate(`/inventories/restock/${rawId ?? ""}`)}
      data-testid="accept-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {mobile ? null : t("restock.accept.back")}
    </Button>
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

  if (loading) {
    return (
      <Stack gap="section">
        {back}
        <Spinner colorPalette="brand" />
      </Stack>
    );
  }

  if (loadError || !request || request.warehouseId !== teamId) {
    return (
      <Stack gap="section">
        {back}
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
      <Stack gap="section" data-testid="restock-accept-page">
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
          {t("restock.accept.openRestock")}
        </Button>
      </Stack>
    );
  }

  // How far the count has got — beside Accept on a desktop, under the sticky row on a phone.
  const progress = (
    <Stack gap="0" textAlign={mobile ? "start" : "end"}>
      <Text fontSize="sm" data-testid="accept-restock-count">
        {t("restock.accept.countSummary", { received: inBox.toString(), ordered: ordered.toString() })}
      </Text>
      {unfinished > 0 ? (
        <Text fontSize="xs" color="warning.fg" data-testid="accept-progress">
          {t("restock.accept.progress", { count: unfinished })}
        </Text>
      ) : chargeNoteMissing ? (
        <Text fontSize="xs" color="warning.fg" data-testid="accept-progress">
          {t("restock.accept.courier.noteRequired")}
        </Text>
      ) : (
        <Text fontSize="xs" color="success.fg" data-testid="accept-ready">
          {t("restock.accept.ready")}
        </Text>
      )}
    </Stack>
  );

  return (
    // NOT capped at the page level (owner): the cap belongs to the read-only summary, not to the counting.
    <Stack gap="section" data-testid="restock-accept-page">
      {/* The action header rides at the top of the scroll: on a long delivery the Accept and the reason it will not
          press must stay in reach. On a phone it is ONE row — back, the title, the status, ⋯
          (the-phone-header-is-one-row) — and the progress comes down under it. */}
      <Box position="sticky" top="0" zIndex="1" bg="bg" borderBottomWidth="1px" borderColor="border" py="card">
        <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"}>
          {back}
          <Heading size="md" truncate>
            {t("restock.accept.title")}
          </Heading>
          <RestockStatusBadge status={request.status} />
          <Spacer />

          {mobile ? (
            <Menu.Root>
              <Menu.Trigger asChild>
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label={t("restock.accept.actions")}
                  data-testid="accept-actions"
                >
                  <Icon as={MoreHorizontal} boxSize="4" />
                </IconButton>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content>
                    <Menu.Item
                      value="accept"
                      disabled={!ready || busy}
                      data-testid="accept-submit"
                      onClick={() => setConfirmOpen(true)}
                    >
                      <Icon as={CheckCheck} boxSize="4" />
                      {t("restock.accept.action")}
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          ) : (
            <>
              {progress}
              <Button
                colorPalette="brand"
                disabled={!ready}
                loading={busy}
                data-testid="accept-submit"
                onClick={() => setConfirmOpen(true)}
              >
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

      <NotImplementedSummary list={RESTOCK_ACCEPT_PENDING} />

      <AcceptSummary request={request} courierCharge={courierCharge} />

      {/* The courier's charge lives OUTSIDE the summary cards (owner): everything in them is already on the record,
          and this is a figure the person at the door types. It moves the owed line above and every HPP below. */}
      <CourierCharge
        amount={charge}
        note={chargeNote}
        charged={courierCharge > 0n}
        noteMissing={chargeNoteMissing}
        onAmount={setCharge}
        onNote={setChargeNote}
      />

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
            suppliers={suppliers}
            channels={channels}
            goodsPrice={unitGoods(item.total, st.good)}
            hpp={unitHpp(item.total, st.good, freight, goodAcross)}
            // Real placements only — a pile with no placement is not somewhere to put things.
            recommendations={places.filter((p) => p.productId === item.productId && p.rackId !== 0n)}
            update={updater(item.id)}
          />
        );
      })}

      {/* Accepting moves stock and cannot be undone, so it confirms first. One dialog for both shells — the desktop
          button and the phone's menu item both open it. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive={false}
        title={t("restock.accept.confirm.title")}
        message={t("restock.accept.confirm.message")}
        confirmLabel={t("restock.accept.confirm.label")}
        onConfirm={submit}
      />
    </Stack>
  );
}
