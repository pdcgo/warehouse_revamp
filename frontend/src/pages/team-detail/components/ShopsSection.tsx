import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/Button";
import { Table } from "../../../components/ui/Table";
import { shopClient } from "../../../api/clients";
import type { Shop } from "../../../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { MarketplaceBadge } from "../../../components/MarketplaceBadge";

// ShopsSection is the SELLING-only part of a team detail page (#79): the team's marketplace shops
// (name / code / marketplace), read-only, with a shortcut to the Shops management screen when you
// are viewing your own team. Shops come from ShopList (#66).
export function ShopsSection({ teamId }: { teamId: bigint }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();

  const [shops, setShops] = useState<Shop[]>([]);

  useEffect(() => {
    let alive = true;

    shopClient
      .shopList({ teamId, page: { page: 1, limit: 50 } })
      .then((res) => {
        if (alive) setShops(res.shops);
      })
      .catch(() => {
        if (alive) setShops([]);
      });

    return () => {
      alive = false;
    };
  }, [teamId]);

  // "Manage shops" goes to the Shops screen, which is scoped to the CURRENT team — only offer it when
  // this detail IS the current team, or it would manage a different team's shops.
  const isCurrent = current?.teamId === teamId;

  return (
    <div className="flex flex-col gap-card" data-testid="selling-detail-section">
      <div className="flex items-center gap-card">
        <h2 className="text-[15px] font-semibold">{t("teams.shops")}</h2>
        <div className="flex-1" />
        {isCurrent && (
          <Button
            size="xs"
            variant="outline"
            data-testid="selling-detail-manage-shops"
            onClick={() => navigate("/shops")}
          >
            <Store className="size-4" />
            {t("teams.manageShops")}
          </Button>
        )}
      </div>

      {shops.length === 0 ? (
        <p className="text-fg-muted" data-testid="selling-detail-no-shops">
          {t("teams.noShops")}
        </p>
      ) : (
        <Table.Root data-testid="selling-detail-shops">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("teams.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("teams.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("teams.marketplace")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {shops.map((shop) => (
              <Table.Row key={shop.id.toString()} data-testid={`shop-detail-row-${shop.shopCode}`}>
                <Table.Cell>{shop.name}</Table.Cell>
                <Table.Cell>{shop.shopCode}</Table.Cell>
                <Table.Cell>
                  <MarketplaceBadge marketplace={shop.marketplace} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </div>
  );
}
