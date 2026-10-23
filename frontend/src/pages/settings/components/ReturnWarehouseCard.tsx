import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Alert, Button, Card, Field, Heading, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { TeamSelect } from "../../../components/teams/TeamSelect";
import { useSetTeamReturnConfiguration, useTeamReturnConfiguration } from "../../../features/orders/queries";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";

export interface ReturnWarehouseCardProps {
  /** The SELLING team whose returns this sets. */
  teamId: bigint;
  /** Whether the person may change it — the team's managers. UX only; the request policy is the boundary. */
  canEdit: boolean;
}

// WHERE THIS TEAM'S RETURNS ARE RECEIVED (the-return-warehouse-lives-in-team-return-configurations) — the
// editor the create check waits on: order create will refuse a team with no return warehouse, and it is only
// switched on once every team has set one (create-refuses-a-team-with-no-return-warehouse).
//
// Any warehouse may be picked (a-team-may-pick-any-return-warehouse). There is no clear — "not set" is the
// state the warning below asks to fix, so the card never offers a way back into it.
export function ReturnWarehouseCard({ teamId, canEdit }: ReturnWarehouseCardProps) {
  const { t } = useTranslation();
  const configuration = useTeamReturnConfiguration({ teamId });
  const save = useSetTeamReturnConfiguration();

  const saved = configuration.data?.warehouseId ?? 0n;
  const [picked, setPicked] = useState<bigint>(0n);

  // Seed from the server, and RE-seed when the team changes — keyed on the saved value, so a refetch that
  // returns the same warehouse does not yank the picker back while somebody is choosing another.
  useEffect(() => {
    setPicked(saved);
  }, [saved, teamId]);

  const notSet = configuration.isSuccess && configuration.data === null;

  async function submit(event: FormEvent) {
    event.preventDefault();

    try {
      await save.mutateAsync({ teamId, warehouseId: picked });
      toaster.create({ type: "success", title: t("account.returnWarehouseSaved") });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  return (
    <Card.Root data-testid="settings-return-warehouse">
      <Card.Body>
        <form onSubmit={submit}>
          <Stack gap="card">
            <Heading size="sm">{t("account.returnWarehouse")}</Heading>

            <Text color="fg.muted" fontSize="xs">
              {t("account.returnWarehouseHint")}
            </Text>

            {notSet && (
              <Alert.Root status="warning" data-testid="return-warehouse-not-set">
                <Alert.Indicator />
                <Alert.Title>{t("account.returnWarehouseNotSet")}</Alert.Title>
              </Alert.Root>
            )}

            <Field.Root>
              <Field.Label>{t("account.warehouse")}</Field.Label>
              <TeamSelect
                value={picked === 0n ? undefined : picked}
                teamType={TeamType.WAREHOUSE}
                disabled={!canEdit || save.isPending}
                onChange={setPicked}
              />
            </Field.Root>

            <Button
              type="submit"
              colorPalette="brand"
              loading={save.isPending}
              // Nothing picked cannot be saved (there is no clear), and the saved warehouse again is no change.
              disabled={!canEdit || picked === 0n || picked === saved}
              data-testid="save-return-warehouse"
            >
              {t("account.save")}
            </Button>
          </Stack>
        </form>
      </Card.Body>
    </Card.Root>
  );
}
