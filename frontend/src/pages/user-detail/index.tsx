import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { rpcError } from "../../api/clients";
import { useUserTeams } from "../../features/users/queries";
import { UserItem } from "../../components/UserItem";
import { TeamItem } from "../../components/TeamItem";
import { Pagination } from "../../components/Pagination";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";

const TEAM_PAGE_SIZE = 20;

function parseUserId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// UserDetailPage is the dedicated detail route for a user (#40) — a PAGE, not a dialog (HARD RULE:
// details are pages). It shows the user and the teams they have joined via UserTeams, a root/admin
// read that degrades: if team_service is down the team names come back blank and TeamItem falls
// back to `Team #<id>`.
export function UserDetailPage() {
  const { t } = useTranslation();
  const { userId: userIdParam } = useParams();
  const navigate = useNavigate();

  const userId = parseUserId(userIdParam);

  const [page, setPage] = useState(1);

  const query = useUserTeams({ userId, page, pageSize: TEAM_PAGE_SIZE });

  const user = query.data?.user ?? null;
  const teams = query.data?.teams ?? [];
  const pageInfo = query.data?.pageInfo;
  const loading = query.isPending && userId !== 0n;

  // A malformed id never reaches the server, so its message comes from here.
  const error = userId === 0n ? t("users.detail.invalidId") : query.isError ? rpcError(query.error) : "";


  return (
    <div className="flex flex-col gap-section" data-testid="user-detail-page">
      <Button
        size="xs"
        variant="ghost"
        colorPalette="gray"
        className="self-start"
        data-testid="user-detail-back"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft className="size-4" />
        {t("users.detail.back")}
      </Button>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="user-detail-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        user && (
          <>
            <h1 className="text-[22px] font-bold">{t("users.detail.title")}</h1>

            <UserItem user={user} size="md" />

            <div className="flex flex-col gap-card">
              <p className="text-sm font-medium text-fg-muted">{t("users.detail.teams")}</p>

              {teams.length === 0 ? (
                <p className="text-fg-muted" data-testid="user-detail-empty">
                  {t("users.detail.noTeams")}
                </p>
              ) : (
                teams.map((t) => (
                  <TeamItem
                    key={t.teamId.toString()}
                    team={{
                      teamName: t.teamName,
                      teamType: t.teamType,
                      teamId: t.teamId,
                      imageUrl: t.imageUrl,
                    }}
                  />
                ))
              )}

              <div className="flex items-center justify-end">
                <Pagination
                  count={Number(pageInfo?.totalItems ?? 0n)}
                  pageSize={TEAM_PAGE_SIZE}
                  page={page}
                  onPageChange={setPage}
                />
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
