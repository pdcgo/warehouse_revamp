import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, DataList, Flex, Grid, HStack, Heading, Icon, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useDeleteShop, useShop } from "../../features/shops/queries";
import { useIsMobile } from "../../layouts/shell";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { CopyText } from "../../components/chrome/CopyText";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { toaster } from "../../components/feedback/Toaster";
import { ShopFormDialog } from "../../features/shops/ShopFormDialog";
import { ShopUsersSection } from "./components/ShopUsersSection";
import { WithdrawalAccountCard } from "./components/WithdrawalAccountCard";

function parseShopId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// ShopDetailPage is the dedicated detail route for a shop (#85) — a PAGE, not a dialog — scoped to the current selling
// team, reached by clicking a shop on ShopsPage.
//
// IT FOLLOWS THE SCREEN RULES (owner: *"untuk toko normalisasi dengan keputusan tampilanku sebelumnya"*,
// `the-shop-screens-follow-the-screen-rules`), the supplier page's shape:
//
//   ← Kembali ke Toko
//   Melati Official                                           [✎ Ubah] [🗑 Hapus]   ← one row; icons on a phone
//   ┌ Detail Toko ─────────────────┐ ┌ Pengguna dengan Akses ──────────────────────┐  ← two panels from `lg`
//   │ Kode         MEL-SHP ⧉       │ │ [Ketik username anggota      ] [Tambah]     │
//   │ Marketplace  [Shopee]        │ │ Ani Rahayu  @ani  [CS utama]           ⊖    │
//   │                              │ │ Budi Santoso @budi              ☆      ⊖    │
//   │ Deskripsi    —               │ └─────────────────────────────────────────────┘
//   └──────────────────────────────┘
//   ┌ Akun Penarikan ──────────────┐   ← under the details; none → a link to the accounts
//   │ [BCA] BCA Operasional [Buka ›]│
//   └──────────────────────────────┘
//
// The page's title is the shop's name — "Detail Toko" names the card of its facts, not the page. Delete is here too,
// as on the list, so a phone (whose list block opens the page) can reach it.
export function ShopDetailPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const id = parseShopId(shopId);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const teamId = current?.teamId;

  const query = useShop({ teamId, shopId: id });
  const deleteShop = useDeleteShop();

  const shop = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  // A malformed id in the URL is not a failed request — the query never runs for it (`enabled`), so its message is
  // produced here rather than by an error the server never saw.
  const error = id === 0n ? t("shops.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      data-testid="shop-detail-back"
      onClick={() => navigate("/shops")}
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("shops.detail.back")}
    </Button>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("shops.title")}</Heading>
        <Text color="fg.muted" data-testid="shop-detail-no-team">
          {t("shops.detail.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // The page's shape while the shop loads, not a spinner on an empty page (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={3} testId="shop-detail-loading" />;
  }

  if (error || !shop) {
    return (
      <Stack gap="section">
        {back}
        <Text color="error.fg" data-testid="shop-detail-error">
          {error || t("shops.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  // Delete confirms, then goes back to the list — the page it was on no longer opens.
  async function remove() {
    if (!shop || teamId === undefined) return;

    try {
      await deleteShop.mutateAsync({ teamId, shopId: shop.id });
      toaster.create({ type: "success", title: t("shops.detail.deleted", { name: shop.name }) });
      navigate("/shops");
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.deleteFailed"), description: rpcError(err) });
    }
  }

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="shop-detail-page">
      {back}

      {/* THE NAME AND ITS ACTIONS — one row; on a phone it stays one row, the actions their icons
          (the-phone-header-is-one-row, a-phone-header-action-is-an-icon). Its facts are the Detail Toko card under it. */}
      <Stack gap="1.5">
        <Flex align="center" gap="card" wrap={isMobile ? "nowrap" : "wrap"}>
          <HStack gap="2" flex="1 1 16rem" minW="0">
            {/* The name alone — the marketplace is in Detail Toko (owner: *"di atas tidak perlu marketplace"*). */}
            <Heading size="md" truncate={isMobile} minW="0" data-testid="shop-detail-name">
              {shop.name}
            </Heading>
          </HStack>
          {isMobile ? (
            <CompactActions
              menuLabel={t("common.actions")}
              actions={[
                { id: "edit", label: t("shops.detail.edit"), icon: Pencil, testId: "shop-detail-edit", onClick: () => setEditing(true) },
                { id: "delete", label: t("shops.detail.delete"), icon: Trash2, danger: true, testId: "shop-detail-delete", onClick: () => setDeleting(true) },
              ]}
            />
          ) : (
            <HStack gap="1.5" flexShrink={0}>
              <Button size="xs" variant="outline" data-testid="shop-detail-edit" onClick={() => setEditing(true)}>
                <Icon as={Pencil} boxSize="4" />
                {t("shops.detail.edit")}
              </Button>
              <Button
                size="xs"
                variant="outline"
                colorPalette="error"
                data-testid="shop-detail-delete"
                onClick={() => setDeleting(true)}
              >
                <Icon as={Trash2} boxSize="4" />
                {t("shops.detail.delete")}
              </Button>
            </HStack>
          )}
        </Flex>
      </Stack>

      {/* TWO PANELS, DETAIL AND ACCESS (owner: *"untuk toko taruh detail di atas"*, *"yang sekarang saja, tapi ui
          kurang"*, then *"space terlalu banyak, coba jadi 2 panel, detail dan akses"*) — side by side from `lg`, HALF AND
          HALF (*"detail terlalu kecil"* — at 2 : 3 it read as a footnote to the access panel); stacked, the detail first,
          below it. Each its own card, neither inside the other. */}
      <Grid
        templateColumns={{ base: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }}
        gap="section"
        alignItems="start"
        data-testid="shop-detail-panels"
      >
        {/* THE LEFT PANEL — the shop's details, and under them where its withdrawals land (owner: *"di bawah detail ada
            akun penarikan, jika tidak ada kasih link ke rekeningnya"*). */}
        <Stack gap="section" minW="0">
          {/* DETAIL TOKO — what the page already showed, as a label · value list (Chakra's DataList) at the body's own
              size: one line per fact, the description wrapping in its value. No primary CS here — the access panel beside
              it marks who it is (owner: *"di detail tidak perlu ada cs utama"*). */}
          <Card.Root data-testid="shop-detail-info">
            <Card.Header>
              <Card.Title>{t("shops.detail.title")}</Card.Title>
            </Card.Header>
            <Card.Body>
              <DataList.Root orientation="horizontal" size="md" gap="4">
                <DataList.Item data-testid="shop-detail-code">
                  <DataList.ItemLabel minW="7rem">{t("shops.detail.code")}</DataList.ItemLabel>
                  <DataList.ItemValue>
                    <CopyText value={shop.shopCode} />
                  </DataList.ItemValue>
                </DataList.Item>
                <DataList.Item data-testid="shop-detail-marketplace">
                  <DataList.ItemLabel minW="7rem">{t("shops.table.marketplace")}</DataList.ItemLabel>
                  <DataList.ItemValue>
                    <MarketplaceBadge marketplace={shop.marketplace} />
                  </DataList.ItemValue>
                </DataList.Item>
                <DataList.Item data-testid="shop-detail-description">
                  <DataList.ItemLabel minW="7rem">{t("shops.detail.description")}</DataList.ItemLabel>
                  {/* An absent value reads "—", never a blank. */}
                  <DataList.ItemValue whiteSpace="pre-wrap" color={shop.description ? undefined : "fg.subtle"}>
                    {shop.description || "—"}
                  </DataList.ItemValue>
                </DataList.Item>
              </DataList.Root>
            </Card.Body>
          </Card.Root>

          <WithdrawalAccountCard teamId={current.teamId} shop={shop} />
        </Stack>

        {/* WHO WORKS ON IT — the access panel; the section draws its own card. */}
        <ShopUsersSection
          teamId={current.teamId}
          shopId={shop.id}
          primaryUserId={shop.primaryUserId}
          onChanged={() => void query.refetch()}
        />
      </Grid>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("shops.deleteShop")}
        message={t("shops.deleteConfirm", { name: shop.name })}
        confirmLabel={t("shops.delete")}
        onConfirm={remove}
      />

      {editing && (
        <ShopFormDialog
          shop={shop}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(false);
          }}
        />
      )}
    </Stack>
  );
}
