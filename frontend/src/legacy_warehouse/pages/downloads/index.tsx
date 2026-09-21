import { Badge, Button, HStack, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Download, TabletSmartphone } from "lucide-react";
import { Card } from "../../../legacy/components/display/Card";
import { DateCell } from "../../../legacy/components/cells/DateCell";
import { Alert } from "../../../legacy/components/display/Alert";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { AppBuild } from "../../fixtures";

// ── THE APP DOWNLOADS ───────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS SCREEN IS THE STRONGEST EVIDENCE IN THE PORT THAT THIS IS A DIFFERENT KIND OF APP.
//
// The floor app ships an Android build, and this is how it reaches the handhelds — a page in the web
// app that serves the APK directly. There is no store listing and no MDM. The original even carries
// a signing-key script beside the build tooling.
//
// That is not laziness. A warehouse handheld is:
//
//   · not the operator's personal phone, so a store account is somebody's problem to own
//   · frequently offline or on a throttled connection, so a store update is unreliable
//   · replaced mid-shift when one is dropped, and the replacement has to be working in minutes
//
// Serving the APK from the app the supervisor is already signed into solves all three. The cost is
// that version control becomes a human process — nothing forces an update, so a device can sit on an
// old build indefinitely, and the FLOOR has no way to know. That is what the "current" marking and
// the release note are for, and it is the weakest part of the arrangement.
export const description =
  "How the Android build reaches the handhelds: served directly from the web app, no store listing. Right for devices that are shared, often offline, and replaced mid-shift — at the cost of nothing being able to force an update.";

export interface DownloadsPageProps {
  builds: AppBuild[];
}

export function DownloadsPage({ builds }: DownloadsPageProps) {
  const current = builds.filter((b) => b.current);
  const older = builds.filter((b) => !b.current);

  return (
    <Stack gap="section" p="page" data-testid="downloads-page">
      <ScreenHeader icon={TabletSmartphone} title="Warehouse apps" />

      {/* ⚠ NOTHING HERE CAN FORCE AN UPDATE. A device can sit on an old build indefinitely and the
          floor has no way to know — so the screen says so, rather than implying that publishing a
          build is the same as deploying it. */}
      <Alert tone="info" data-testid="no-force-note">
        Installing is manual. A handheld left on an old build will stay on it until somebody comes
        here and installs the new one.
      </Alert>

      <Stack gap="2">
        <Text fontSize="sm" fontWeight="medium">
          Current
        </Text>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="3">
          {current.map((build) => (
            <BuildCard key={`${build.name}-${build.version}`} build={build} />
          ))}
        </SimpleGrid>
      </Stack>

      {older.length > 0 && (
        <Stack gap="2">
          <Text fontSize="sm" fontWeight="medium">
            Older
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Kept because a new build occasionally has to be rolled back from a handheld with no
            connection to do it over.
          </Text>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="3">
            {older.map((build) => (
              <BuildCard key={`${build.name}-${build.version}`} build={build} />
            ))}
          </SimpleGrid>
        </Stack>
      )}
    </Stack>
  );
}

function BuildCard({ build }: { build: AppBuild }) {
  return (
    <Card data-testid="build-card" data-current={build.current ? "true" : "false"}>
      <Stack gap="2">
        <HStack justify="space-between" align="start">
          <Stack gap="0">
            <Text fontWeight="medium" fontSize="sm">
              {build.name}
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              v{build.version} · {build.sizeMb} MB
            </Text>
          </Stack>
          {build.current && (
            <Badge colorPalette="green" data-testid="current-badge">
              Current
            </Badge>
          )}
        </HStack>

        {/* The release note is the only thing telling somebody whether to bother installing. On a
            screen with no forced updates it is doing real work, not decoration. */}
        <Text fontSize="sm" color="fg.muted">
          {build.notes}
        </Text>

        <HStack justify="space-between">
          <Text fontSize="xs" color="fg.muted">
            <DateCell value={build.releasedAt} grain="date" />
          </Text>
          <Button size="xs" variant={build.current ? "solid" : "outline"} data-testid="download">
            <Icon as={Download} boxSize="4" />
            Install
          </Button>
        </HStack>
      </Stack>
    </Card>
  );
}
