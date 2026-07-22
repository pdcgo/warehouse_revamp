import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Pencil, UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../api/clients";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";
import { Pagination } from "../components/Pagination";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TeamItem } from "../components/TeamItem";
import { UserItem } from "../components/UserItem";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { AddMemberDialog } from "../users/AddMemberDialog";
import { useRemoveTeamMember, useUsers } from "../users/queries";
import { EditTeamDialog } from "./EditTeamDialog";

const MEMBER_PAGE_SIZE = 20;

// A labelled read-only field. Falls back to a dash for an empty value so the layout never collapses.
export function DetailField({ label, value }: { label: string; value: string }) {
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

// TeamDetailCommon is the SHARED core of every team detail page (#79). It renders the parts every
// type has — the header + Edit, the TeamItem, code/description, contact & bank, and the members list
// with add/remove — and drops the caller's `extra` (a type-specific section, e.g. warehouse hours or
// selling shops) in between. The per-type pages compose this; the dispatcher loads the team and
// passes it in.
export function TeamDetailCommon({
  team,
  noun,
  backTo = "/teams",
  extra,
}: {
  team: Team;
  noun: string;
  backTo?: string;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const { current } = useTeam();

  const [memberQuery, setMemberQuery] = useState("");
  const [memberPage, setMemberPage] = useState(1);

  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<User | null>(null);

  // Member management is a root/admin action here (this page is reached from the root-access
  // management menus). The backend's scope check is the real gate regardless of what we render.
  const admin = isGlobalAdmin(current?.role);

  // The members list is the USERS domain's `useUsers` — the same hook, and the same cache entry, the
  // Users screen reads. That is deliberate: "who is in this team?" is one question, and giving this
  // page its own copy is how the two screens would start disagreeing after a membership change made
  // from the other one.
  const membersQuery = useUsers({
    teamId: team.id,
    q: memberQuery,
    page: memberPage,
    pageSize: MEMBER_PAGE_SIZE,
  });
  const removeFromTeam = useRemoveTeamMember();

  const members = membersQuery.data?.users ?? [];
  const memberTotal = membersQuery.data?.totalItems ?? 0;
  const membersLoading = membersQuery.isPending;

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in
  // its loading state, and mutateAsync REJECTS on failure — so the catch is what turns a failed
  // removal into the error toast instead of an unhandled rejection.
  async function removeMember(user: User) {
    try {
      await removeFromTeam.mutateAsync({ teamId: team.id, userId: user.id });

      toaster.create({
        type: "success",
        title: t("teams.memberRemoved", { username: user.username, noun: noun.toLowerCase() }),
      });
    } catch (err) {
      toaster.create({ type: "error", title: t("teams.removeFailed"), description: rpcError(err) });
    }
  }

  const info = team.info;

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
        {t("teams.backToNoun", { noun })}
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md">{t("teams.nounDetails", { noun })}</Heading>
        <Spacer />
        {admin && (
          <Button size="xs" variant="outline" data-testid="team-detail-edit" onClick={() => setEditing(true)}>
            <Icon as={Pencil} boxSize="4" />
            {t("teams.edit")}
          </Button>
        )}
      </Flex>

      <Tabs.Root defaultValue="general">
        <Tabs.List>
          <Tabs.Trigger value="general" data-testid="team-detail-tab-general">
            {t("teams.tabGeneral")}
          </Tabs.Trigger>
          <Tabs.Trigger value="member" data-testid="team-detail-tab-member">
            {t("teams.tabMember")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="general">
          <Stack gap="section">
            <TeamItem
              team={{
          teamName: team.name,
          teamType: team.type,
          teamId: team.id,
          imageUrl: team.imageUrl,
        }}
      />

      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
        <DetailField label={t("teams.code")} value={team.teamCode} />
        <DetailField label={t("teams.description")} value={team.description} />
      </SimpleGrid>

      <Separator />

      <Stack gap="card">
        <Text fontSize="sm" fontWeight="medium" color="fg.muted">
          {t("teams.contactBank")}
        </Text>
        <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
          <DetailField label={t("teams.contactNumber")} value={info?.contactNumber ?? ""} />
          <DetailField label={t("teams.bank")} value={info?.bankType ?? ""} />
          <DetailField label={t("teams.accountHolder")} value={info?.bankOwnerName ?? ""} />
          <DetailField label={t("teams.accountNumber")} value={info?.bankAccountNumber ?? ""} />
        </SimpleGrid>
      </Stack>

            {/* The type-specific section (warehouse hours + location, selling shops, …). */}
            {extra && (
              <>
                <Separator />
                {extra}
              </>
            )}
          </Stack>
        </Tabs.Content>

        <Tabs.Content value="member">
          <Stack gap="card">
            <Flex align="center" gap="card">
              <Heading size="sm">{t("teams.members")}</Heading>
          <Spacer />
          {admin && <AddMemberDialog teamId={team.id} teamType={team.type} />}
        </Flex>

        <Input
          maxW="sm"
          size="sm"
          placeholder={t("teams.searchMembers")}
          value={memberQuery}
          data-testid="member-list-search"
          onChange={(e) => {
            setMemberQuery(e.target.value);
            setMemberPage(1);
          }}
        />

        {membersLoading ? (
          <Spinner colorPalette="brand" size="sm" />
        ) : members.length === 0 ? (
          <Text color="fg.muted" data-testid="team-detail-no-members">
            {memberQuery ? t("teams.noMembersMatch") : t("teams.noMembers")}
          </Text>
        ) : (
          <>
            <Table.Root size="sm" data-testid="team-detail-members">
              <Table.Body>
                {members.map((user) => {
                  const isSelf = identity?.identityId === user.id;

                  return (
                    <Table.Row key={user.id.toString()} data-testid={`member-row-${user.username}`}>
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

            <HStack justify="end">
              <Pagination
                count={memberTotal}
                pageSize={MEMBER_PAGE_SIZE}
                page={memberPage}
                onPageChange={setMemberPage}
              />
            </HStack>
          </>
        )}
          </Stack>
        </Tabs.Content>
      </Tabs.Root>

      {editing && (
        <EditTeamDialog
          team={team}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(false);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setRemoving(null);
          }}
          title={t("teams.removeFromTeamTitle")}
          message={t("teams.removeMemberConfirm", { username: removing.username, teamName: team.name })}
          confirmLabel={t("teams.remove")}
          onConfirm={() => removeMember(removing)}
        />
      )}
    </Stack>
  );
}
