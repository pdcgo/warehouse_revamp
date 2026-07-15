import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  HStack,
  Heading,
  Icon,
  IconButton,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { rpcError, userClient } from "../api/clients";
import type { PublicUser, TeamAccessItem } from "../gen/warehouse/user/v1/user_pb";
import type { PageInfo } from "../gen/warehouse/common/v1/page_pb";
import { UserItem } from "../components/UserItem";
import { TeamItem } from "../components/TeamItem";

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
  const { userId: userIdParam } = useParams();
  const navigate = useNavigate();

  const userId = parseUserId(userIdParam);

  const [user, setUser] = useState<PublicUser | null>(null);
  const [teams, setTeams] = useState<TeamAccessItem[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (userId === 0n) {
      setError("Invalid user id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await userClient.userTeams({ userId, page: { page, limit: TEAM_PAGE_SIZE } });
      setUser(res.user ?? null);
      setTeams(res.teams);
      setPageInfo(res.pageInfo);
    } catch (err) {
      setError(rpcError(err));
      setUser(null);
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, [userId, page]);

  useEffect(() => {
    void load();
  }, [load]);

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
        Back
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
            <Heading size="md">User Details</Heading>

            <UserItem user={user} size="md" />

            <Stack gap="card">
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                Teams
              </Text>

              {teams.length === 0 ? (
                <Text color="fg.muted" data-testid="user-detail-empty">
                  Not a member of any team.
                </Text>
              ) : (
                teams.map((t) => (
                  <TeamItem
                    key={t.teamId.toString()}
                    team={{ teamName: t.teamName, teamType: t.teamType, teamId: t.teamId }}
                  />
                ))
              )}

              {pageInfo && pageInfo.totalPage > 1 && (
                <HStack justify="end" gap="card">
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label="Previous page"
                    data-testid="user-teams-prev"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <Icon as={ChevronLeft} boxSize="4" />
                  </IconButton>

                  <Text fontSize="sm" color="fg.muted" data-testid="user-teams-page">
                    Page {page} of {pageInfo.totalPage}
                  </Text>

                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label="Next page"
                    data-testid="user-teams-next"
                    disabled={page >= pageInfo.totalPage}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <Icon as={ChevronRight} boxSize="4" />
                  </IconButton>
                </HStack>
              )}
            </Stack>
          </>
        )
      )}
    </Stack>
  );
}
