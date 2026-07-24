import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useShop } from "../../features/shops/queries";
import { MarketplaceBadge } from "../../components/MarketplaceBadge";
import { ShopFormDialog } from "../../features/shops/ShopFormDialog";
import { ShopUsersSection } from "./components/ShopUsersSection";

function parseShopId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium uppercase text-fg-muted">{label}</span>
      <span className="line-clamp-3 text-sm">{value || "—"}</span>
    </div>
  );
}

// ShopDetailPage is the dedicated detail route for a shop (#85) — a PAGE, not a dialog. It shows the
// shop's read-only info (name, code, marketplace, description), scoped to the current selling team,
// with an Edit shortcut. Reached by clicking a shop row in ShopsPage.
export function ShopDetailPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseShopId(shopId);

  const [editing, setEditing] = useState(false);

  const teamId = current?.teamId;

  const query = useShop({ teamId, shopId: id });

  const shop = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  // A malformed id in the URL is not a failed request — the query never runs for it (`enabled`), so
  // its message is produced here rather than by an error the server never saw.
  const error = id === 0n ? t("shops.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("shops.title")}</h1>
        <p className="text-fg-muted" data-testid="shop-detail-no-team">
          {t("shops.detail.selectTeam")}
        </p>
      </div>
    );
  }

  if (loading) {
    return <Spinner />;
  }

  if (error || !shop) {
    return (
      <div className="flex flex-col gap-section">
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          data-testid="shop-detail-back"
          onClick={() => navigate("/shops")}
        >
          <ArrowLeft className="size-4" />
          {t("shops.detail.back")}
        </Button>
        <p className="text-red-600 dark:text-red-400" data-testid="shop-detail-error">
          {error || t("shops.detail.notFound")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section" data-testid="shop-detail-page">
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        data-testid="shop-detail-back"
        onClick={() => navigate("/shops")}
      >
        <ArrowLeft className="size-4" />
        {t("shops.detail.back")}
      </Button>

      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("shops.detail.title")}</h1>
        <div className="flex-1" />
        <Button size="xs" variant="outline" data-testid="shop-detail-edit" onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
          {t("shops.detail.edit")}
        </Button>
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <div className="flex items-center gap-card">
              <h2 className="text-[15px] font-semibold" data-testid="shop-detail-name">
                {shop.name}
              </h2>
              <MarketplaceBadge marketplace={shop.marketplace} />
            </div>

            <div className="grid grid-cols-1 gap-card sm:grid-cols-2">
              <Field label={t("shops.detail.code")} value={shop.shopCode} />
              <Field label={t("shops.detail.description")} value={shop.description} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <ShopUsersSection teamId={current.teamId} shopId={shop.id} />
        </CardBody>
      </Card>

      {editing && (
        <ShopFormDialog
          shop={shop}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(false);
          }}
        />
      )}
    </div>
  );
}
