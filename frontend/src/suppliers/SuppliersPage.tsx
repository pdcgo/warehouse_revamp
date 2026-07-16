import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { rpcError, supplierClient } from "../api/clients";
import type { Supplier } from "../gen/warehouse/inventory/v1/supplier_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Pagination } from "../components/Pagination";
import { toaster } from "../components/Toaster";
import { SupplierFormDialog } from "./SupplierFormDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// SuppliersPage lists the CURRENT team's suppliers (#103) — the vendors the team buys stock from,
// managed under the Inventory area. Every RPC carries `current.teamId` in its body — the team is the
// scope, and a team only ever sees its own suppliers.
export function SuppliersPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Only a selling team (and root/admin) manages suppliers; a warehouse team is read-only (#107).
  const canManage = current?.teamType !== TeamType.WAREHOUSE;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Supplier | null>(null);

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await supplierClient.supplierList({ teamId, q, page: { page, limit: pageSize } });

      setSuppliers(res.suppliers);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, q, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(supplier: Supplier) {
    if (teamId === undefined) {
      return;
    }

    try {
      await supplierClient.supplierDelete({ teamId, supplierId: supplier.id });
      toaster.create({ type: "success", title: t("suppliers.deleted", { name: supplier.name }) });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: t("suppliers.deleteFailed"), description: rpcError(err) });
    }
  }

  // No current team means there is no scope to list against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("suppliers.title")}</Heading>
        <Text color="fg.muted" data-testid="suppliers-no-team">
          {t("suppliers.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("suppliers.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <Spacer />
        {canManage && <SupplierFormDialog onDone={() => void load()} />}
      </Flex>

      <HStack>
        <Input
          maxW="sm"
          placeholder={t("suppliers.searchPlaceholder")}
          value={q}
          data-testid="supplier-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="suppliers-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="suppliers-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("suppliers.table.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("suppliers.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("suppliers.table.contact")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("suppliers.table.city")}</Table.ColumnHeader>
              {canManage && (
                <Table.ColumnHeader textAlign="end">{t("suppliers.table.actions")}</Table.ColumnHeader>
              )}
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {suppliers.map((supplier) => (
              <Table.Row
                key={supplier.id.toString()}
                data-testid={`supplier-row-${supplier.code}`}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => navigate(`/inventories/suppliers/${supplier.id}`)}
              >
                <Table.Cell data-testid={`supplier-open-${supplier.id}`}>{supplier.code}</Table.Cell>
                <Table.Cell>{supplier.name}</Table.Cell>
                <Table.Cell>{supplier.contact}</Table.Cell>
                <Table.Cell>{supplier.city}</Table.Cell>

                {canManage && (
                  // Stop the row's navigate from firing when a row action is used.
                  <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                    <HStack justify="end" gap="1">
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label="Edit"
                        data-testid={`edit-${supplier.code}`}
                        onClick={() => setEditing(supplier)}
                      >
                        <Icon as={Pencil} boxSize="4" />
                      </IconButton>

                      <ConfirmDialog
                        title={t("suppliers.deleteSupplier")}
                        message={t("suppliers.deleteConfirm", { name: supplier.name })}
                        confirmLabel={t("suppliers.delete")}
                        onConfirm={() => remove(supplier)}
                        trigger={
                          <IconButton
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            aria-label="Delete"
                            data-testid={`delete-${supplier.code}`}
                          >
                            <Icon as={Trash2} boxSize="4" />
                          </IconButton>
                        }
                      />
                    </HStack>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && suppliers.length === 0 && !error && (
        <Text color="fg.muted" data-testid="suppliers-empty">
          {t("suppliers.empty")}
        </Text>
      )}

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

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per supplier. */}
      {editing && (
        <SupplierFormDialog
          key={editing.id.toString()}
          supplier={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onDone={() => void load()}
        />
      )}
    </Stack>
  );
}
