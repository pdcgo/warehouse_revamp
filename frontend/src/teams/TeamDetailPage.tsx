import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Flex,
  Heading,
  Icon,
  IconButton,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Pencil, UserMinus } from "lucide-react";
import { rpcError, teamClient, userClient } from "../api/clients";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TeamItem } from "../components/TeamItem";
import { UserItem } from "../components/UserItem";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { AddMemberDialog } from "../users/AddMemberDialog";
import { EditTeamDialog } from "./EditTeamDialog";

function parseTeamId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field. Falls back to a dash for an empty value so the layout never collapses.
function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// TeamDetailPage is the dedicated detail route for a team (#38) / warehouse (#39). It shows the team
// (TeamItem, code, description, contact & bank via TeamDetail) and its MEMBERS, with add/remove.
// `noun` and `backTo` differ between the Teams and Warehouses entry points; a warehouse is a team.
export function TeamDetailPage({
  noun = "Team",
  backTo = "/teams",
}: {
  noun?: string;
  backTo?: string;
}) {
  const { teamId: teamIdParam } = useParams();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const { current } = useTeam();

  const teamId = parseTeamId(teamIdParam);

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [members, setMembers] = useState<User[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<User | null>(null);

  // Member management is a root/admin action here (this page is reached from the root-access
  // management menus). The backend's scope check is the real gate regardless of what we render.
  const admin = isGlobalAdmin(current?.role);

  const loadTeam = useCallback(async () => {
    if (teamId === 0n) {
      setError("Invalid team id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await teamClient.teamDetail({ teamId });
      setTeam(res.team ?? null);
    } catch (err) {
      setError(rpcError(err));
      setTeam(null);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const loadMembers = useCallback(async () => {
    if (teamId === 0n) {
      setMembersLoading(false);
      return;
    }

    setMembersLoading(true);

    try {
      const res = await userClient.userList({ teamId, page: { page: 1, limit: 100 } });
      setMembers(res.users);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadTeam();
    void loadMembers();
  }, [loadTeam, loadMembers]);

  async function removeMember(user: User) {
    try {
      await userClient.teamUserUpdate({
        teamId,
        action: { case: "remove", value: { userId: user.id } },
      });

      toaster.create({ type: "success", title: `${user.username} removed from the ${noun.toLowerCase()}` });
      await loadMembers();
    } catch (err) {
      toaster.create({ type: "error", title: "Remove failed", description: rpcError(err) });
    }
  }

  const info = team?.info;

  return (
    <Stack gap="section" data-testid="team-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="team-detail-back"
        onClick={() => navigate(backTo)}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        Back to {noun}s
      </Button>

      {error && (
        <Text color="red.fg" data-testid="team-detail-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        team && (
          <>
            <Flex align="center" gap="card">
              <Heading size="md">{noun} Details</Heading>
              <Spacer />
              {admin && (
                <Button
                  size="xs"
                  variant="outline"
                  data-testid="team-detail-edit"
                  onClick={() => setEditing(true)}
                >
                  <Icon as={Pencil} boxSize="4" />
                  Edit
                </Button>
              )}
            </Flex>

            <TeamItem
              team={{
                teamName: team.name,
                teamType: team.type,
                teamId: team.id,
                imageUrl: team.imageUrl,
              }}
            />

            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <DetailField label="Code" value={team.teamCode} />
              <DetailField label="Description" value={team.description} />
            </SimpleGrid>

            <Separator />

            <Stack gap="card">
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                Contact &amp; bank
              </Text>
              <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
                <DetailField label="Contact number" value={info?.contactNumber ?? ""} />
                <DetailField label="Bank" value={info?.bankType ?? ""} />
                <DetailField label="Account holder" value={info?.bankOwnerName ?? ""} />
                <DetailField label="Account number" value={info?.bankAccountNumber ?? ""} />
              </SimpleGrid>
            </Stack>

            <Separator />

            <Stack gap="card">
              <Flex align="center" gap="card">
                <Heading size="sm">Members</Heading>
                <Spacer />
                {admin && (
                  <AddMemberDialog
                    teamId={team.id}
                    teamType={team.type}
                    onDone={() => void loadMembers()}
                  />
                )}
              </Flex>

              {membersLoading ? (
                <Spinner colorPalette="brand" size="sm" />
              ) : members.length === 0 ? (
                <Text color="fg.muted" data-testid="team-detail-no-members">
                  No members yet.
                </Text>
              ) : (
                <Table.Root size="sm" data-testid="team-detail-members">
                  <Table.Body>
                    {members.map((user) => {
                      const isSelf = identity?.identityId === user.id;

                      return (
                        <Table.Row
                          key={user.id.toString()}
                          data-testid={`member-row-${user.username}`}
                        >
                          <Table.Cell>
                            <UserItem user={user} />
                          </Table.Cell>
                          <Table.Cell textAlign="end">
                            {admin && !isSelf && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                aria-label={`Remove ${user.username}`}
                                data-testid={`remove-member-${user.username}`}
                                onClick={() => setRemoving(user)}
                              >
                                <Icon as={UserMinus} boxSize="4" />
                              </IconButton>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>
              )}
            </Stack>

            {editing && (
              <EditTeamDialog
                team={team}
                open
                onOpenChange={(o) => {
                  if (!o) setEditing(false);
                }}
                onDone={() => void loadTeam()}
              />
            )}

            {removing && (
              <ConfirmDialog
                open
                onOpenChange={(o) => {
                  if (!o) setRemoving(null);
                }}
                title="Remove from Team"
                message={`Remove ${removing.username} from "${team.name}"? The account itself is kept.`}
                confirmLabel="Remove"
                onConfirm={() => removeMember(removing)}
              />
            )}
          </>
        )
      )}
    </Stack>
  );
}
