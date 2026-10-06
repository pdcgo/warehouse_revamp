import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
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
import { rpcError } from "../../api/clients";
import type { SupplierRecord } from "../../features/suppliers/adapt";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useDeleteSupplier, useSuppliers } from "../../features/suppliers/queries";
import { useIsMobile } from "../../layouts/shell";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { SupplierFormDialog } from "./components/SupplierFormDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// SuppliersPage manages the CURRENT team's suppliers — the vendors it buys stock from
// (docs/business/supplier, manage-and-discover-are-two-pages: this is the MANAGE page; discovering other
// teams' suppliers is a page of its own, after the CRUD pass).
//
// Only a selling team has suppliers (only-a-selling-team-has-suppliers), so only a selling team gets New,
// Edit and Delete. Every RPC carries `current.teamId` in its body — the team is the scope.
export function SuppliersPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const canManage = current?.teamType === TeamType.SELLING;

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<SupplierRecord | null>(null);

  const teamId = current?.teamId;

  const query = useSuppliers({ teamId, q, page, pageSize });
  const deleteSupplier = useDeleteSupplier();

  const suppliers = query.data?.suppliers ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function remove(supplier: SupplierRecord) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteSupplier.mutateAsync({ teamId, supplierId: supplier.id });
      toaster.create({ type: "success", title: t("suppliers.deleted", { name: supplier.name }) });
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

  // Edit and Delete, the same pair on a table row and on a phone block. Two actions stay inline.
  function actions(supplier: SupplierRecord) {
    return (
      <HStack justify="end" gap="1">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("suppliers.edit")}
          data-testid={`edit-supplier-${supplier.id}`}
          onClick={() => setEditing(supplier)}
        >
          <Icon as={Pencil} boxSize="4" />
        </IconButton>

        <ConfirmDialog
          title={t("suppliers.deleteSupplier")}
          // A hard delete (no-province-city-or-soft-delete): the supplier and its channels are gone.
          message={t("suppliers.deleteConfirm", { name: supplier.name })}
          confirmLabel={t("suppliers.delete")}
          onConfirm={() => remove(supplier)}
          trigger={
            <IconButton
              size="xs"
              variant="ghost"
              colorPalette="error"
              aria-label={t("suppliers.delete")}
              data-testid={`delete-supplier-${supplier.id}`}
            >
              <Icon as={Trash2} boxSize="4" />
            </IconButton>
          }
        />
      </HStack>
    );
  }

  const open = (supplier: SupplierRecord) => navigate(`/inventories/suppliers/${supplier.id}`);

  return (
    <Stack gap="section">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("suppliers.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <Spacer />
        {canManage && <SupplierFormDialog />}
      </Flex>

      {!canManage && (
        <Text color="fg.muted" data-testid="suppliers-selling-only">
          {t("suppliers.sellingOnly")}
        </Text>
      )}

      <HStack>
        <Input
          maxW={{ base: "full", md: "sm" }}
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
        <Text color="error.fg" data-testid="suppliers-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>
          {isMobile ? (
            // A phone reads each supplier as a block (a-phone-reads-each-line-as-a-block): the name at
            // full width, the contact and address under it, never three clamped columns.
            <Stack gap="2" data-testid="suppliers-table">
              {suppliers.map((supplier) => (
                <Flex
                  key={supplier.id.toString()}
                  data-testid={`supplier-row-${supplier.id}`}
                  borderWidth="1px"
                  borderRadius="md"
                  p="3"
                  gap="2"
                  align="start"
                  cursor="pointer"
                  onClick={() => open(supplier)}
                >
                  <Stack gap="0.5" minW="0" flex="1">
                    <Text fontWeight="bold">{supplier.name}</Text>
                    <Text fontSize="sm" color="fg.muted" lineClamp={2}>
                      {[supplier.contact, supplier.address].filter(Boolean).join(" · ") || "—"}
                    </Text>
                  </Stack>
                  {canManage && <Box onClick={(e) => e.stopPropagation()}>{actions(supplier)}</Box>}
                </Flex>
              ))}
            </Stack>
          ) : (
            <Table.Root size="sm" data-testid="suppliers-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("suppliers.table.name")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("suppliers.table.contact")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("suppliers.table.address")}</Table.ColumnHeader>
                  {canManage && (
                    <Table.ColumnHeader textAlign="end">{t("suppliers.table.actions")}</Table.ColumnHeader>
                  )}
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {suppliers.map((supplier) => (
                  <Table.Row
                    key={supplier.id.toString()}
                    data-testid={`supplier-row-${supplier.id}`}
                    cursor="pointer"
                    _hover={{ bg: "bg.subtle" }}
                    onClick={() => open(supplier)}
                  >
                    <Table.Cell fontWeight="bold">{supplier.name}</Table.Cell>
                    <Table.Cell>{supplier.contact || "—"}</Table.Cell>
                    <Table.Cell maxW="sm">
                      <Text lineClamp={2}>{supplier.address || "—"}</Text>
                    </Table.Cell>

                    {canManage && (
                      // Stop the row's navigate from firing when a row action is used.
                      <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                        {actions(supplier)}
                      </Table.Cell>
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </RefreshOverlay>
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
        />
      )}
    </Stack>
  );
}
