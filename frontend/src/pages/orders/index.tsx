import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Button, Flex, Heading, Spacer, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useOrders } from "../../features/orders/queries";
import { OrderStatusBadge } from "../../components/OrderStatusBadge";
import { Pagination } from "../../components/Pagination";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// OrdersPage lists the CURRENT selling TEAM's orders (#68), newest first, paginated. The team is the
// scope — a team only ever sees its own orders. Rows open the read-only detail page.
export function OrdersPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const teamId = current?.teamId;

  const query = useOrders({ teamId, page, pageSize });

  const orders = query.data?.orders ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";


  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orders.title")}</Heading>
        <Text color="fg.muted" data-testid="orders-no-team">
          {t("orders.selectTeamView")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("orders.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />
        <Button
          size="xs"
          colorPalette="brand"
          data-testid="open-create-order"
          onClick={() => navigate("/orders/new")}
        >
          {t("orders.newOrder")}
        </Button>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="orders-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="orders-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("orders.orderColumn")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orders.customer")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orders.status")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("orders.total")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {orders.map((o) => (
              <Table.Row key={o.id.toString()} data-testid={`order-row-${o.id}`}>
                <Table.Cell>
                  <Box
                    cursor="pointer"
                    fontWeight="medium"
                    data-testid={`open-order-${o.id}`}
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    #{o.id.toString()}
                  </Box>
                </Table.Cell>
                <Table.Cell>{o.customerName}</Table.Cell>
                <Table.Cell>
                  <OrderStatusBadge status={o.status} />
                </Table.Cell>
                <Table.Cell textAlign="end">{formatRupiah(o.total)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && orders.length === 0 && !error && (
        <Text color="fg.muted" data-testid="orders-empty">
          {t("orders.noOrders")}
        </Text>
      )}

      {!loading && (
        <Pagination
          count={totalItems}
          pageSize={pageSize}
          page={page}
          onPageChange={setPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </Stack>
  );
}
