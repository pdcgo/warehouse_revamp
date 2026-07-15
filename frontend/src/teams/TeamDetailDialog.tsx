import { useEffect, useState } from "react";
import {
  CloseButton,
  Dialog,
  Portal,
  Separator,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { rpcError, teamClient } from "../api/clients";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { TeamItem } from "../components/TeamItem";

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

// TeamDetailDialog is the read-only detail view for a team (#38) / warehouse (#39) — opened from the
// management row menu. It fetches TeamDetail (which populates `info`, unlike TeamList) so the contact
// and bank details show without a second call. `noun` titles it "Team" or "Warehouse".
export function TeamDetailDialog({
  teamId,
  open,
  onOpenChange,
  noun = "Team",
}: {
  teamId: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun?: string;
}) {
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load only while open, and reset on close so reopening a different row never flashes stale data.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setTeam(null);

    void (async () => {
      try {
        const res = await teamClient.teamDetail({ teamId });

        if (!cancelled) {
          setTeam(res.team ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
          setTeam(null);
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
  }, [open, teamId]);

  const info = team?.info;

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{noun} Details</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              {error && (
                <Text color="red.fg" data-testid="team-detail-error">
                  {error}
                </Text>
              )}

              {loading ? (
                <Spinner colorPalette="brand" />
              ) : (
                team && (
                  <Stack gap="section" data-testid="team-detail">
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
                  </Stack>
                )
              )}
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
