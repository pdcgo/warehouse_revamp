import { useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { useTeamDetail } from "../../features/teams/queries";
import { useWarehouseInfo } from "../../features/warehouse/queries";
import { useSeedOnce } from "../../lib/useSeedOnce";
import { SAVE_WAREHOUSE, useSaveWarehouse } from "./queries";
import { ClosuresEditor } from "./components/ClosuresEditor";
import { WeeklyHoursEditor, dayHoursFromWeek, weekFromDayHours } from "./components/WeeklyHoursEditor";
import type { WeekHours } from "./components/WeeklyHoursEditor";

// WarehouseEditPage is the warehouse edit surface as a DEDICATED PAGE (issue #39 comment 6 — not
// a popup). It edits the warehouse's name and description AND its two weekly schedules: general
// operating hours and when it can receive orders.
export function WarehouseEditPage() {
  const { t } = useTranslation();
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();

  const id = teamId ? BigInt(teamId) : 0n;

  // The write, and the team-list invalidation it owes, declared together (#177).
  const saveWarehouse = useSaveWarehouse();
  const saving = saveWarehouse.isPending;
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [operating, setOperating] = useState<WeekHours>(weekFromDayHours(undefined));
  const [receiving, setReceiving] = useState<WeekHours>(weekFromDayHours(undefined));

  // THE TWO READS — team basics (TeamDetail) and the warehouse's profile (WarehouseInfoDetail), asked together. Query
  // hooks (no-global-store-every-read-is-a-query-hook): the profile is the SAME cache entry the closures list below
  // draws from and the team page's Gudang section reads, so this page asks for it ONCE a load — it used to ask twice.
  //
  // ⚠ THEY SIT STILL WHILE THE SAVE RUNS. The save invalidates the teams and this warehouse's profile, and then leaves
  // for the team's page, which reads both afresh; re-read here first, they would be asked twice for one save — and
  // under a form that is about to go. `enabled` as a FUNCTION is evaluated at the invalidation itself, never a render
  // late (features/racks/queries.ts, the rack dialogs' reads).
  const client = useQueryClient();
  const notSaving = () => client.isMutating({ mutationKey: SAVE_WAREHOUSE }) === 0;
  const team = useTeamDetail({ teamId: id, enabled: notSaving });
  const info = useWarehouseInfo({ warehouseId: id, enabled: notSaving });

  // THE FORM IS SEEDED ONCE PER WAREHOUSE, from the answers given since this page opened — a closure added below
  // re-reads the profile, and that answer must never overwrite a name or hours somebody is halfway through typing.
  // Either read failing says so above an empty form, as the one-shot read did.
  const seeded = useSeedOnce(id.toString(), team.isFetchedAfterMount && info.isFetchedAfterMount, () => {
    if (team.isError || info.isError) {
      setError(rpcError(team.error ?? info.error));
      return;
    }

    setName(team.data?.name ?? "");
    setDescription(team.data?.description ?? "");
    setLocation(info.data?.location ?? "");
    setOperating(weekFromDayHours(info.data?.operatingHours));
    setReceiving(weekFromDayHours(info.data?.receivingHours));
  });
  const loading = !seeded;

  async function save(event: FormEvent) {
    event.preventDefault();

    setError("");

    try {
      // A warehouse is a TEAM, so this write stales the team list — the hook invalidates it (#177).
      // Without that the rename is invisible on the Teams page for the whole 30s staleTime.
      await saveWarehouse.mutateAsync({
        teamId: id,
        name,
        description,
        operatingHours: dayHoursFromWeek(operating),
        receivingHours: dayHoursFromWeek(receiving),
        location,
      });

      toaster.create({ type: "success", title: t("teams.warehouseSaved") });
      void navigate(`/teams/${teamId}`);
    } catch (err) {
      setError(rpcError(err));
    }
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  return (
    <Stack gap="section" maxW="2xl" data-testid="warehouse-edit-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="warehouse-edit-back"
          onClick={() => navigate(`/teams/${teamId}`)}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{t("teams.editWarehouseTitle")}</Heading>
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="warehouse-edit-error">
          {error}
        </Text>
      )}

      <form onSubmit={save}>
        <Stack gap="section">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Field.Root required>
                  <Field.Label>{t("teams.name")}</Field.Label>
                  <Input
                    value={name}
                    data-testid="warehouse-edit-name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("teams.description")}</Field.Label>
                  <Textarea
                    value={description}
                    data-testid="warehouse-edit-description"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("teams.location")}</Field.Label>
                  <Textarea
                    value={location}
                    data-testid="warehouse-edit-location"
                    onChange={(e) => setLocation(e.target.value)}
                  />
                  <Field.HelperText>{t("teams.warehouseAddressHelp")}</Field.HelperText>
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root>
            <Card.Body>
              <Stack gap="section">
                <WeeklyHoursEditor
                  label={t("teams.operatingHours")}
                  value={operating}
                  onChange={setOperating}
                  testId="operating-hours"
                />

                <WeeklyHoursEditor
                  label={t("teams.receivingHours")}
                  value={receiving}
                  onChange={setReceiving}
                  testId="receiving-hours"
                />
              </Stack>
            </Card.Body>
          </Card.Root>

          <Flex justify="end">
            <Button type="submit" colorPalette="brand" loading={saving} data-testid="warehouse-edit-save">
              {t("teams.save")}
            </Button>
          </Flex>
        </Stack>
      </form>

      {/* One-off closures, saved one at a time — outside the hours form (a-warehouse-records-its-holidays). Drawn from
          the page's own read of the profile: one WarehouseInfoDetail for the form and the list. */}
      {id !== 0n && <ClosuresEditor warehouseId={id} closures={info.data?.closures ?? []} />}
    </Stack>
  );
}
