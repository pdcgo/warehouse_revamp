import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Flex, HStack, Heading, Icon, IconButton, Menu, Portal, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useAuth } from "../../features/auth/AuthContext";
import { lineState, unavailable } from "../../features/bundles/adapt";
import { useBundle, useBundleProducts, useBundleStock, useDeleteBundle } from "../../features/bundles/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams, useTeamsByIds } from "../../features/teams/queries";
import { useActors } from "../../features/users/queries";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixRelative } from "../../lib/datetime";
import { canChangeBundle } from "../../lib/roles";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { BundleStockCard } from "./components/BundleStockCard";
import { bundleMakes } from "./makes";

function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// BundleDetailPage — one bundle, read (a-bundle-has-a-detail-page-that-counts-what-stock-can-make).
//
//   ← Paket Hemat                                         [✎ Edit] [🗑 Delete]
//     Created by Ani Rahayu · changed yesterday
//     Beras dan gula untuk listing paket hemat di Shopee
//   ┌ What Stock Can Make                     [Gudang Pusat ⌄] ┐
//   │ [Can make: 6 bundles — at Gudang Pusat]                   │
//   │ Product              Per bundle   Ready   Enough for      │
//   │ Gula Pasir 1kg            2         12        6   runs out first
//   └───────────────────────────────────────────────────────────┘
//
// Everyone in the team reads it; Edit and Delete are for whoever may change the bundle
// (the-creator-or-an-admin-edits-a-bundle), and the rest are told who that is.
export function BundleDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { current } = useTeam();
  const { identity } = useAuth();
  const { bundleId: rawId } = useParams<{ bundleId: string }>();

  const id = parseId(rawId);
  const isSelling = current?.teamType === TeamType.SELLING;
  const teamId = isSelling ? current?.teamId : undefined;

  const detail = useBundle({ teamId, bundleId: id });
  const bundle = detail.data ?? null;
  const productIds = bundle?.lines.map((l) => l.productId) ?? [];

  const products = useBundleProducts({ teamId, productIds });
  const ownerIds = [...(products.data?.values() ?? [])].filter((p) => p.teamId !== teamId).map((p) => p.teamId);
  const owners = useTeamsByIds({ ids: ownerIds });
  const actors = useActors(bundle ? [bundle.createdByUserId] : []);

  // Every warehouse — the stock on screen is one of them, the reserve is tested against all of them.
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, enabled: isSelling, reference: true });
  const warehouseList = warehouses.data?.teams ?? [];
  const stock = useBundleStock({ teamId, productIds, warehouseIds: warehouseList.map((w) => w.id) });

  // 0n = not picked: the first warehouse stands in until another is.
  const [picked, setPicked] = useState<bigint>(0n);
  const warehouseId = picked > 0n ? picked : (warehouseList[0]?.id ?? 0n);
  const warehouseName = warehouseList.find((w) => w.id === warehouseId)?.name;

  const deleteBundle = useDeleteBundle();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const backTo = "/products/bundles";
  const back = (
    <IconButton size="xs" variant="ghost" aria-label={t("bundles.form.back")} data-testid="bundle-detail-back" onClick={() => navigate(backTo)}>
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  if (!current || !isSelling) {
    return (
      <Stack gap="section">
        <Flex align="center" gap="card">
          {back}
          <Heading size="md">{t("bundles.form.editTitle")}</Heading>
        </Flex>
        <Text color="fg.muted" data-testid="bundle-detail-selling-only">
          {current ? t("bundles.sellingOnly") : t("bundles.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (!bundle) {
    const loadError =
      id === 0n ? t("bundles.form.notFound") : detail.isError ? rpcError(detail.error) : detail.isSuccess ? t("bundles.form.notFound") : "";

    if (!loadError) return <Spinner colorPalette="brand" />;

    return (
      <Stack gap="section">
        <Flex align="center" gap="card">
          {back}
          <Heading size="md">{t("bundles.form.editTitle")}</Heading>
        </Flex>
        <Text color="error.fg" data-testid="bundle-detail-load-error">
          {loadError}
        </Text>
      </Stack>
    );
  }

  const mayChange = canChangeBundle({ role: current.role, createdByUserId: bundle.createdByUserId, me: identity?.identityId });
  const creator = actors.data?.get(bundle.createdByUserId.toString())?.name ?? `#${bundle.createdByUserId}`;
  const blocked = bundle.lines.filter((l) => unavailable(lineState(products.data?.get(l.productId.toString()), bundle.teamId))).length;
  const makes = bundleMakes({ bundle, products: products.data, stock: stock.data, warehouseId });

  async function remove() {
    if (teamId === undefined || !bundle) return;

    try {
      await deleteBundle.mutateAsync({ teamId, bundleId: bundle.id });
      toaster.create({ type: "success", title: t("bundles.deleted", { name: bundle.name }) });
      void navigate(backTo);
    } catch (err) {
      toaster.create({ type: "error", title: t("bundles.deleteFailed"), description: rpcError(err) });
    }
  }

  const edit = () => navigate(`/products/bundles/${bundle.id}/edit`);

  // EDIT AND DELETE — labelled buttons beside the name on a desktop; on a phone the header is one row, so both fold into
  // `⋯` (`the-phone-header-is-one-row`).
  const actions = !mayChange ? null : isMobile ? (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton size="xs" variant="ghost" aria-label={t("bundles.form.more")} data-testid="bundle-detail-more">
          <Icon as={MoreHorizontal} boxSize="4" />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            <Menu.Item value="edit" data-testid="bundle-detail-edit" onClick={edit}>
              <Icon as={Pencil} boxSize="4" />
              {t("bundles.edit")}
            </Menu.Item>
            <Menu.Item value="delete" color="error.fg" data-testid="bundle-detail-delete" onClick={() => setDeleteOpen(true)}>
              <Icon as={Trash2} boxSize="4" />
              {t("bundles.delete")}
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  ) : (
    <HStack gap="1.5">
      <Button size="xs" variant="outline" data-testid="bundle-detail-edit" onClick={edit}>
        <Icon as={Pencil} boxSize="4" />
        {t("bundles.edit")}
      </Button>
      <Button size="xs" variant="outline" colorPalette="error" data-testid="bundle-detail-delete" onClick={() => setDeleteOpen(true)}>
        <Icon as={Trash2} boxSize="4" />
        {t("bundles.delete")}
      </Button>
    </HStack>
  );

  return (
    <Stack gap="section" maxW="5xl" data-testid="bundle-detail-page">
      <Stack gap="1">
        <Flex align="center" gap="card">
          {back}
          <Heading size="md" lineClamp={1} data-testid="bundle-detail-title">
            {bundle.name}
          </Heading>
          <Spacer />
          {actions}
        </Flex>
        <Text fontSize="sm" color="fg.muted" data-testid="bundle-detail-creator">
          {t("bundles.form.createdBy", { name: creator, when: formatUnixRelative(bundle.updatedAtUnix) })}
        </Text>
        {bundle.description && (
          <Text fontSize="sm" data-testid="bundle-detail-description">
            {bundle.description}
          </Text>
        )}
        {!mayChange && (
          <HStack gap="1.5" color="fg.muted" data-testid="bundle-detail-read-only">
            <Icon as={Lock} boxSize="3.5" />
            <Text fontSize="sm">{t("bundles.form.readOnly", { name: creator })}</Text>
          </HStack>
        )}
      </Stack>

      {blocked > 0 && (
        <Alert.Root status="warning" data-testid="bundle-detail-unavailable">
          <Alert.Indicator />
          <Alert.Description>{t("bundles.form.unavailableBanner", { count: blocked })}</Alert.Description>
        </Alert.Root>
      )}

      <BundleStockCard
        makes={makes}
        warehouseId={warehouseId}
        warehouseName={warehouseName}
        onWarehouse={setPicked}
        owners={owners.data}
        loading={products.isPending || stock.isPending}
      />

      <ConfirmDialog
        title={t("bundles.deleteTitle")}
        message={t("bundles.deleteConfirm", { name: bundle.name })}
        confirmLabel={t("bundles.delete")}
        onConfirm={remove}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </Stack>
  );
}
