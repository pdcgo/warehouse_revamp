import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, DataList, Flex, Grid, HStack, Heading, Icon, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Lock, LockOpen, Pencil } from "lucide-react";
import { rpcError } from "../../api/clients";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useReopenShop, useShop } from "../../features/shops/queries";
import { useIsMobile } from "../../layouts/shell";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { CopyText } from "../../components/chrome/CopyText";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { toaster } from "../../components/feedback/Toaster";
import { ShopFormDialog } from "../../features/shops/ShopFormDialog";
import { CloseShopDialog } from "../../features/shops/CloseShopDialog";
import { ShopStatusBadge } from "../../features/shops/ShopStatusBadge";
import { isShopClosed } from "../../features/shops/status";
import { formatUnixDate } from "../../lib/datetime";
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
//   Melati Official                                           [✎ Ubah] [🔒 Tutup Toko]   ← one row; icons on a phone
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
// The page's title is the shop's name — "Detail Toko" names the card of its facts, not the page. Close Shop is here
// too, as on the list, so a phone (whose list block opens the page) can reach it. There is no delete
// (a-shop-is-closed-never-deleted): Close Shop confirms and says what it does (CloseShopDialog), and a closed shop's page
// says so (the-close-shop-prototype-is-accepted):
//
//   ← Back to Shops
//   Melati Store [🔒 Closed]                                               [🔓 Reopen Shop]
//   ┌ ⓘ This shop is closed ────────────────────────────────────────────────────────────────┐
//   │ Closed on 3 Nov 2026. It takes no new orders or drafts. Its placed orders run to their │
//   │ end, its statements still import, and who has access can still change. …              │
//   └────────────────────────────────────────────────────────────────────────────────────────┘
//   Shop Details · Withdrawal Account (no new link) │ Users with Access — still editable
//
// No Edit on a closed shop (a-closed-shop-locks-all-but-its-grants); its access panel keeps working, so its last
// statements can still be imported. No new withdrawal account is linked to it (a-closed-shop-takes-no-new-account-link).
export function ShopDetailPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const id = parseShopId(shopId);

  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);

  const teamId = current?.teamId;

  const query = useShop({ teamId, shopId: id });
  const reopenShop = useReopenShop();

  const shop = query.data ?? null;
  const closed = isShopClosed(shop);
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

  // Reopen runs at once (not destructive); refused while an open shop holds the code, naming it.
  async function reopen() {
    if (!shop || teamId === undefined) return;

    try {
      await reopenShop.mutateAsync({ teamId, shopId: shop.id });
      toaster.create({ type: "success", title: t("shops.reopen.done", { name: shop.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.reopen.failed"), description: rpcError(err) });
    }
  }

  // The header's actions: Edit · Close Shop on an open shop, Reopen Shop alone on a closed one. On a phone each is its
  // icon (a-phone-header-action-is-an-icon).
  function headerActions() {
    if (!canWrite(current)) return null;

    if (closed) {
      return isMobile ? (
        <CompactActions
          menuLabel={t("common.actions")}
          actions={[
            { id: "reopen", label: t("shops.reopen.title"), icon: LockOpen, primary: true, testId: "shop-detail-reopen", onClick: () => void reopen() },
          ]}
        />
      ) : (
        <Button
          size="xs"
          variant="outline"
          colorPalette="brand"
          flexShrink={0}
          loading={reopenShop.isPending}
          data-testid="shop-detail-reopen"
          onClick={() => void reopen()}
        >
          <Icon as={LockOpen} boxSize="4" />
          {t("shops.reopen.title")}
        </Button>
      );
    }

    // Close in Delete's place — there is no delete (a-shop-is-closed-never-deleted).
    const last = { id: "close", label: t("shops.close.title"), icon: Lock, testId: "shop-detail-close", onClick: () => setClosing(true) };

    return isMobile ? (
      <CompactActions
        menuLabel={t("common.actions")}
        actions={[
          { id: "edit", label: t("shops.detail.edit"), icon: Pencil, testId: "shop-detail-edit", onClick: () => setEditing(true) },
          { ...last, danger: true },
        ]}
      />
    ) : (
      <HStack gap="1.5" flexShrink={0}>
        <Button size="xs" variant="outline" data-testid="shop-detail-edit" onClick={() => setEditing(true)}>
          <Icon as={Pencil} boxSize="4" />
          {t("shops.detail.edit")}
        </Button>
        <Button size="xs" variant="outline" colorPalette="error" data-testid={last.testId} onClick={last.onClick}>
          <Icon as={last.icon} boxSize="4" />
          {last.label}
        </Button>
      </HStack>
    );
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
            {/* The status sits on the header's one row (the-phone-header-is-one-row). */}
            {closed && <ShopStatusBadge testId="shop-detail-closed" />}
          </HStack>
          {headerActions()}
        </Flex>
      </Stack>

      {/* A CLOSED SHOP'S PAGE SAYS WHAT IT STILL DOES, under the title: the day it closed, what it refuses,
          what keeps working, what is locked (the closed-shop decisions). Reopen is the header's. */}
      {closed && (
        <Alert.Root status="info" data-testid="shop-closed-banner">
          <Alert.Indicator>
            <Icon as={Lock} />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>{t("shops.closedBanner.title")}</Alert.Title>
            <Alert.Description>
              {t("shops.closedBanner.since", { date: formatUnixDate(shop.closedAtUnix) })} {t("shops.closedBanner.body")}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

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

          <WithdrawalAccountCard teamId={current.teamId} shop={shop} closed={closed} />
        </Stack>

        {/* WHO WORKS ON IT — the access panel; the section draws its own card. */}
        <ShopUsersSection
          teamId={current.teamId}
          shopId={shop.id}
          primaryUserId={shop.primaryUserId}
          onChanged={() => void query.refetch()}
        />
      </Grid>

      {/* The close — it stays on the page, which then reads as closed. */}
      {!closed && (
        <CloseShopDialog teamId={current.teamId} shop={shop} open={closing} onOpenChange={setClosing} />
      )}

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
