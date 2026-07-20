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
import { rackClient, rpcError } from "../api/clients";
import type { Rack } from "../gen/warehouse/inventory/v1/rack_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Pagination } from "../components/Pagination";
import { toaster } from "../components/Toaster";
import { RackFormDialog } from "./RackFormDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// RacksPage lists the CURRENT team's racks (#129) — the physical places inside ONE warehouse, since
// a warehouse IS a team. Every RPC carries `current.teamId` in its body: the team is the scope, and
// a warehouse only ever sees its own racks.
//
// This is the registry — write down the shelves you have. A row opens the rack's detail page (#138),
// which is where the interesting question is answered: what is actually ON that shelf, and how much.
//
// The Racks menu shows for warehouse teams only, but the page is not gated here — root/admin reach
// the route directly and the server's policy is the real gate.
export function RacksPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [racks, setRacks] = useState<Rack[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Rack | null>(null);

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      // The server already orders by code — the code is how a person reads the warehouse.
      const res = await rackClient.rackList({ teamId, q, page: { page, limit: pageSize } });

      setRacks(res.racks);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setRacks([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, q, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(rack: Rack) {
    if (teamId === undefined) {
      return;
    }

    try {
      await rackClient.rackDelete({ teamId, rackId: rack.id });
      toaster.create({ type: "success", title: t("racks.deleted", { code: rack.code }) });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: t("racks.deleteFailed"), description: rpcError(err) });
    }
  }

  // No current team means there is no warehouse to list against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("racks.title")}</Heading>
        <Text color="fg.muted" data-testid="racks-no-team">
          {t("racks.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("racks.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <Spacer />
        <RackFormDialog onDone={() => void load()} />
      </Flex>

      <HStack>
        <Input
          maxW="sm"
          placeholder={t("racks.searchPlaceholder")}
          value={q}
          data-testid="rack-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="racks-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="racks-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("racks.table.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("racks.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("racks.table.description")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("racks.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {racks.map((rack) => (
              <Table.Row
                key={rack.id.toString()}
                data-testid={`rack-row-${rack.code}`}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => navigate(`/inventories/racks/${rack.id}`)}
              >
                {/* The code is what is painted on the shelf — it IS the rack's identity, so it
                    carries the row. */}
                <Table.Cell fontWeight="medium">{rack.code}</Table.Cell>
                <Table.Cell>{rack.name}</Table.Cell>
                <Table.Cell color="fg.muted">{rack.description}</Table.Cell>

                {/* Stop the row's navigate from firing when a row action is used. */}
                <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                  <HStack justify="end" gap="1">
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label="Edit"
                      data-testid={`edit-rack-${rack.code}`}
                      onClick={() => setEditing(rack)}
                    >
                      <Icon as={Pencil} boxSize="4" />
                    </IconButton>

                    <ConfirmDialog
                      title={t("racks.deleteRack")}
                      message={t("racks.deleteConfirm", { code: rack.code })}
                      confirmLabel={t("racks.delete")}
                      onConfirm={() => remove(rack)}
                      trigger={
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          aria-label="Delete"
                          data-testid={`delete-rack-${rack.code}`}
                        >
                          <Icon as={Trash2} boxSize="4" />
                        </IconButton>
                      }
                    />
                  </HStack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && racks.length === 0 && !error && (
        <Text color="fg.muted" data-testid="racks-empty">
          {t("racks.empty")}
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

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per rack. */}
      {editing && (
        <RackFormDialog
          key={editing.id.toString()}
          rack={editing}
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
