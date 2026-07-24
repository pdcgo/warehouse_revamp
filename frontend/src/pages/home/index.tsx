import { useTranslation } from "react-i18next";
import { Card, CardBody } from "../../components/ui/Card";
import { useAuth } from "../../features/auth/AuthContext";
import { useTeam } from "../../features/team/TeamContext";

export function HomePage() {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const { current } = useTeam();

  return (
    <div className="flex max-w-lg flex-col gap-section">
      <h1 className="text-[22px] font-bold">{t("account.signedIn")}</h1>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-field">
            <p data-testid="home-user">
              {t("account.userLabel")} <strong>{identity?.username}</strong>
            </p>

            {/* The current team IS the authorization scope: its id goes in the body of every
                scoped RPC. */}
            <p data-testid="home-team">
              {t("account.teamLabel")} <strong>{current?.teamName || "-"}</strong>
              {current ? ` (role ${current.role})` : ""}
            </p>
          </div>
        </CardBody>
      </Card>

      <p className="text-sm text-fg-muted">{t("account.warehouseNotDesigned")}</p>
    </div>
  );
}
