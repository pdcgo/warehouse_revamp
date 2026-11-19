import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Button, Flex, Heading, Icon, Spacer, Span, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { PackageOpen, Plus, SearchX } from "lucide-react";

import { personName } from "../../lib/users";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { useActors } from "../../features/users/queries";
import type { CustomShipmentKind } from "../../features/customShipment/customShipments";
import {
  CUSTOM_SHIPMENTS_PATH,
  STATUS_TABS,
  customShipmentPath,
  statusTab,
} from "../../features/customShipment/customShipments";
import { useCustomShipmentPrototype } from "../../features/customShipment/customShipmentPrototype";
import { CustomShipmentKindBadge, CustomShipmentStatusBadge } from "../../features/customShipment/CustomShipmentBadges";
import { CustomShipmentBlock, ItemsLine, PayLine } from "../../features/customShipment/CustomShipmentBlock";
import { SellingCustomShipmentActions } from "../../features/customShipment/SellingCustomShipmentActions";
import { useIsMobile } from "../../layouts/shell";
import { CompactActions } from "../../components/chrome/CompactActions";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { ChoiceFilter } from "../../components/pickers/ChoiceFilter";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { idCodec, oneOfCodec, optionalCodec, textCodec, useUrlState } from "../../lib/urlState";

const STATUS_CODEC = oneOfCodec(STATUS_TABS.map((tab) => tab.value));
const KIND_CODEC = optionalCodec(oneOfCodec<"sample" | "reship">(["sample", "reship"]));
const KIND_OF: Record<"sample" | "reship", CustomShipmentKind> = { sample: "SAMPLE", reship: "RESTOCK_RESHIP" };
const PAGE_SIZE_OPTIONS = [10, 20, 50];

/** KIRIM PAKET — the selling team's own parcels (the-selling-team-asks-the-warehouse-ships). */
export function CustomShipmentSellingPage() {
  return <CustomShipmentList side="selling" />;
}

/** The warehouse's parcels to ship — the queue it picks, packs and hands over from. */
export function CustomShipmentWarehousePage() {
  return <CustomShipmentList side="warehouse" />;
}

// ONE LIST, TWO READERS — as the transfer's two lists are one shape (the-transfer-lists-read-as-blocks-on-a-phone):
//
//   the team        its own parcels: ＋ Paket Baru, the warehouse it ships from, the sample's value, its ongkir, ⋯
//   the warehouse   the parcels it ships: whose they are, no money but the ongkir IT paid
//                   (a-warehouse-sees-no-seller-money, the-warehouse-sees-the-ongkir-it-paid); a row opens its pick page
//
// The strip, then the STATUS TABS, as the accepted transfer lists draw them; the KIND is a filter in the strip — one
// fixed choice of two (components/pickers/ChoiceFilter), so a second tab row is not stacked on the first. Every pick lives in the URL
// (a-lists-filters-live-in-the-url). The prototype answers every row at once; the build pages on the server.
function CustomShipmentList({ side }: { side: "selling" | "warehouse" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();
  const phone = useIsMobile();
  const prototype = useCustomShipmentPrototype();

  const [tab, setTab] = useUrlState("status", "all", STATUS_CODEC);
  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [kind, setKind] = useUrlState("kind", undefined, KIND_CODEC);
  const [warehouseFilter, setWarehouseFilter] = useUrlState("warehouse", 0n, idCodec);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const active = statusTab(tab);
  const rows =
    prototype?.list({
      status: active.status,
      kind: kind ? KIND_OF[kind] : undefined,
      q: search,
      warehouseId: side === "selling" ? warehouseFilter : 0n,
    }) ?? [];
  const shown = rows.slice(0, page * pageSize);
  const teams = useTeamsByIds({ ids: rows.map((s) => (side === "selling" ? s.warehouseId : s.teamId)) });
  const couriers = useShipmentChannelsByIds(rows.map((s) => s.shipmentChannelId));
  const actors = useActors(rows.map((s) => s.createdByUserId));

  const filtered = search !== "" || kind !== undefined || (side === "selling" && warehouseFilter > 0n);
  const writable = side === "selling" && canWrite(current);

  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }
  const clear = () =>
    refilter(() => {
      setSearch("");
      setKind(undefined);
      setWarehouseFilter(0n);
    });

  if (!prototype) {
    return (
      <Text color="fg.muted" data-testid="custom-shipment-unavailable">
        {t("customShipment.unavailable")}
      </Text>
    );
  }

  if (!current || prototype.side !== side) {
    return (
      <Text color="fg.muted" data-testid="custom-shipment-wrong-team">
        {t(side === "selling" ? "customShipment.sellingOnly" : "customShipment.warehouseOnly")}
      </Text>
    );
  }

  const otherTeam = (id: bigint) => teams.data?.[id.toString()]?.name || t("customShipment.teamRef", { id: id.toString() });
  const createdBy = (id: bigint) =>
    id === 0n ? "" : personName(actors.data?.get(id.toString()), t("customShipment.userRef", { id: id.toString() }));
  const openNew = () => navigate(`${CUSTOM_SHIPMENTS_PATH}/new`);

  function emptyHint() {
    if (filtered) {
      return (
        <EmptyHint
          icon={SearchX}
          title={t("customShipment.none")}
          description={t("emptyHint.noMatch")}
          action={
            <Button variant="outline" colorPalette="gray" data-testid="custom-shipments-empty-clear" onClick={clear}>
              {t("common.clearFilters")}
            </Button>
          }
          testId="custom-shipments-empty"
        />
      );
    }

    const whole = active.status === undefined;

    return (
      <EmptyHint
        icon={PackageOpen}
        title={
          whole
            ? t(side === "selling" ? "customShipment.empty" : "customShipment.emptyWarehouse")
            : t("customShipment.emptyTab", { status: t(active.labelKey).toLowerCase() })
        }
        description={whole && side === "selling" ? t("customShipment.emptyHint") : undefined}
        action={
          whole && writable ? (
            <Button colorPalette="brand" data-testid="open-create-custom-shipment-empty" onClick={openNew}>
              <Icon as={Plus} boxSize="4" />
              {t("customShipment.new")}
            </Button>
          ) : undefined
        }
        testId="custom-shipments-empty"
      />
    );
  }

  const title = t(side === "selling" ? "customShipment.title" : "customShipment.titleWarehouse");

  return (
    <Stack gap="section" data-testid={`custom-shipments-${side}`}>
      {phone ? (
        // ON A PHONE THE PAGE NAMES ITSELF (the-phone-shell-has-no-top-bar); Paket Baru is its ＋
        // (a-phone-header-action-is-an-icon).
        <Flex align="center" gap="2" data-layout="phone">
          <Heading size="md" flex="1" minW="0">
            {title}
          </Heading>
          {writable && (
            <CompactActions
              menuLabel={t("customShipment.actions.menu")}
              actions={[
                { id: "create", label: t("customShipment.new"), icon: Plus, primary: true, testId: "open-create-custom-shipment", onClick: openNew },
              ]}
            />
          )}
        </Flex>
      ) : (
        writable && (
          <Flex align="center" gap="card">
            <Spacer />
            <Button size="xs" colorPalette="brand" data-testid="open-create-custom-shipment" onClick={openNew}>
              <Icon as={Plus} boxSize="4" />
              {t("customShipment.new")}
            </Button>
          </Flex>
        )
      )}

      <FilterBar
        active={filtered}
        count={(search !== "" ? 1 : 0) + (kind !== undefined ? 1 : 0) + (side === "selling" && warehouseFilter > 0n ? 1 : 0)}
        testId="custom-shipment-filters"
        onClear={clear}
      >
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("customShipment.searchPlaceholder")}
          testId="custom-shipment-search"
        />
        <FilterField w="13rem" testId="custom-shipment-kind-filter">
          <ChoiceFilter
            value={kind}
            onChange={(value) => refilter(() => setKind(value))}
            options={[
              { value: "sample", label: t("customShipment.kind.sample") },
              { value: "reship", label: t("customShipment.kind.reship") },
            ]}
            placeholder={t("customShipment.kindAll")}
            testId="custom-shipment-kind"
          />
        </FilterField>
        {side === "selling" && (
          <FilterField w="15rem" testId="custom-shipment-warehouse-filter">
            <TeamSelect
              value={warehouseFilter > 0n ? warehouseFilter : undefined}
              teamType={TeamType.WAREHOUSE}
              placeholder={t("customShipment.warehouseAll")}
              onChange={(id) => refilter(() => setWarehouseFilter(id))}
            />
          </FilterField>
        )}
      </FilterBar>

      <Tabs.Root value={tab} onValueChange={(e) => refilter(() => setTab(e.value as typeof tab))} lazyMount unmountOnExit>
        <Tabs.List overflowX="auto" overflowY="hidden" {...(phone ? { flexWrap: "nowrap", css: { scrollbarWidth: "none" } } : {})}>
          {STATUS_TABS.map((item) => (
            <Tabs.Trigger
              key={item.value}
              value={item.value}
              flexShrink={phone ? 0 : undefined}
              data-testid={`custom-shipment-tab-${item.value}`}
            >
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <Stack gap="section">

            {rows.length === 0 ? (
              emptyHint()
            ) : phone ? (
              <Stack gap="3" data-testid="custom-shipments-table" data-layout="phone">
                {shown.map((s) => (
                  <CustomShipmentBlock
                    key={s.id.toString()}
                    shipment={s}
                    side={side}
                    otherTeam={otherTeam(side === "selling" ? s.warehouseId : s.teamId)}
                    createdBy={createdBy(s.createdByUserId)}
                    courier={couriers.data?.get(s.shipmentChannelId.toString())}
                    onOpen={() => navigate(customShipmentPath(s.id))}
                  />
                ))}
              </Stack>
            ) : (
              <Box overflowX="auto">
                <Table.Root size="sm" data-testid="custom-shipments-table">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("customShipment.table.parcel")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("customShipment.table.kind")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("customShipment.table.recipient")}</Table.ColumnHeader>
                      <Table.ColumnHeader>
                        {t(side === "selling" ? "customShipment.table.warehouse" : "customShipment.table.owner")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader>{t("customShipment.table.products")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("customShipment.table.shipping")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("customShipment.table.created")}</Table.ColumnHeader>
                      {side === "selling" && (
                        <>
                          <Table.ColumnHeader textAlign="end">{t("customShipment.table.value")}</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">{t("customShipment.table.actions")}</Table.ColumnHeader>
                        </>
                      )}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {shown.map((s) => {
                      const by = createdBy(s.createdByUserId);

                      return (
                        <Table.Row
                          key={s.id.toString()}
                          data-testid={`custom-shipment-row-${s.id}`}
                          cursor="pointer"
                          _hover={{ bg: "bg.subtle" }}
                          onClick={() => navigate(customShipmentPath(s.id))}
                        >
                          {/* ONE CONTEXT PER CELL, NEVER THREE LINES (one-context-per-column-and-never-three-lines): the
                              parcel and where it stands; its kind; who it goes to; the other end; what is in it; how it
                              travels and who pays; when and by whom it was asked for. */}
                          <Table.Cell>
                            <Stack gap="1" align="start">
                              <Span fontWeight="medium">#{s.id.toString()}</Span>
                              <CustomShipmentStatusBadge status={s.status} />
                            </Stack>
                          </Table.Cell>
                          <Table.Cell>
                            <CustomShipmentKindBadge kind={s.kind} />
                          </Table.Cell>
                          <Table.Cell data-testid={`custom-shipment-recipient-${s.id}`}>
                            <Stack gap="0">
                              <Span>{s.recipient.name}</Span>
                              <Span fontSize="xs" color="fg.muted">
                                {s.recipient.phone}
                              </Span>
                            </Stack>
                          </Table.Cell>
                          <Table.Cell data-testid={`custom-shipment-other-${s.id}`}>
                            {otherTeam(side === "selling" ? s.warehouseId : s.teamId)}
                          </Table.Cell>
                          <Table.Cell>
                            <ItemsLine shipment={s} />
                          </Table.Cell>
                          <Table.Cell>
                            <Stack gap="0" align="start">
                              <ShipmentChannelBadge
                                channelId={s.shipmentChannelId}
                                channel={couriers.data?.get(s.shipmentChannelId.toString())}
                              />
                              <PayLine shipment={s} side={side} />
                            </Stack>
                          </Table.Cell>
                          <Table.Cell>
                            <Stack gap="0">
                              <Span fontSize="sm" whiteSpace="nowrap">
                                {formatUnixDateTimeShort(s.createdAtUnix)}
                              </Span>
                              {by && (
                                <Span fontSize="xs" color="fg.muted">
                                  {t("customShipment.table.by", { name: by })}
                                </Span>
                              )}
                            </Stack>
                          </Table.Cell>
                          {side === "selling" && (
                            <>
                              <Table.Cell textAlign="end" whiteSpace="nowrap" data-testid={`custom-shipment-value-${s.id}`}>
                                {s.kind === "SAMPLE" ? formatRupiahNumber(s.total) : "—"}
                              </Table.Cell>
                              <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                                <SellingCustomShipmentActions shipment={s} variant="menu" />
                              </Table.Cell>
                            </>
                          )}
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}

            {/* The pager is always on screen (the-pager-is-always-on-screen, every-list-pages-with-the-growing-pager). */}
            <GrowingPager
              page={page}
              onPageChange={setPage}
              hasNext={page * pageSize < rows.length}
              resetKey={[tab, search, kind, warehouseFilter, pageSize].join("|")}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              testId="custom-shipment-pager"
            />
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
