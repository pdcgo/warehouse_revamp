import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  HStack,
  Icon,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { rpcError } from "../api/clients";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Pagination } from "../components/Pagination";
import { toaster } from "../components/Toaster";
import { useTeam } from "../team/TeamContext";
import { draftGaps } from "./draftReadiness";
import { useDeleteOrderDrafts, useOrderDrafts } from "./queries";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// OrderDraftsPage lists the CALLER'S OWN drafts (#195) — incomplete orders pushed in by a
// third-party app, waiting for somebody here to finish them.
//
// ⚠ ITS OWN ROUTE, not a tab on the orders list. Drafts are not orders, and the UI says so the same
// way the schema does: a tab would put not-orders inside the orders screen, which is the concern the
// separate table was built around.
//
// The screen has two jobs, and the second is easy to under-build: opening a draft to finish it, and
// PRUNING. Nothing expires, and an app pushing continuously fills this list far faster than a person
// finishes one — so bulk delete is load-bearing, not a convenience.
export function OrderDraftsPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const teamId = current?.teamId;

  const query = useOrderDrafts({ teamId, page, pageSize });
  const remove = useDeleteOrderDrafts();

  const drafts = query.data?.drafts ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // The selection is held as ids rather than as a per-row flag so it survives a refetch — a delete
  // that reorders the page must not silently transfer a tick from one draft to another.
  const allOnPageSelected = drafts.length > 0 && drafts.every((d) => selected.has(d.id.toString()));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);

      for (const draft of drafts) {
        const id = draft.id.toString();

        if (allOnPageSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });
  }

  async function deleteSelected() {
    if (!teamId) {
      return;
    }

    try {
      const res = await remove.mutateAsync({
        teamId,
        draftIds: [...selected].map((id) => BigInt(id)),
      });

      setSelected(new Set());
      toaster.create({
        type: "success",
        title: t("orderDrafts.deleted", { count: res.deleted }),
      });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orderDrafts.title")}</Heading>
        <Text color="fg.muted" data-testid="order-drafts-no-team">
          {t("orderDrafts.selectTeamView")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("orderDrafts.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />

        {selected.size > 0 && (
          <Button
            size="xs"
            colorPalette="red"
            data-testid="delete-selected-drafts"
            onClick={() => setConfirmOpen(true)}
          >
            <Icon as={Trash2} boxSize="4" />
            {t("orderDrafts.deleteSelected", { count: selected.size })}
          </Button>
        )}
      </Flex>

      <Text color="fg.muted" fontSize="sm">
        {t("orderDrafts.intro")}
      </Text>

      {error && (
        <Text color="red.fg" data-testid="order-drafts-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="order-drafts-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader width="1">
                <Checkbox.Root
                  size="sm"
                  checked={allOnPageSelected}
                  onCheckedChange={toggleAllOnPage}
                  aria-label={t("orderDrafts.selectAll")}
                  data-testid="select-all-drafts"
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                </Checkbox.Root>
              </Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.reference")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orders.customer")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.lines")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.remaining")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {drafts.map((d) => {
              const gaps = draftGaps(d);

              return (
                <Table.Row key={d.id.toString()} data-testid={`draft-row-${d.id}`}>
                  <Table.Cell>
                    <Checkbox.Root
                      size="sm"
                      checked={selected.has(d.id.toString())}
                      onCheckedChange={() => toggle(d.id.toString())}
                      aria-label={t("orderDrafts.selectOne", { id: d.id.toString() })}
                      data-testid={`select-draft-${d.id}`}
                    >
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                    </Checkbox.Root>
                  </Table.Cell>

                  <Table.Cell>
                    <Box
                      cursor="pointer"
                      fontWeight="medium"
                      data-testid={`open-draft-${d.id}`}
                      onClick={() => navigate(`/order-drafts/${d.id}`)}
                    >
                      {d.externalId}
                    </Box>
                    {/* WHICH APP pushed it, kept beside the reference: two apps can scrape the same
                        marketplace, and an external id alone does not say whose it is. */}
                    <Text fontSize="xs" color="fg.muted">
                      {d.source}
                    </Text>
                  </Table.Cell>

                  <Table.Cell>{d.customerName || "—"}</Table.Cell>

                  <Table.Cell>
                    {d.unmappedItemCount > 0 ? (
                      <Badge colorPalette="orange" data-testid={`draft-unmapped-${d.id}`}>
                        {t("orderDrafts.unmappedOf", {
                          unmapped: d.unmappedItemCount,
                          total: d.itemCount,
                        })}
                      </Badge>
                    ) : (
                      <Text>{d.itemCount}</Text>
                    )}
                  </Table.Cell>

                  {/* WHAT IS LEFT TO DO, spelled out rather than reduced to ready/not-ready. Somebody
                      scanning forty drafts is deciding which to open next, and "needs a warehouse" is
                      a different amount of work from "three lines unmapped". */}
                  <Table.Cell>
                    {gaps.length === 0 ? (
                      <Badge colorPalette="green" data-testid={`draft-ready-${d.id}`}>
                        {t("orderDrafts.ready")}
                      </Badge>
                    ) : (
                      <HStack gap="1" wrap="wrap">
                        {gaps.map((gap) => (
                          <Badge key={gap.key} colorPalette="gray">
                            {t(gap.key)}
                          </Badge>
                        ))}
                      </HStack>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && drafts.length === 0 && !error && (
        <Text color="fg.muted" data-testid="order-drafts-empty">
          {t("orderDrafts.noDrafts")}
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

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("orderDrafts.deleteTitle")}
        message={t("orderDrafts.deleteMessage", { count: selected.size })}
        confirmLabel={t("orderDrafts.deleteConfirm")}
        onConfirm={deleteSelected}
      />
    </Stack>
  );
}
