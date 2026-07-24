import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  HStack,
  Heading,
  Icon,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { rpcError } from "../../api/clients";
import { useUserTeams } from "../../features/users/queries";
import { UserItem } from "../../components/UserItem";
import { TeamItem } from "../../components/TeamItem";
import { Pagination } from "../../components/Pagination";

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
    <Stack gap="section" data-testid="user-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="user-detail-back"
        onClick={() => navigate(-1)}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("users.detail.back")}
      </Button>

      {error && (
        <Text color="red.fg" data-testid="user-detail-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        user && (
          <>
            <Heading size="md">{t("users.detail.title")}</Heading>

            <UserItem user={user} size="md" />

            <Stack gap="card">
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                {t("users.detail.teams")}
              </Text>

              {teams.length === 0 ? (
                <Text color="fg.muted" data-testid="user-detail-empty">
                  {t("users.detail.noTeams")}
                </Text>
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

              <HStack justify="end">
                <Pagination
                  count={Number(pageInfo?.totalItems ?? 0n)}
                  pageSize={TEAM_PAGE_SIZE}
                  page={page}
                  onPageChange={setPage}
                />
              </HStack>
            </Stack>
          </>
        )
      )}
    </Stack>
  );
}
