import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  SimpleGrid,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Printer } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { useBatchReceipt } from "../../features/inventory/queries";

function parseId(raw: string | undefined | null): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function formatDateUnix(unix: bigint): string {
  if (unix <= 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// BatchReceiptPage is the goods-received document for ONE delivery (#219) — the whole delivery, every
// product line (arrived / damaged / accepted / unit cost / line cost / rack). Reached from a batch's
// "Print receipt" (with that product highlighted) and from an Accepted restock. It is meant to be
// PRINTED: a print stylesheet drops the app shell so only the receipt lands on paper.
export function BatchReceiptPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { requestId } = useParams();
  const [params] = useSearchParams();

  const deliveryId = parseId(requestId);
  // When opened from a batch, that batch's line is highlighted.
  const highlightBatch = parseId(params.get("batch"));

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  // Print only the receipt: hide everything, then reveal the receipt card. Scoped to this page — the
  // <style> is added on mount and removed on unmount, so it never leaks into other screens.
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@media print {
      body * { visibility: hidden !important; }
      [data-print-receipt], [data-print-receipt] * { visibility: visible !important; }
      [data-print-receipt] { position: absolute; inset: 0; margin: 0; border: none !important; box-shadow: none !important; }
      [data-print-hide] { display: none !important; }
    }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const query = useBatchReceipt({ warehouseId, deliveryId });
  const data = query.data?.data ?? null;

  const actorName = (id: bigint): string => {
    if (id <= 0n) return "—";
    return query.data?.actorNames.get(id.toString()) ?? `#${id.toString()}`;
  };

  const rackLabel = (rackIds: bigint[]): string => {
    if (rackIds.length === 0) return "—";
    return rackIds
      .map((id) => (id === 0n ? t("racks.select.unplaced") : query.data?.rackCodes.get(id.toString()) ?? `#${id}`))
      .join(", ");
  };

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batchReceipt.title")}</Heading>
        <Text color="fg.muted">{t("batches.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batchReceipt.title")}</Heading>
        <Text color="fg.muted" data-testid="batch-receipt-not-warehouse">
          {t("batches.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (query.isPending) return <Spinner colorPalette="brand" />;

  if (query.isError || !data) {
    return (
      <Stack gap="section">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <Icon as={ArrowLeft} boxSize="4" />
          {t("batchReceipt.back")}
        </Button>
        <Text color="red.fg" data-testid="batch-receipt-error">
          {query.isError ? rpcError(query.error) : t("batchReceipt.notFound")}
        </Text>
      </Stack>
    );
  }

  const cost = (known: boolean, v: bigint) => (known ? formatRupiah(v) : t("batchReceipt.costUnknown"));

  return (
    <Stack gap="section" data-testid="batch-receipt-page">
      {/* Chrome — dropped from the printed page. */}
      <Flex align="center" gap="card" wrap="wrap" data-print-hide>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="batch-receipt-back">
          <Icon as={ArrowLeft} boxSize="4" />
          {t("batchReceipt.back")}
        </Button>
        <Box flex="1" />
        <Button colorPalette="brand" size="sm" onClick={() => window.print()} data-testid="batch-receipt-print">
          <Icon as={Printer} boxSize="4" />
          {t("batchReceipt.print")}
        </Button>
      </Flex>

      {/* The document. */}
      <Box
        data-print-receipt
        data-testid="batch-receipt-doc"
        bg="bg.subtle"
        borderWidth="1px"
        borderColor="border"
        rounded="l3"
        shadow="sm"
        p={{ base: "section", md: "8" }}
        maxW="4xl"
        w="full"
      >
        {/* Header — the warehouse that received it, and the document number. */}
        <Flex justify="space-between" align="start" wrap="wrap" gap="card" mb="section">
          <Stack gap="0">
            <Heading size="md">{query.data?.warehouseName || t("batchReceipt.warehouseFallback")}</Heading>
            <Text color="fg.muted" fontSize="sm">
              {t("batchReceipt.subtitle")}
            </Text>
          </Stack>
          <Stack gap="0" textAlign={{ base: "start", sm: "end" }}>
            <Text fontWeight="bold" fontSize="lg">
              {data.receiptNo || t("batchReceipt.noReceiptNo")}
            </Text>
            <Text color="fg.subtle" fontSize="sm">
              {t("batchReceipt.deliveryNo", { id: data.deliveryId.toString() })}
            </Text>
          </Stack>
        </Flex>

        {/* Meta — supplier, destination, dates and the two actors. */}
        <SimpleGrid columns={{ base: 2, md: 3 }} gap="card" mb="section">
          <Meta label={t("batchReceipt.supplier")}>
            {data.supplierId > 0n ? t("batchReceipt.supplierRef", { id: data.supplierId.toString() }) : "—"}
          </Meta>
          <Meta label={t("batchReceipt.warehouse")}>{query.data?.warehouseName || "—"}</Meta>
          <Meta label={t("batchReceipt.arrived")}>{formatDateUnix(data.arrivedAtUnix)}</Meta>
          <Meta label={t("batchReceipt.createdBy")}>{actorName(data.createdBy)}</Meta>
          <Meta label={t("batchReceipt.acceptedBy")}>{actorName(data.acceptedBy)}</Meta>
        </SimpleGrid>

        {/* Lines — one per product on the delivery. */}
        <Table.Root size="sm" data-testid="batch-receipt-lines">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("batchReceipt.product")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batchReceipt.colArrived")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batchReceipt.colDamaged")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batchReceipt.colAccepted")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batchReceipt.colUnitCost")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batchReceipt.colLineCost")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("batchReceipt.colRack")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.lines.map((l) => {
              const on = highlightBatch > 0n && l.batchId === highlightBatch;
              return (
                <Table.Row
                  key={l.batchId.toString()}
                  bg={on ? "brand.subtle" : undefined}
                  data-testid={`batch-receipt-line-${l.batchId}`}
                >
                  <Table.Cell>
                    <Text as="span" fontWeight={on ? "semibold" : "medium"}>
                      {l.name}
                    </Text>
                    <Text as="span" color="fg.subtle" ml="1">
                      {l.sku}
                    </Text>
                    {on && (
                      <Badge ml="2" colorPalette="brand" size="sm">
                        {t("batchReceipt.thisBatch")}
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell textAlign="end">{l.arrived.toString()}</Table.Cell>
                  <Table.Cell textAlign="end" color={l.damaged > 0n ? "red.fg" : undefined}>
                    {l.damaged.toString()}
                  </Table.Cell>
                  <Table.Cell textAlign="end">{l.accepted.toString()}</Table.Cell>
                  <Table.Cell textAlign="end">{cost(l.costKnown, l.unitCost)}</Table.Cell>
                  <Table.Cell textAlign="end">{cost(l.costKnown, l.lineCost)}</Table.Cell>
                  <Table.Cell>{rackLabel(l.rackIds)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
          <Table.Footer>
            <Table.Row fontWeight="bold">
              <Table.Cell>{t("batchReceipt.total")}</Table.Cell>
              <Table.Cell />
              <Table.Cell />
              <Table.Cell textAlign="end" data-testid="batch-receipt-total-accepted">
                {data.totalAccepted.toString()}
              </Table.Cell>
              <Table.Cell />
              <Table.Cell textAlign="end" data-testid="batch-receipt-total-value">
                {formatRupiah(data.totalValue)}
              </Table.Cell>
              <Table.Cell />
            </Table.Row>
          </Table.Footer>
        </Table.Root>

        <Text color="fg.subtle" fontSize="xs" mt="card">
          {t("batchReceipt.note")}
        </Text>
      </Box>
    </Stack>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap="0">
      <Text textStyle="label" color="fg.subtle">
        {label}
      </Text>
      <Text fontWeight="medium" as="div">
        {children}
      </Text>
    </Stack>
  );
}
