import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
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
import { rpcError, shopClient } from "../api/clients";
import type { Shop } from "../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { marketplaceLabel } from "../components/MarketplaceSelect";
import { toaster } from "../components/Toaster";
import { ShopFormDialog } from "./ShopFormDialog";

const PAGE_SIZE = 20;

// ShopsPage lists the CURRENT selling TEAM's marketplace shops (#66). Every RPC carries
// `current.teamId` in its body — the team is the scope, and a team only ever sees its own shops.
export function ShopsPage() {
  const { current } = useTeam();

  const [shops, setShops] = useState<Shop[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Shop | null>(null);

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await shopClient.shopList({ teamId, q, page: { page, limit: PAGE_SIZE } });

      setShops(res.shops);
      setTotalPage(res.pageInfo?.totalPage ?? 1);
    } catch (err) {
      setError(rpcError(err));
      setShops([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(shop: Shop) {
    if (teamId === undefined) {
      return;
    }

    try {
      await shopClient.shopDelete({ teamId, shopId: shop.id });
      toaster.create({ type: "success", title: `Shop "${shop.name}" deleted` });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: "Delete failed", description: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">Shops</Heading>
        <Text color="fg.muted" data-testid="shops-no-team">
          Select a team to manage its shops.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">Shops</Heading>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <Spacer />
        <ShopFormDialog onDone={() => void load()} />
      </Flex>

      <HStack>
        <Input
          maxW="sm"
          placeholder="Search name or code"
          value={q}
          data-testid="shop-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="shops-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="shops-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Code</Table.ColumnHeader>
              <Table.ColumnHeader>Marketplace</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {shops.map((shop) => (
              <Table.Row key={shop.id.toString()} data-testid={`shop-row-${shop.shopCode}`}>
                <Table.Cell>{shop.name}</Table.Cell>
                <Table.Cell>{shop.shopCode}</Table.Cell>
                <Table.Cell>{marketplaceLabel(shop.marketplace)}</Table.Cell>

                <Table.Cell textAlign="end">
                  <HStack justify="end" gap="1">
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label="Edit"
                      data-testid={`edit-${shop.shopCode}`}
                      onClick={() => setEditing(shop)}
                    >
                      <Icon as={Pencil} boxSize="4" />
                    </IconButton>

                    <ConfirmDialog
                      title="Delete Shop"
                      message={`Delete "${shop.name}"? This cannot be undone.`}
                      confirmLabel="Delete"
                      onConfirm={() => remove(shop)}
                      trigger={
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          aria-label="Delete"
                          data-testid={`delete-${shop.shopCode}`}
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

      {!loading && shops.length === 0 && !error && (
        <Text color="fg.muted" data-testid="shops-empty">
          No shops found.
        </Text>
      )}

      <HStack>
        <Button
          size="xs"
          variant="outline"
          disabled={page <= 1}
          data-testid="shops-prev"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>

        <Text fontSize="xs" color="fg.muted" data-testid="shops-page">
          Page {page} of {totalPage}
        </Text>

        <Button
          size="xs"
          variant="outline"
          disabled={page >= totalPage}
          data-testid="shops-next"
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </HStack>

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per shop. */}
      {editing && (
        <ShopFormDialog
          key={editing.id.toString()}
          shop={editing}
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
