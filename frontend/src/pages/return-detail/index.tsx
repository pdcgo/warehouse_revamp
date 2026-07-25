import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  Separator,
  SimpleGrid,
  Spacer,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { useTeam } from "../../features/team/TeamContext";
import { TeamItem } from "../../components/TeamItem";
import { MarketplaceBadge } from "../../components/MarketplaceBadge";
import { toaster } from "../../components/Toaster";
import { formatRupiah } from "../../lib/money";

// A return's lifecycle mirrors the restock request (brainstorming §4.3): ONGOING while the goods are
// somewhere between the buyer and the warehouse, RECEIVED once they are counted & inspected, CANCELLED
// if they never came.
type ReturnStatus = "ongoing" | "received" | "cancelled";

const STATUS_PALETTE: Record<ReturnStatus, string> = {
  ongoing: "orange",
  received: "green",
  cancelled: "gray",
};

// One product line of a return: what a buyer sent back. On an ONGOING return only `expected` is known.
// Once RECEIVED, the count is INSPECTED (brainstorming §4.1): it splits into `sellable` — back to a
// shelf, and placed at `rack` — and `writtenOff` — broken, so the goods AND the money are gone. The
// two need not sum to `expected`: a short return arrives with fewer pieces than the buyer promised.
interface ReturnLine {
  productId: number;
  sku: string;
  name: string;
  // Absent SKU/name is a legitimate state (an unlabeled parcel with nothing identifying it).
  unknown?: boolean;
  expected: number;
  sellable?: number;
  writtenOff?: number;
  rack?: string;
  // Refund value per piece, in whole rupiah. Absent when the return carries no order to reduce.
  unitRupiah?: bigint;
}

// One return's full record — the list row plus the per-line breakdown that only a PAGE can show. The
// header fields mirror the list (kept in sync by hand until the ReturnDetail RPC replaces both).
interface ReturnRecord {
  id: string;
  code: string;
  createdUnix: number;
  orderId?: number;
  team: string;
  shop?: string;
  marketplace?: Marketplace;
  customer?: string;
  address?: string;
  note?: string;
  valueRupiah?: bigint;
  acceptedUnix?: number;
  acceptedBy?: string;
  status: ReturnStatus;
  lines: ReturnLine[];
}

// PREVIEW DATA — keyed by the same ids the returns list uses, so clicking a row opens the matching
// record. The return_service does not exist yet (#163), so this page is designed mock-first and wired
// to hardcoded records; when the ReturnDetail RPC lands (#229) this map is replaced by a query.
const SAMPLE: Record<string, ReturnRecord> = {
  "1": {
    id: "1", code: "RTN-0142", createdUnix: 1769212800, orderId: 4127, team: "Selling Alpha",
    shop: "Alpha Store", marketplace: Marketplace.SHOPEE, customer: "Rina Wijaya",
    address: "Jl. Kenanga 12, Bandung", note: "Wrong item — ordered blue, got black",
    valueRupiah: 145000n, status: "ongoing",
    lines: [{ productId: 811, sku: "TS-BLK-M", name: "Kaos Polos Hitam M", expected: 1, unitRupiah: 145000n }],
  },
  "2": {
    id: "2", code: "RTN-0141", createdUnix: 1769212800, orderId: 4098, team: "Selling Beta",
    shop: "Beta Official", marketplace: Marketplace.TOKOPEDIA, customer: "Budi Santoso",
    address: "Jl. Melati 8, Surabaya", note: "Arrived damaged in transit", valueRupiah: 90000n,
    status: "ongoing",
    lines: [{ productId: 622, sku: "MUG-CRM-01", name: "Mug Keramik 300ml", expected: 2, unitRupiah: 45000n }],
  },
  "3": {
    id: "3", code: "RTN-0140", createdUnix: 1769126400, team: "Selling Alpha",
    note: "Unlabeled parcel — no order found", status: "ongoing",
    lines: [{ productId: 0, sku: "", name: "", unknown: true, expected: 1 }],
  },
  "4": {
    id: "4", code: "RTN-0139", createdUnix: 1769126400, orderId: 4103, team: "Selling Alpha",
    shop: "Alpha Store", marketplace: Marketplace.SHOPEE, customer: "Sari Dewanti",
    address: "Jl. Anggrek 45, Jakarta Selatan", note: "Customer changed mind", valueRupiah: 375000n,
    status: "ongoing",
    lines: [
      { productId: 903, sku: "SHOE-RUN-42", name: "Sepatu Lari 42", expected: 1, unitRupiah: 225000n },
      { productId: 904, sku: "SOCK-3PK", name: "Kaos Kaki 3pcs", expected: 2, unitRupiah: 75000n },
    ],
  },
  "5": {
    id: "5", code: "RTN-0138", createdUnix: 1769040000, orderId: 4071, team: "Selling Beta",
    shop: "Beta Official", marketplace: Marketplace.TIKTOK, customer: "Andi Pratama",
    address: "Jl. Cendana 3, Semarang", note: "Courier could not deliver (RTS)", valueRupiah: 580000n,
    acceptedUnix: 1769126400, acceptedBy: "Rudi Hartono", status: "received",
    lines: [
      { productId: 705, sku: "JKT-DNM-L", name: "Jaket Denim L", expected: 2, sellable: 2, writtenOff: 0, rack: "A-02-1", unitRupiah: 200000n },
      { productId: 706, sku: "CAP-BLK", name: "Topi Hitam", expected: 2, sellable: 2, writtenOff: 0, rack: "B-01-3", unitRupiah: 90000n },
    ],
  },
  "6": {
    id: "6", code: "RTN-0137", createdUnix: 1768953600, orderId: 4055, team: "Selling Alpha",
    shop: "Alpha Mart", marketplace: Marketplace.TOKOPEDIA, customer: "Maya Lestari",
    address: "Jl. Mawar 21, Bekasi", note: "Defective — 1 back to shelf, 1 written off",
    valueRupiah: 300000n, acceptedUnix: 1769040000, acceptedBy: "Siti Aminah", status: "received",
    lines: [{ productId: 540, sku: "BAG-TOTE", name: "Tas Tote Kanvas", expected: 2, sellable: 1, writtenOff: 1, rack: "C-03-2", unitRupiah: 150000n }],
  },
  "7": {
    id: "7", code: "RTN-0135", createdUnix: 1768780800, orderId: 4032, team: "Selling Alpha",
    shop: "Alpha Store", marketplace: Marketplace.LAZADA, customer: "Dewi Kartika",
    address: "Jl. Flamboyan 7, Depok", note: "Wrong size", valueRupiah: 170000n,
    acceptedUnix: 1768867200, acceptedBy: "Rudi Hartono", status: "received",
    lines: [{ productId: 811, sku: "TS-WHT-S", name: "Kaos Putih S", expected: 2, sellable: 2, writtenOff: 0, rack: "A-01-4", unitRupiah: 85000n }],
  },
  "8": {
    id: "8", code: "RTN-0136", createdUnix: 1768867200, orderId: 4048, team: "Selling Beta",
    shop: "Beta Official", marketplace: Marketplace.TOKOPEDIA, customer: "Tono Hidayat",
    address: "Jl. Dahlia 19, Sidoarjo", note: "Said would return, never arrived", status: "cancelled",
    lines: [{ productId: 470, sku: "WLT-LTHR", name: "Dompet Kulit", expected: 1 }],
  },
};

function formatDateUnix(unix: number, lang: string): string {
  return new Date(unix * 1000).toLocaleDateString(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// A labelled read-only field, mirroring the restock detail page's Field so the two detail screens
// read the same. An empty value falls back to the muted "—" every detail page shows.
function DetailField({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text as="div" fontSize="sm" lineClamp={3} data-testid={testId}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// ReturnDetailPage is one return's dedicated route (#163) — a PAGE, not a dialog (CLAUDE.md), reached
// by clicking a row on the returns list. It is the receive & inspect record the mock names as "the
// next screen": for an ONGOING return the expected lines and the primary Receive & Inspect action; for
// a RECEIVED one the inspection outcome per line — what came back sellable, what was written off, and
// where the sellable was placed. Backed by preview data pending the return_service.
export function ReturnDetailPage() {
  const { returnId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t, i18n } = useTranslation();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const record = returnId ? SAMPLE[returnId] : undefined;

  function back() {
    navigate("/inventories/returns");
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("returns.title")}</Heading>
        <Text color="fg.muted">{t("returns.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("returns.title")}</Heading>
        <Text color="fg.muted" data-testid="return-detail-not-warehouse">
          {t("returns.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (!record) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="return-detail-back"
          onClick={back}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("returns.detail.back")}
        </Button>
        <Text color="red.fg" data-testid="return-detail-error">
          {t("returns.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const isReceived = record.status === "received";
  const isOngoing = record.status === "ongoing";

  const expectedTotal = record.lines.reduce((sum, l) => sum + l.expected, 0);
  const sellableTotal = record.lines.reduce((sum, l) => sum + (l.sellable ?? 0), 0);
  const writtenOffTotal = record.lines.reduce((sum, l) => sum + (l.writtenOff ?? 0), 0);
  const valueTotal = record.lines.reduce(
    (sum, l) => sum + (l.unitRupiah !== undefined ? l.unitRupiah * BigInt(l.expected) : 0n),
    0n,
  );

  return (
    <Stack gap="section" data-testid="return-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="return-detail-back"
        onClick={back}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("returns.detail.back")}
      </Button>

      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md" data-testid="return-detail-title">
          {record.code}
        </Heading>
        <Badge colorPalette={STATUS_PALETTE[record.status]} data-testid="return-detail-status">
          {t(`returns.status.${record.status}`)}
        </Badge>
        {/* Honest label: the goods here are invented until the return_service lands (#163). */}
        <Badge colorPalette="gray" variant="surface" data-testid="return-detail-preview">
          {t("returns.preview")}
        </Badge>
        <Spacer />

        {/* Receiving is COUNTING + INSPECTING (brainstorming §4.1, mirroring #157): count what came,
            place the sellable, write off the broken. That is a form with sections — a PAGE, not a
            dialog — which arrives with the return_service; until then the action is honest about it. */}
        {isOngoing && (
          <Button
            colorPalette="brand"
            data-testid="return-detail-receive"
            onClick={() =>
              toaster.create({ type: "info", title: t("returns.detail.receivePreview") })
            }
          >
            <Icon as={PackageCheck} boxSize="4" />
            {t("returns.detail.receive")}
          </Button>
        )}
      </Flex>

      {/* The return's header — where the goods came from, and (once received) when they were accepted. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("returns.detail.summary")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap="card">
              <DetailField
                label={t("returns.colOrder")}
                value={record.orderId ? `#${record.orderId}` : t("returns.noOrder")}
                testId="return-detail-order"
              />
              <DetailField
                label={t("returns.colTeam")}
                value={<TeamItem team={{ teamName: record.team, teamType: TeamType.SELLING }} />}
              />
              <DetailField
                label={t("returns.colShop")}
                value={
                  record.shop ? (
                    <Stack gap="1" alignItems="flex-start">
                      <Text as="span">{record.shop}</Text>
                      {record.marketplace !== undefined && (
                        <MarketplaceBadge marketplace={record.marketplace} size="sm" />
                      )}
                    </Stack>
                  ) : (
                    ""
                  )
                }
              />
              <DetailField
                label={t("returns.colCustomer")}
                value={
                  record.customer ? (
                    <Stack gap="0.5">
                      <Text as="span">{record.customer}</Text>
                      {record.address && (
                        <Text as="span" color="fg.subtle" fontSize="xs">
                          {record.address}
                        </Text>
                      )}
                    </Stack>
                  ) : (
                    ""
                  )
                }
              />
              <DetailField
                label={t("returns.colCreated")}
                value={formatDateUnix(record.createdUnix, i18n.language)}
              />
              <DetailField
                label={t("returns.colValue")}
                value={record.valueRupiah !== undefined ? formatRupiah(record.valueRupiah) : ""}
                testId="return-detail-value"
              />
              {isReceived && record.acceptedUnix !== undefined && (
                <DetailField
                  label={t("returns.detail.receivedOn")}
                  value={formatDateUnix(record.acceptedUnix, i18n.language)}
                  testId="return-detail-received-on"
                />
              )}
              {isReceived && record.acceptedBy && (
                <DetailField
                  label={t("returns.detail.receivedByLabel")}
                  value={record.acceptedBy}
                  testId="return-detail-received-by"
                />
              )}
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The return note — free text, so it gets its own full-width card like the restock note. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("returns.colNote")}
            </Text>
            <Text fontSize="sm" whiteSpace="pre-wrap" data-testid="return-detail-note">
              {record.note || "—"}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The lines. For an ongoing return only the expected pieces are known; once received, the count
          is inspected — Sellable / Written off / Placed appear, mirroring the restock detail's
          Arrived / Place columns. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("returns.detail.lines")}
            </Text>

            {isOngoing && (
              <Text fontSize="sm" color="fg.subtle" data-testid="return-detail-inspection-pending">
                {t("returns.detail.inspectionPending")}
              </Text>
            )}
            {record.status === "cancelled" && (
              <Text fontSize="sm" color="fg.subtle" data-testid="return-detail-cancelled-note">
                {t("returns.detail.cancelledNote")}
              </Text>
            )}

            <Table.Root size="sm" data-testid="return-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("returns.detail.sku")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("returns.detail.product")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("returns.detail.qty")}</Table.ColumnHeader>
                  {isReceived && (
                    <>
                      <Table.ColumnHeader textAlign="end">
                        {t("returns.detail.sellable")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("returns.detail.writtenOff")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader>{t("returns.detail.placed")}</Table.ColumnHeader>
                    </>
                  )}
                  <Table.ColumnHeader textAlign="end">
                    {t("returns.detail.lineValue")}
                  </Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {record.lines.map((line, idx) => (
                  <Table.Row key={line.productId || idx} data-testid={`return-detail-item-${idx}`}>
                    <Table.Cell>
                      {line.unknown ? <Text as="span" color="fg.subtle">—</Text> : line.sku}
                    </Table.Cell>
                    <Table.Cell>
                      {line.unknown ? (
                        <Text as="span" color="fg.subtle">
                          {t("returns.detail.unknownProduct")}
                        </Text>
                      ) : (
                        line.name
                      )}
                    </Table.Cell>
                    <Table.Cell textAlign="end">{line.expected}</Table.Cell>
                    {isReceived && (
                      <>
                        <Table.Cell textAlign="end">
                          {line.sellable !== undefined && line.sellable > 0 ? (
                            <Text as="span" color="green.fg" fontWeight="medium">
                              {line.sellable}
                            </Text>
                          ) : (
                            <Text as="span" color="fg.subtle">—</Text>
                          )}
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          {line.writtenOff !== undefined && line.writtenOff > 0 ? (
                            <Text as="span" color="red.fg" fontWeight="medium">
                              {line.writtenOff}
                            </Text>
                          ) : (
                            <Text as="span" color="fg.subtle">—</Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          {line.sellable && line.sellable > 0
                            ? (line.rack ?? t("returns.detail.unplaced"))
                            : <Text as="span" color="fg.subtle">—</Text>}
                        </Table.Cell>
                      </>
                    )}
                    <Table.Cell textAlign="end">
                      {line.unitRupiah !== undefined ? (
                        formatRupiah(line.unitRupiah * BigInt(line.expected))
                      ) : (
                        <Text as="span" color="fg.subtle">—</Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            <Separator />

            <Stack gap="1" align="end">
              <Text fontSize="sm" color="fg.muted">
                {t("returns.detail.expectedTotal")}:{" "}
                <Text as="span" fontWeight="medium" data-testid="return-detail-items-total">
                  {expectedTotal}
                </Text>
              </Text>
              {isReceived && (
                <Flex gap="card" wrap="wrap" justify="end">
                  <Text fontSize="sm" color="green.fg">
                    {t("returns.detail.sellableTotal")}:{" "}
                    <Text as="span" fontWeight="medium" data-testid="return-detail-sellable-total">
                      {sellableTotal}
                    </Text>
                  </Text>
                  <Text fontSize="sm" color="red.fg">
                    {t("returns.detail.writtenOffTotal")}:{" "}
                    <Text as="span" fontWeight="medium" data-testid="return-detail-writtenoff-total">
                      {writtenOffTotal}
                    </Text>
                  </Text>
                </Flex>
              )}
              {valueTotal > 0n && (
                <Text fontSize="md" fontWeight="semibold" data-testid="return-detail-value-total">
                  {t("returns.detail.valueTotal")}: {formatRupiah(valueTotal)}
                </Text>
              )}
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

export default ReturnDetailPage;
