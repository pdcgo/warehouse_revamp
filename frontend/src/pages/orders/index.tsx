import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { rpcError } from "../../api/clients";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
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
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("orders.title")}</h1>
        <p className="text-fg-muted" data-testid="orders-no-team">
          {t("orders.selectTeamView")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("orders.title")}</h1>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <div className="flex-1" />
        <Button
          size="xs"
          colorPalette="brand"
          data-testid="open-create-order"
          onClick={() => navigate("/orders/new")}
        >
          {t("orders.newOrder")}
        </Button>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="orders-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="orders-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("orders.orderColumn")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orders.customer")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orders.status")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("orders.total")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {orders.map((o) => (
              <Table.Row key={o.id.toString()} data-testid={`order-row-${o.id}`}>
                <Table.Cell>
                  <div
                    className="cursor-pointer font-medium text-accent-fg hover:underline"
                    data-testid={`open-order-${o.id}`}
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    #{o.id.toString()}
                  </div>
                </Table.Cell>
                <Table.Cell>{o.customerName}</Table.Cell>
                <Table.Cell>
                  <OrderStatusBadge status={o.status} />
                </Table.Cell>
                <Table.Cell className="text-right">{formatRupiah(o.total)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && orders.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="orders-empty">
          {t("orders.noOrders")}
        </p>
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
    </div>
  );
}
