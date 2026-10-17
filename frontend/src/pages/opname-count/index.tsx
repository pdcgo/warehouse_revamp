import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Input,
  Menu,
  Portal,
  Progress,
  SimpleGrid,
  Span,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, MoreHorizontal, PackagePlus, Repeat } from "lucide-react";

import { rpcError } from "../../api/clients";
import { type OpnameRack, OpnameSessionStatus } from "../../gen/warehouse/inventory/v1/opname_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useProductsByIds } from "../../features/products/queries";
import { OpnamePlanBadge } from "../../features/opname/OpnameBadges";
import { useOpnameRackCount, useOpnameRacks, useOpnameSession } from "../../features/opname/queries";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { useIsMobile } from "../../layouts/shell";
import { AddFoundDialog } from "./components/AddFoundDialog";
import { CountRowCard } from "./components/CountRowCard";

// OpnameCountPage — COUNTING, AT THE SHELF, ON A PHONE (opname.md §How Staff Work On Session), laid out like Accept
// Delivery (owner): a sticky header carrying where you are and how far it has got, then one three-column card per
// product (CountRowCard). Pick the rack you stand at first — the racks are tiles, three a row on a desktop, one on a
// phone. The rack's own list comes from OpnameRackCount, which never carries a book figure before its row is counted —
// the blind count is the API's, not only the screen's (a-count-is-blind-then-revealed).
//
// An `all` count lists every rack, empty ones too (an-all-count-visits-every-rack): an empty rack shows nothing expected,
// and the counter adds what is really there.
//
// ⚠ PROTOTYPE until design_accept — Storybook's stub plays it.
export function OpnameCountPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const { t } = useTranslation();
  const params = useParams();
  const sessionId = BigInt(params.sessionId ?? "0");
  const [search, setSearch] = useSearchParams();
  const rackParam = search.get("rack");
  const placementId = rackParam ? BigInt(rackParam) : 0n;

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const teamId = current?.teamId;
  const detail = useOpnameSession({ teamId, sessionId });
  const racks = useOpnameRacks({ teamId, sessionId, q, page, pageSize: 20 });
  const rack = useOpnameRackCount({ teamId, sessionId, placementId });
  const rows = rack.data?.rows ?? [];
  const teams = useTeamsByIds({ ids: rows.map((r) => r.teamId) });
  // The cover pictures, in one batch — someone at a shelf recognises the picture before the SKU.
  const products = useProductsByIds({ teamId, productIds: rows.map((r) => r.productId) }).data;

  if (!current || teamId === undefined) {
    return <Text color="fg.muted">{t("opnameSession.selectTeam")}</Text>;
  }

  const session = detail.data?.session ?? null;
  if (detail.isPending) return <Spinner colorPalette="brand" />;
  if (!session) {
    return (
      <Text color="error.fg" data-testid="opname-count-session-error">
        {detail.isError ? rpcError(detail.error) : t("opnameSession.detail.notFound")}
      </Text>
    );
  }

  const active = session.status === OpnameSessionStatus.ACTIVE;
  const pickRack = (id: bigint) => setSearch(id > 0n ? { rack: id.toString() } : {});
  const teamName = (id: bigint) => teams.data?.[id.toString()]?.name ?? `#${id}`;
  const onRack = active && placementId > 0n;
  const here = onRack ? rack.data?.rack : undefined;

  // How far it has got: this rack's rows once one is picked, the whole count's before.
  const progress = (
    <Text fontSize="sm" color="fg.muted" data-testid={here ? "opname-count-rack-progress" : "opname-count-session-progress"}>
      {here
        ? t("opnameSession.count.rackProgress", { counted: here.countedRowCount.toString(), rows: here.rowCount.toString() })
        : t("opnameSession.count.rackProgress", { counted: session.countedRowCount.toString(), rows: session.rowCount.toString() })}
    </Text>
  );

  return (
    <Stack gap="section" data-testid="opname-count-page">
      {/* The header rides at the top of the scroll — on a long rack, where you are and Add Found stay in reach. On a
          phone it is ONE row — back, the title, ⋯ (the-phone-header-is-one-row) — and the progress comes under it. */}
      <Box position="sticky" top="0" zIndex="1" bg="bg" borderBottomWidth="1px" borderColor="border" py="card">
        <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={t("opnameSession.back")}
            onClick={() => (placementId > 0n ? pickRack(0n) : navigate("/inventories/opname/sessions"))}
            data-testid="opname-count-back"
          >
            <Icon as={ArrowLeft} boxSize="4" />
          </IconButton>
          <Heading size="md" truncate data-testid="opname-count-heading">
            {t("opnameSession.count.title", { id: session.id.toString() })}
            {here && (
              <>
                {" · "}
                <Span data-testid="opname-count-rack-code">{here.code}</Span>
              </>
            )}
          </Heading>
          {!mobile && <OpnamePlanBadge plan={session.plan} />}
          <Spacer />

          {here &&
            (mobile ? (
              <Menu.Root>
                <Menu.Trigger asChild>
                  <IconButton size="xs" variant="ghost" aria-label={t("opnameSession.count.actions")} data-testid="opname-count-actions">
                    <Icon as={MoreHorizontal} boxSize="4" />
                  </IconButton>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content>
                      <Menu.Item value="change-rack" onClick={() => pickRack(0n)} data-testid="opname-count-change-rack">
                        <Icon as={Repeat} boxSize="4" />
                        {t("opnameSession.count.changeRack")}
                      </Menu.Item>
                      <Menu.Item value="add-found" onClick={() => setAdding(true)} data-testid="opname-count-add-found">
                        <Icon as={PackagePlus} boxSize="4" />
                        {t("opnameSession.found.open")}
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            ) : (
              <>
                {progress}
                <Button variant="outline" onClick={() => pickRack(0n)} data-testid="opname-count-change-rack">
                  <Icon as={Repeat} boxSize="4" />
                  {t("opnameSession.count.changeRack")}
                </Button>
                <Button colorPalette="brand" variant="outline" onClick={() => setAdding(true)} data-testid="opname-count-add-found">
                  <Icon as={PackagePlus} boxSize="4" />
                  {t("opnameSession.found.open")}
                </Button>
              </>
            ))}
          {!here && !mobile && active && progress}
        </Flex>
      </Box>

      {mobile && active && progress}

      {!active && (
        <Text color="fg.muted" data-testid="opname-count-closed">
          {t("opnameSession.count.closed")}
        </Text>
      )}

      {active && placementId === 0n && (
        <Stack gap="card" data-testid="opname-count-racks">
          <Stack gap="1">
            <Text fontWeight="bold">{t("opnameSession.count.pickRack")}</Text>
            <Text fontSize="sm" color="fg.muted">
              {t("opnameSession.count.pickRackHelp")}
            </Text>
          </Stack>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder={t("opnameSession.count.rackSearch")}
            maxW={{ lg: "md" }}
            data-testid="opname-count-rack-search"
          />
          <RefreshOverlay busy={racks.isFetching && !racks.isPending}>
            {racks.isPending ? (
              <Spinner colorPalette="brand" />
            ) : (
              <Stack gap="card">
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="card">
                  {(racks.data?.racks ?? []).map((r) => (
                    <RackTile key={r.placementId.toString()} rack={r} onPick={() => pickRack(r.placementId)} />
                  ))}
                </SimpleGrid>
                <GrowingPager page={page} onPageChange={setPage} hasNext={racks.data?.hasNext} resetKey={q} testId="opname-count-racks-pager" />
              </Stack>
            )}
          </RefreshOverlay>
        </Stack>
      )}

      {onRack && (
        <Stack gap="card" data-testid="opname-count-rack">
          {rack.isPending ? (
            <Spinner colorPalette="brand" />
          ) : rack.isError || !here ? (
            <Text color="error.fg" data-testid="opname-count-rack-error">
              {rack.isError ? rpcError(rack.error) : t("opnameSession.detail.notFound")}
            </Text>
          ) : (
            <>
              <Text fontSize="sm" color="fg.muted">
                {t("opnameSession.count.sellableOnly")}
              </Text>

              {rows.length === 0 && (
                <Card.Root variant="outline" borderStyle="dashed" data-testid="opname-count-nothing-expected">
                  <Card.Body gap="card" alignItems="flex-start">
                    <Text color="fg.muted">{t("opnameSession.count.nothingExpected")}</Text>
                    <Button variant="outline" onClick={() => setAdding(true)} data-testid="opname-count-empty-add">
                      <Icon as={PackagePlus} boxSize="4" />
                      {t("opnameSession.found.open")}
                    </Button>
                  </Card.Body>
                </Card.Root>
              )}

              {rows.map((row) => {
                const product = products?.get(row.productId.toString());

                return (
                  <CountRowCard
                    key={row.id.toString()}
                    row={row}
                    teamId={teamId}
                    teamName={teamName(row.teamId)}
                    imageUrl={product?.defaultImageUrl}
                    thumbnailUrl={product?.defaultImageThumbnailUrl}
                  />
                );
              })}

              <AddFoundDialog
                warehouseId={teamId}
                sessionId={sessionId}
                placementId={placementId}
                rackCode={here.code}
                open={adding}
                onOpenChange={setAdding}
              />
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
}

// ONE RACK, as a tile: its code and its state, then how far its count has got.
function RackTile({ rack, onPick }: { rack: OpnameRack; onPick: () => void }) {
  const { t } = useTranslation();
  const empty = rack.rowCount === 0n;
  const done = !empty && rack.countedRowCount === rack.rowCount;
  const started = rack.countedRowCount > 0n;
  const state = empty
    ? { key: "opnameSession.count.rackState.empty", color: "gray" }
    : done
      ? { key: "opnameSession.count.rackState.done", color: "success" }
      : started
        ? { key: "opnameSession.count.rackState.inProgress", color: "info" }
        : { key: "opnameSession.count.rackState.notStarted", color: "gray" };

  return (
    <Card.Root
      variant="outline"
      size="sm"
      cursor="pointer"
      _hover={{ bg: "bg.subtle" }}
      onClick={onPick}
      data-testid={`opname-count-rack-${rack.placementId}`}
    >
      <Card.Body gap="3">
        <HStack justify="space-between" gap="2">
          <Span fontWeight="bold" fontSize="lg">
            {rack.code}
          </Span>
          <Badge colorPalette={state.color} data-testid={`opname-count-rack-state-${rack.placementId}`}>
            {t(state.key)}
          </Badge>
        </HStack>
        <Stack gap="1.5">
          <Text fontSize="sm" color={done ? "success.fg" : "fg.muted"} data-testid={`opname-count-rack-progress-${rack.placementId}`}>
            {empty
              ? t("opnameSession.count.rackEmpty")
              : t("opnameSession.count.rackProgress", { counted: rack.countedRowCount.toString(), rows: rack.rowCount.toString() })}
          </Text>
          <Progress.Root
            size="xs"
            colorPalette={done ? "success" : "brand"}
            value={empty ? 0 : Number((rack.countedRowCount * 100n) / rack.rowCount)}
          >
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
