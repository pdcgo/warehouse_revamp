import { useState } from "react";
import type { ElementType, ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Center,
  Field,
  Heading,
  HStack,
  Icon,
  Input,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { CalendarClock, ContactRound, Eye, House, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

import { rpcError } from "../../api/clients";
import { Logo } from "../../components/chrome/Logo";
import { CharCount } from "../../components/inputs/CharCount";
import { useAuth } from "../../features/auth/AuthContext";
import { denyUrl, leaveApp } from "../../features/agents/connect";
import { CONNECTION_NAME_MAX } from "../../features/agents/limits";
import { useAgentClientDetail, useAgentConnect, useMyMemberships, useTeamAgentPolicy } from "../../features/agents/queries";
import { ROOT_TEAM_ID } from "../../features/team/TeamContext";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import type { TeamAccessItem } from "../../gen/warehouse/user/v1/user_pb";
import { connectNeedsOwnersConsent } from "../../lib/roles";
import { AgentTeamSelect, EVERY_TEAM } from "./components/AgentTeamSelect";

/** What the agent's OAuth authorize sent the browser here with. `null` when a part the connect cannot do without is missing. */
interface ConnectLink {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

// The link is the authorize endpoint's redirect: client_id, redirect_uri, state and the PKCE pair. A link without the
// client, the redirect or an S256 challenge cannot end in a connection — AgentConnect would refuse it — so it is not a
// valid link, said before anything is asked of the person.
function readLink(params: URLSearchParams): ConnectLink | null {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "";

  if (!clientId || !redirectUri || !codeChallenge || method !== "S256") return null;

  return { clientId, redirectUri, codeChallenge, state: params.get("state") ?? "" };
}

/** Root or the Administrator, held in the root team — the reach that lets an agent read every team. */
function readsEveryTeam(teams: TeamAccessItem[]): boolean {
  const role = teams.find((team) => team.teamId === ROOT_TEAM_ID)?.role;

  return role === Role.ROOT || role === Role.ADMINISTRATOR;
}

// THE CONNECT PAGE — where an AI agent's OAuth login lands (our-server-hosts-the-mcp). ChatGPT or Claude sends the
// browser to our authorize endpoint, which sends it here; the person names the connection, picks the ONE team it reads
// (or every team, for Root — a-roots-agent-reads-every-team), and Allow mints the agent its own credential: read-only,
// 90 days, revoked on its own from /profile (an-agent-gets-its-own-team-credential).
//
// OUTSIDE THE APP SHELL, like the login page: a person arriving from an agent is in the middle of the agent's flow, not
// in the warehouse app, and a sidebar here would be a dozen ways to wander off before finishing it.
//
// ⚠ NOTHING IS SENT ANYWHERE UNCHECKED. AgentClientDetail answers first; until it accepts the client AND its redirect,
// there is no Allow and no Deny — a Deny to an unchecked redirect would make this page an open redirect.
export function ConnectAgentPage() {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const [params] = useSearchParams();

  const link = readLink(params);
  const client = useAgentClientDetail({
    clientId: link?.clientId ?? "",
    redirectUri: link?.redirectUri ?? "",
    enabled: link !== null,
  });
  const memberships = useMyMemberships(identity?.identityId);

  let body: ReactNode;

  if (link === null || client.isError) {
    body = <InvalidLink />;
  } else if (client.isPending || memberships.isPending) {
    body = (
      <Center py="section" data-testid="agent-connect-loading">
        <Spinner colorPalette="brand" />
      </Center>
    );
  } else if (memberships.isError) {
    body = (
      <Alert.Root status="error" data-testid="agent-connect-teams-failed">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t("agents.connect.teamsFailed")}</Alert.Title>
          <Alert.Description>{rpcError(memberships.error)}</Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  } else {
    body = (
      <ConsentForm
        link={link}
        clientName={client.data}
        teams={memberships.data}
        username={identity?.username ?? ""}
      />
    );
  }

  return (
    <Stack align="center" justify="center" minH="100dvh" p={{ base: "card", md: "page" }}>
      <Card.Root maxW="md" w="full" data-testid="agent-connect">
        <Card.Body>
          <Stack gap="section">
            <Logo size={40} justify="center" pb="1" />
            {body}
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

function InvalidLink() {
  const { t } = useTranslation();

  return (
    <Stack gap="card">
      <Heading size="md" textAlign="center">
        {t("agents.connect.titleGeneric")}
      </Heading>

      <Alert.Root status="error" data-testid="agent-link-invalid">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t("agents.connect.invalidTitle")}</Alert.Title>
          <Alert.Description>{t("agents.connect.invalidHint")}</Alert.Description>
        </Alert.Content>
      </Alert.Root>

      <Button asChild variant="outline">
        <RouterLink to="/">
          <Icon as={House} boxSize="4" />
          {t("agents.connect.goToApp")}
        </RouterLink>
      </Button>
    </Stack>
  );
}

/** One thing Allow means — read-only, the buyer's details, 90 days, revocable. */
function Fact({ icon, children }: { icon: ElementType; children: ReactNode }) {
  return (
    <HStack as="li" gap="3" align="flex-start">
      <Icon as={icon} boxSize="4" color="brand.fg" mt="0.5" flexShrink={0} />
      <Text fontSize="sm">{children}</Text>
    </HStack>
  );
}

function ConsentForm({
  link,
  clientName,
  teams,
  username,
}: {
  link: ConnectLink;
  clientName: string;
  teams: TeamAccessItem[];
  username: string;
}) {
  const { t } = useTranslation();
  const connect = useAgentConnect();

  const offerEveryTeam = readsEveryTeam(teams);

  // ⚠ A team is picked, not assumed: Allow sends that team's data to a third party. The one case with nothing to
  // choose — a single option — starts on it.
  const optionCount = teams.length + (offerEveryTeam ? 1 : 0);
  const [teamId, setTeamId] = useState<bigint | undefined>(() =>
    optionCount === 1 ? (offerEveryTeam ? EVERY_TEAM : teams[0]!.teamId) : undefined,
  );
  // Named after the agent until the person says otherwise — "ChatGPT", then "ChatGPT, Heri's laptop".
  const [name, setName] = useState(clientName.slice(0, CONNECTION_NAME_MAX));
  const [error, setError] = useState("");
  // Set once the browser is on its way back to the agent, so nothing can be pressed twice in the gap.
  const [leaving, setLeaving] = useState(false);

  const picked = teamId !== undefined && teamId !== EVERY_TEAM ? teams.find((team) => team.teamId === teamId) : undefined;

  // CS and staff connect only once the team's owner has turned it on (the-owner-decides-who-connects-an-agent). Asked
  // only for them: an owner, an admin or Root never needs it, and AgentConnect is the boundary either way.
  const needsConsent = picked !== undefined && connectNeedsOwnersConsent(picked.role);
  const policy = useTeamAgentPolicy({ teamId: picked?.teamId, enabled: needsConsent });
  const notAllowed = needsConsent && policy.data === false;

  const canAllow =
    teamId !== undefined && name.trim() !== "" && !notAllowed && !(needsConsent && policy.isPending) && !leaving;

  async function allow() {
    if (teamId === undefined) return;

    setError("");

    try {
      const redirectUrl = await connect.mutateAsync({
        clientId: link.clientId,
        redirectUri: link.redirectUri,
        codeChallenge: link.codeChallenge,
        state: link.state,
        teamId,
        name: name.trim(),
      });

      setLeaving(true);
      leaveApp(redirectUrl);
    } catch (err) {
      setError(rpcError(err));
    }
  }

  function deny() {
    setLeaving(true);
    leaveApp(denyUrl(link.redirectUri, link.state));
  }

  return (
    <Stack gap="section">
      <Stack gap="1" textAlign="center">
        <Heading size="md" data-testid="agent-connect-title">
          {t("agents.connect.title", { client: clientName })}
        </Heading>
        <Text color="fg.muted" data-testid="agent-connect-lead">
          {t("agents.connect.lead", { client: clientName })}
        </Text>
      </Stack>

      <Stack as="ul" gap="2" listStyleType="none" data-testid="agent-connect-facts">
        <Fact icon={Eye}>{t("agents.connect.factReadOnly")}</Fact>
        <Fact icon={ContactRound}>{t("agents.connect.factBuyer", { client: clientName })}</Fact>
        <Fact icon={CalendarClock}>{t("agents.connect.factDays")}</Fact>
        <Fact icon={Unplug}>{t("agents.connect.factRevoke")}</Fact>
      </Stack>

      <Field.Root required>
        <Field.Label>
          {t("agents.connect.team")}
          <Field.RequiredIndicator />
        </Field.Label>
        <AgentTeamSelect
          teams={teams}
          offerEveryTeam={offerEveryTeam}
          value={teamId}
          disabled={leaving}
          onChange={(next) => {
            setError("");
            setTeamId(next);
          }}
        />
        {teamId === EVERY_TEAM && <Field.HelperText>{t("agents.connect.everyTeamHelper")}</Field.HelperText>}
      </Field.Root>

      {notAllowed && (
        <Alert.Root status="warning" data-testid="agent-connect-not-allowed">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("agents.connect.notAllowedTitle")}</Alert.Title>
            <Alert.Description>{t("agents.connect.notAllowedHint", { team: picked?.teamName ?? "" })}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      <Field.Root required>
        <Field.Label>
          {t("agents.connect.name")}
          <Field.RequiredIndicator />
        </Field.Label>
        <Input
          value={name}
          maxLength={CONNECTION_NAME_MAX}
          placeholder={t("agents.connect.namePlaceholder")}
          disabled={leaving}
          data-testid="agent-connect-name"
          onChange={(e) => setName(e.target.value)}
        />
        <HStack justify="space-between" align="flex-start" w="full" gap="2">
          <Field.HelperText>{t("agents.connect.nameHelper")}</Field.HelperText>
          <CharCount value={name} max={CONNECTION_NAME_MAX} />
        </HStack>
      </Field.Root>

      {error && (
        <Alert.Root status="error" data-testid="agent-connect-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("agents.connect.failed")}</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {/* A phone stacks them full width, Allow on top where the thumb is; a desktop puts them at the end of the row. */}
      <Stack direction={{ base: "column-reverse", md: "row" }} justify="flex-end" gap="2">
        <Button variant="outline" disabled={leaving} data-testid="agent-deny" onClick={deny}>
          {t("agents.connect.deny")}
        </Button>
        <Button
          colorPalette="brand"
          loading={connect.isPending || leaving}
          disabled={!canAllow}
          data-testid="agent-allow"
          onClick={() => void allow()}
        >
          {t("agents.connect.allow")}
        </Button>
      </Stack>

      <Text fontSize="xs" color="fg.muted" textAlign="center" data-testid="agent-connect-signed-in">
        {t("account.signedInAs")} <strong>{username}</strong>
      </Text>
    </Stack>
  );
}
