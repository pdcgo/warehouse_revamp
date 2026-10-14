import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card, Flex, Heading, HStack, Icon, IconButton, Input, Progress, Span, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, PackagePlus, Repeat } from "lucide-react";

import { rpcError } from "../../api/clients";
import { OpnameSessionStatus } from "../../gen/warehouse/inventory/v1/opname_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { OpnamePlanBadge } from "../../features/opname/OpnameBadges";
import { useOpnameRackCount, useOpnameRacks, useOpnameSession } from "../../features/opname/queries";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { AddFoundDialog } from "./components/AddFoundDialog";
import { CountRowCard } from "./components/CountRowCard";

// OpnameCountPage — COUNTING, AT THE SHELF, ON A PHONE (opname.md §How Staff Work On Session). Pick the rack you stand
// at, then count each product on it, one card each (CountRowCard holds the four steps). The rack's own list comes from
// OpnameRackCount, which never carries a book figure before its row is counted — the blind count is the API's, not only
// the screen's (a-count-is-blind-then-revealed).
//
// An `all` count lists every rack, empty ones too (an-all-count-visits-every-rack): an empty rack shows nothing expected,
// and the counter adds what is really there.
//
// ⚠ PROTOTYPE until design_accept — Storybook's stub plays it.
export function OpnameCountPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
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
  const teams = useTeamsByIds({ ids: (rack.data?.rows ?? []).map((r) => r.teamId) });

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

  return (
    <Stack gap="section" data-testid="opname-count-page">
      <Flex align="center" gap="2" wrap="wrap">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("opnameSession.back")}
          onClick={() => (placementId > 0n ? pickRack(0n) : navigate("/inventories/opname/sessions"))}
          data-testid="opname-count-back"
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md" data-testid="opname-count-heading">
          {t("opnameSession.count.title", { id: session.id.toString() })}
        </Heading>
        <OpnamePlanBadge plan={session.plan} />
      </Flex>

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
            data-testid="opname-count-rack-search"
          />
          <RefreshOverlay busy={racks.isFetching && !racks.isPending}>
            {racks.isPending ? (
              <Spinner colorPalette="brand" />
            ) : (
              <Stack gap="2">
                {(racks.data?.racks ?? []).map((r) => {
                  const done = r.rowCount > 0n && r.countedRowCount === r.rowCount;

                  return (
                    <Card.Root
                      key={r.placementId.toString()}
                      variant="outline"
                      size="sm"
                      cursor="pointer"
                      _hover={{ bg: "bg.subtle" }}
                      onClick={() => pickRack(r.placementId)}
                      data-testid={`opname-count-rack-${r.placementId}`}
                    >
                      <Card.Body gap="2">
                        <HStack justify="space-between">
                          <Span fontWeight="bold">{r.code}</Span>
                          <Span fontSize="sm" color={done ? "success.fg" : "fg.muted"} data-testid={`opname-count-rack-progress-${r.placementId}`}>
                            {r.rowCount === 0n
                              ? t("opnameSession.count.rackEmpty")
                              : t("opnameSession.count.rackProgress", {
                                  counted: r.countedRowCount.toString(),
                                  rows: r.rowCount.toString(),
                                })}
                          </Span>
                        </HStack>
                        {r.rowCount > 0n && (
                          <Progress.Root
                            size="xs"
                            colorPalette={done ? "success" : "brand"}
                            value={Number((r.countedRowCount * 100n) / r.rowCount)}
                          >
                            <Progress.Track>
                              <Progress.Range />
                            </Progress.Track>
                          </Progress.Root>
                        )}
                      </Card.Body>
                    </Card.Root>
                  );
                })}
                <GrowingPager page={page} onPageChange={setPage} hasNext={racks.data?.hasNext} resetKey={q} testId="opname-count-racks-pager" />
              </Stack>
            )}
          </RefreshOverlay>
        </Stack>
      )}

      {active && placementId > 0n && (
        <Stack gap="card" data-testid="opname-count-rack">
          {rack.isPending ? (
            <Spinner colorPalette="brand" />
          ) : rack.isError || !rack.data?.rack ? (
            <Text color="error.fg" data-testid="opname-count-rack-error">
              {rack.isError ? rpcError(rack.error) : t("opnameSession.detail.notFound")}
            </Text>
          ) : (
            <>
              <HStack justify="space-between" gap="2" wrap="wrap">
                <Stack gap="0">
                  <Text fontWeight="bold" fontSize="lg" data-testid="opname-count-rack-code">
                    {rack.data.rack.code}
                  </Text>
                  <Text fontSize="sm" color="fg.muted" data-testid="opname-count-rack-progress">
                    {t("opnameSession.count.rackProgress", {
                      counted: rack.data.rack.countedRowCount.toString(),
                      rows: rack.data.rack.rowCount.toString(),
                    })}
                  </Text>
                </Stack>
                <Button size="xs" variant="outline" onClick={() => pickRack(0n)} data-testid="opname-count-change-rack">
                  <Icon as={Repeat} boxSize="4" />
                  {t("opnameSession.count.changeRack")}
                </Button>
              </HStack>

              <Text fontSize="sm" color="fg.muted">
                {t("opnameSession.count.sellableOnly")}
              </Text>

              {rack.data.rows.length === 0 && (
                <Text color="fg.muted" data-testid="opname-count-nothing-expected">
                  {t("opnameSession.count.nothingExpected")}
                </Text>
              )}

              <Stack gap="2">
                {rack.data.rows.map((row) => (
                  <CountRowCard key={row.id.toString()} row={row} teamId={teamId} teamName={teamName(row.teamId)} />
                ))}
              </Stack>

              <Button variant="outline" alignSelf="flex-start" onClick={() => setAdding(true)} data-testid="opname-count-add-found">
                <Icon as={PackagePlus} boxSize="4" />
                {t("opnameSession.found.open")}
              </Button>

              <AddFoundDialog
                warehouseId={teamId}
                sessionId={sessionId}
                placementId={placementId}
                rackCode={rack.data.rack.code}
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
