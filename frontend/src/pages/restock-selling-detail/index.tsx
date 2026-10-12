import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Box, Button, Flex, Heading, Icon, IconButton, Spacer, Spinner, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamDetail } from "../../features/teams/queries";
import { useRestockRequest } from "../../features/restock/queries";
import { shortfall } from "../../features/restock/summary";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { useIsMobile } from "../../layouts/shell";
import { InfoPanel } from "./components/InfoPanel";
import { ProductsPanel } from "./components/ProductsPanel";
import { RestockTimeline } from "../../features/restock/RestockTimeline";
import { SellingRestockActions } from "../../features/restock/SellingRestockActions";
import { RESTOCK_SELLING_DETAIL_PENDING } from "./pending";

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
// warehouse door is theirs (the-warehouse-signs-and-accepts-the-team-does-the-rest). So the header carries the
// status and the actions the status allows — Edit · Cancel · Mark Lost while ongoing, Edit Lines once arrived, nothing
// once it is a record (see SellingRestockActions for the matrix).
//
// THREE TABS, split by the question being asked:
//
//   Info      — the parcel (courier, tracking number, photo), the payment (account, invoice, total = goods +
//               shipping), and once accepted the courier's charge this team owes the warehouse, on its own.
//   Products  — each line: where it was bought, its note, and what the box held — ordered, received, good, broken,
//               missing, each problem priced by the system.
//   Timeline  — the trail: every status change and every edit, who and when (edits-are-in-the-same-trail).
//
// Vertical tabs on a desktop (one record read section by section); horizontal on a phone, where a column of tab
// labels would take half the width. The phone header is ONE row — back, the number, the status, ⋯.
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

  if (loading) {
    return <Spinner colorPalette="brand" />;
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

  // Missing units are a fact about the whole delivery, so they sit in the header — the reader must not have to open a
  // tab to learn it went wrong. 0 until accepted: an uncounted box is not short.
  const missing = shortfall(request);
  const warehouseName = warehouse.data?.name || t("restock.warehouseRef", { id: request.warehouseId.toString() });

  const status = (
    <Box data-testid="restock-detail-status">
      <RestockStatusBadge status={request.status} />
    </Box>
  );
  const missingBadge = missing > 0n && (
    <Badge colorPalette="warning" data-testid="restock-detail-missing">
      {t("restock.detail.missingBadge", { count: Number(missing) })}
    </Badge>
  );

  return (
    <Stack gap="section" data-testid="restock-detail-page">
      {isMobile ? (
        // THE PHONE HEADER IS ONE ROW — back, the number, the status, ⋯. A missing count moves to the line under it.
        <Stack gap="1">
          <Flex align="center" gap="2">
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("restock.detail.back")}
              data-testid="restock-detail-back"
              onClick={back}
            >
              <Icon as={ArrowLeft} boxSize="4" />
            </IconButton>
            <Heading size="md" truncate data-testid="restock-detail-title">
              #{request.id.toString()}
            </Heading>
            {status}
            <Spacer />
            <SellingRestockActions
              request={request}
              teamId={teamId}
              variant="menu"
              pending={RESTOCK_SELLING_DETAIL_PENDING}
            />
          </Flex>
          {missingBadge && <Box>{missingBadge}</Box>}
        </Stack>
      ) : (
        <>
          <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="restock-detail-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
            {t("restock.detail.back")}
          </Button>

          <Flex align="center" gap="card" wrap="wrap">
            <Heading size="md" data-testid="restock-detail-title">
              {t("restock.detail.requestTitle", { id: request.id.toString() })}
            </Heading>
            {status}
            {missingBadge}
            <Spacer />
            <SellingRestockActions
              request={request}
              teamId={teamId}
              variant="buttons"
              pending={RESTOCK_SELLING_DETAIL_PENDING}
            />
          </Flex>
        </>
      )}

      <NotImplementedSummary list={RESTOCK_SELLING_DETAIL_PENDING} />

      <Tabs.Root
        defaultValue="info"
        orientation={isMobile ? "horizontal" : "vertical"}
        data-testid="restock-detail-tabs"
      >
        <Tabs.List minW={isMobile ? undefined : "40"}>
          <Tabs.Trigger value="info" data-testid="restock-detail-tab-info">
            {t("restock.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="products" data-testid="restock-detail-tab-products">
            {t("restock.detail.tab.products")}
          </Tabs.Trigger>
          <Tabs.Trigger value="timeline" data-testid="restock-detail-tab-timeline">
            {t("restock.detail.tab.timeline")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* minW="0" ON EVERY PANEL: a vertical Tabs.Root is a flex row, and a flex child will not shrink below its
            content without it — a wide table would widen the panel and scroll the whole page sideways. */}
        <Tabs.Content value="info" flex="1" minW="0">
          <InfoPanel request={request} teamId={teamId} warehouseName={warehouseName} />
        </Tabs.Content>

        <Tabs.Content value="products" flex="1" minW="0">
          <ProductsPanel request={request} teamId={teamId} />
        </Tabs.Content>

        <Tabs.Content value="timeline" flex="1" minW="0">
          <RestockTimeline request={request} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
