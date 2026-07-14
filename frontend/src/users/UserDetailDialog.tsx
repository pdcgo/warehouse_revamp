import { useEffect, useState } from "react";
import { CloseButton, Dialog, Portal, Spinner, Stack, Text } from "@chakra-ui/react";
import { rpcError, userClient } from "../api/clients";
import type { TeamAccessItem, User } from "../gen/warehouse/user/v1/user_pb";
import { UserItem } from "../components/UserItem";
import { TeamItem } from "../components/TeamItem";

// UserDetailDialog shows a user and the teams they have joined (issue #40 point 6).
//
// The memberships come from UserTeams — a root/admin read that DEGRADES: if team_service is down
// the team_name/team_type come back blank, so TeamItem falls back to `Team #<id>`. A name outage
// never hides that the membership itself exists.
export function UserDetailDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [teams, setTeams] = useState<TeamAccessItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load the memberships only while open, and reset on close so reopening a different row never
  // flashes the previous user's teams.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const res = await userClient.userTeams({ userId: user.id });

        if (!cancelled) {
          setTeams(res.teams);
        }
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
          setTeams([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user.id]);

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>User Details</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="section" data-testid="user-detail">
                <UserItem user={user} size="md" />

                <Stack gap="card">
                  <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                    Teams
                  </Text>

                  {error && (
                    <Text color="red.fg" data-testid="user-detail-error">
                      {error}
                    </Text>
                  )}

                  {loading ? (
                    <Spinner colorPalette="brand" />
                  ) : teams.length === 0 && !error ? (
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
                </Stack>
              </Stack>
            </Dialog.Body>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
