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
import { rpcError, shopClient } from "../api/clients";
import type { Shop } from "../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarketplaceBadge } from "../components/MarketplaceBadge";
import { Pagination } from "../components/Pagination";
import { toaster } from "../components/Toaster";
import { useShops, useInvalidateShops } from "./queries";
import { ShopFormDialog } from "./ShopFormDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// ShopsPage lists the CURRENT selling TEAM's marketplace shops (#66). Every RPC carries
// `current.teamId` in its body — the team is the scope, and a team only ever sees its own shops.
export function ShopsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<Shop | null>(null);

  const teamId = current?.teamId;

  const query = useShops({ teamId, q, page, pageSize });
  const invalidateShops = useInvalidateShops();

  const shops = query.data?.shops ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  async function remove(shop: Shop) {
    if (teamId === undefined) {
      return;
    }

    try {
      await shopClient.shopDelete({ teamId, shopId: shop.id });
      toaster.create({ type: "success", title: t("shops.deleted", { name: shop.name }) });
      await invalidateShops();
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.deleteFailed"), description: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("shops.title")}</Heading>
        <Text color="fg.muted" data-testid="shops-no-team">
          {t("shops.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("shops.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <Spacer />
        <ShopFormDialog onDone={() => void invalidateShops()} />
      </Flex>

      <HStack>
        <Input
          maxW="sm"
          placeholder={t("shops.searchPlaceholder")}
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
              <Table.ColumnHeader>{t("shops.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("shops.table.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("shops.table.marketplace")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("shops.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {shops.map((shop) => (
              <Table.Row key={shop.id.toString()} data-testid={`shop-row-${shop.shopCode}`}>
                <Table.Cell>
                  <Box
                    cursor="pointer"
                    data-testid={`open-shop-${shop.shopCode}`}
                    onClick={() => navigate(`/shops/${shop.id}`)}
                  >
                    {shop.name}
                  </Box>
                </Table.Cell>
                <Table.Cell>{shop.shopCode}</Table.Cell>
                <Table.Cell>
                  <MarketplaceBadge marketplace={shop.marketplace} />
                </Table.Cell>

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
                      title={t("shops.deleteShop")}
                      message={t("shops.deleteConfirm", { name: shop.name })}
                      confirmLabel={t("shops.delete")}
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
          {t("shops.empty")}
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

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per shop. */}
      {editing && (
        <ShopFormDialog
          key={editing.id.toString()}
          shop={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onDone={() => void invalidateShops()}
        />
      )}
    </Stack>
  );
}
