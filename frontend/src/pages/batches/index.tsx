import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Flex,
  Heading,
  Input,
  NativeSelect,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Stat,
  Table,
  Text,
} from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import { BatchDateField, BatchExpiryFilter } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useWarehouseBatches } from "../../features/inventory/queries";
import { Pagination } from "../../components/chrome/Pagination";
import {
  ALL_DATES,
  DateRangePicker,
  isAllDates,
  resolveRange,
  type DateRange,
} from "../../components/datetime/DateRangePicker";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE = 20;

function formatDateUnix(unix: bigint): string {
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isExpiringSoon(unix: bigint): boolean {
  return Number(unix) * 1000 <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

// BatchesPage is the warehouse-wide list of every stock batch (#209) — a cost layer per delivery line,
// browsable by receipt/batch number and by expiry, so a manager can find what is running out.
export function BatchesPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const [search, setSearch] = useState("");
  const [expiry, setExpiry] = useState<number>(BatchExpiryFilter.UNSPECIFIED);
  const [dateField, setDateField] = useState<number>(BatchDateField.ARRIVED);
  const [dateRange, setDateRange] = useState<DateRange>(ALL_DATES);
  const [page, setPage] = useState(1);

  const { fromUnix, toUnix } = resolveRange(dateRange);
  const query = useWarehouseBatches({
    warehouseId,
    search,
    supplierId: 0n,
    expiry,
    // A range with no bound chosen applies to nothing, so send UNSPECIFIED unless a bound is set.
    dateField: isAllDates(dateRange) ? BatchDateField.UNSPECIFIED : dateField,
    fromUnix,
    toUnix,
    page,
    pageSize: PAGE_SIZE,
  });
  const res = query.data?.res;
  const ownerByProduct = query.data?.ownerByProduct;
  const batches = res?.batches ?? [];
  const total = Number(res?.pageInfo?.totalItems ?? 0n);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batches.title")}</Heading>
        <Text color="fg.muted">{t("batches.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batches.title")}</Heading>
        <Text color="fg.muted" data-testid="batches-not-warehouse">
          {t("batches.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="batches-page">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("batches.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
      </Flex>

      {/* The header numbers, over the whole filtered set. */}
      <SimpleGrid columns={{ base: 1, sm: 3 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("batches.statBatches")}</Stat.Label>
          <Stat.ValueText data-testid="batches-stat-count">{total.toString()}</Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batches.statReadyValue")}</Stat.Label>
          <Stat.ValueText>{formatRupiah(res?.readyValueTotal ?? 0n)}</Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batches.statExpiring")}</Stat.Label>
          <Stat.ValueText color={(res?.expiringSoonCount ?? 0n) > 0n ? "orange.fg" : undefined}>
            {(res?.expiringSoonCount ?? 0n).toString()}
          </Stat.ValueText>
        </Stat.Root>
      </SimpleGrid>

      <Flex gap="card" wrap="wrap" align="center">
        <Input
          maxW="sm"
          placeholder={t("batches.searchPlaceholder")}
          value={search}
          data-testid="batches-search"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <NativeSelect.Root maxW="52">
          <NativeSelect.Field
            value={expiry.toString()}
            data-testid="batches-expiry"
            onChange={(e) => {
              setExpiry(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={BatchExpiryFilter.UNSPECIFIED.toString()}>{t("batches.expiryAll")}</option>
            <option value={BatchExpiryFilter.EXPIRING_SOON.toString()}>{t("batches.expirySoon")}</option>
            <option value={BatchExpiryFilter.NO_EXPIRY.toString()}>{t("batches.expiryNone")}</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        {/* Date range on the Arrived or Expiring date (#217/#225) — the time-type segment and the window
            live in one control now: find what came in, or expires, in a window. */}
        <DateRangePicker
          value={dateRange}
          testId="batches-date-range"
          fields={[
            { value: BatchDateField.ARRIVED, label: t("batches.dateArrived") },
            { value: BatchDateField.EXPIRING, label: t("batches.dateExpiring") },
          ]}
          field={dateField}
          onFieldChange={(v) => {
            setDateField(v);
            setPage(1);
          }}
          onChange={(r) => {
            setDateRange(r);
            setPage(1);
          }}
        />
        <Spacer />
      </Flex>

      {query.isPending ? (
        <Spinner colorPalette="brand" />
      ) : query.isError ? (
        <Text color="red.fg" data-testid="batches-error">
          {rpcError(query.error)}
        </Text>
      ) : (
        <Stack gap="card">
          <Table.Root size="sm" data-testid="batches-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("batches.colBatch")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colProduct")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colTeam")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colArrived")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("batches.colReady")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("batches.colCost")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("batches.colReadyValue")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colExpiring")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {batches.map((b) => (
                <Table.Row
                  key={b.id.toString()}
                  cursor="pointer"
                  _hover={{ bg: "bg.muted" }}
                  data-testid={`batches-row-${b.id}`}
                  onClick={() => navigate(`/inventories/batches/${b.id}`)}
                >
                  <Table.Cell>
                    <Text as="span" fontWeight="medium">
                      #{b.deliveryId.toString()}
                    </Text>
                    {b.receiptNo && (
                      <Text as="span" color="fg.subtle" ml="1">
                        {b.receiptNo}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {b.name}
                    <Text as="span" color="fg.subtle" ml="1">
                      {b.sku}
                    </Text>
                  </Table.Cell>
                  {/* The catalogue OWNER (#142) — a warehouse holds several teams' goods. Distinct from
                      the supplier who delivered them. */}
                  <Table.Cell>
                    {ownerByProduct?.get(b.productId.toString()) ? (
                      <Badge colorPalette="brand">{ownerByProduct.get(b.productId.toString())}</Badge>
                    ) : (
                      <Text as="span" color="fg.subtle">
                        —
                      </Text>
                    )}
                  </Table.Cell>
                  {/* Arrived = when the batch was minted, which is when the delivery was accepted. */}
                  <Table.Cell>{b.createdAtUnix > 0n ? formatDateUnix(b.createdAtUnix) : "—"}</Table.Cell>
                  <Table.Cell textAlign="end">
                    {b.ready.toString()}
                    {b.ready === 0n && (
                      <Badge ml="2" colorPalette="gray">
                        {t("batches.depleted")}
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    {b.costKnown ? formatRupiah(b.unitCost) : t("batches.costUnknown")}
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    {b.costKnown ? formatRupiah(b.readyValue) : t("batches.costUnknown")}
                  </Table.Cell>
                  <Table.Cell>
                    {b.expiresOnUnix > 0n ? (
                      <Text color={isExpiringSoon(b.expiresOnUnix) ? "orange.fg" : undefined}>
                        {formatDateUnix(b.expiresOnUnix)}
                      </Text>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>

          {batches.length === 0 ? (
            <Text color="fg.muted" data-testid="batches-empty">
              {t("batches.empty")}
            </Text>
          ) : (
            <Pagination page={page} pageSize={PAGE_SIZE} count={total} onPageChange={setPage} />
          )}
        </Stack>
      )}
    </Stack>
  );
}
