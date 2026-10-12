import { useTranslation } from "react-i18next";
import { Flex, Stat } from "@chakra-ui/react";
import type { UploadedFileTally } from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";

// What became of a file's rows — posted, already there, held, skipped — and, of the posted ones, how
// many went to the shop because their order was not found. The dialog and the file's page read the
// same four numbers, so they are drawn once.
export function FileTally({ tally }: { tally: UploadedFileTally | undefined }) {
  const { t } = useTranslation();

  const cells: { key: string; label: string; value: number; help?: string }[] = [
    {
      key: "posted",
      label: t("settlementImports.tally.posted"),
      value: tally?.posted ?? 0,
      help: tally?.postedToShop
        ? t("settlementImports.tally.postedToShop", { count: tally.postedToShop })
        : undefined,
    },
    { key: "existing", label: t("settlementImports.tally.existing"), value: tally?.existing ?? 0 },
    { key: "held", label: t("settlementImports.tally.held"), value: tally?.held ?? 0 },
    { key: "skipped", label: t("settlementImports.tally.skipped"), value: tally?.skipped ?? 0 },
  ];

  return (
    <Flex gap="card" wrap="wrap" data-testid="file-tally">
      {cells.map((c) => (
        <Stat.Root key={c.key} minW="28" data-testid={`tally-${c.key}`}>
          <Stat.Label>{c.label}</Stat.Label>
          <Stat.ValueText data-testid={`tally-${c.key}-value`}>{c.value.toLocaleString()}</Stat.ValueText>
          {c.help && <Stat.HelpText>{c.help}</Stat.HelpText>}
        </Stat.Root>
      ))}
    </Flex>
  );
}
