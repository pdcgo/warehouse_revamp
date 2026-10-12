import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  FileUpload,
  HStack,
  Icon,
  Portal,
  Progress,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { MarketplaceBadge } from "../../../components/badges/MarketplaceBadge";
import { ShopSelect } from "../../../components/pickers/ShopSelect";
import { useShopOptions } from "../../../features/shops/queries";
import { FileTally } from "../../../features/settlementImport/FileTally";
import { UploadedFileStatusBadge } from "../../../features/settlementImport/UploadedFileStatusBadge";
import {
  type ImportLogLine,
  MAX_FILE_BYTES,
  canImportFrom,
  useImportStream,
} from "../../../features/settlementImport/useImportStream";
import { LogLevel } from "../../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";

// A statement is the .xlsx the platform exports — both readers take nothing else.
const ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// How many of the WARN and ERROR lines the closing summary lists before sending the person to the
// file's own page for the rest.
const SUMMARY_LINES = 5;

const LEVEL_COLOR: Partial<Record<LogLevel, string>> = {
  [LogLevel.WARN]: "orange.fg",
  [LogLevel.ERROR]: "red.fg",
};

// ImportFileDialog — pick a shop, pick its statement, and watch it post.
// Design: docs/business/settlement/settlement_importer_decision.md.
//
// The rules it carries:
//  - the PLATFORM is the shop's marketplace, so the right import is called without asking — and a shop
//    on any other marketplace cannot import at all;
//  - once started, the dialog is a WINDOW onto the import: closing it drops the stream, never the import
//    (an-import-finishes-whether-anyone-watches), and there is no Cancel;
//  - the bar and the tallies are read from the stream's fields, and the end says what did NOT post.
export function ImportFileDialog({ teamId }: { teamId: bigint }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [shopId, setShopId] = useState(0n);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [showLog, setShowLog] = useState(false);

  const shops = useShopOptions({ teamId });
  const shop = useMemo(() => (shops.data ?? []).find((s) => s.id === shopId), [shops.data, shopId]);
  const importable = canImportFrom(shop?.marketplace);

  const { state, start, detach, reset } = useImportStream();
  const started = state.phase !== "idle";
  const running = state.phase === "running";

  function clear() {
    reset();
    setShopId(0n);
    setFile(null);
    setFileError("");
    setShowLog(false);
  }

  function setDialogOpen(next: boolean) {
    // Closing while it runs detaches — the import carries on, and the list shows where it got to.
    if (!next && running) detach();
    if (!next) clear();
    setOpen(next);
  }

  function pick(picked: File | undefined) {
    setFileError("");
    setFile(null);
    if (!picked) return;

    if (!picked.name.toLowerCase().endsWith(".xlsx")) {
      setFileError(t("settlementImports.dialog.notXlsx"));
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      setFileError(t("settlementImports.dialog.tooLarge"));
      return;
    }
    setFile(picked);
  }

  function rejectFile() {
    setFile(null);
    setFileError(t("settlementImports.dialog.notXlsx"));
  }

  function begin() {
    if (!shop || !file || !importable) return;
    void start({ teamId, shopId: shop.id, marketplace: shop.marketplace, file });
  }

  const problems = state.lines.filter((l) => l.level === LogLevel.WARN || l.level === LogLevel.ERROR);
  const lastError = [...state.lines].reverse().find((l) => l.level === LogLevel.ERROR);

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setDialogOpen(e.open)} size="lg">
      <Dialog.Trigger asChild>
        <Button size="xs" colorPalette="brand" data-testid="open-import-file">
          <Icon as={Upload} boxSize="4" />
          {t("settlementImports.importFile")}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="import-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("settlementImports.dialog.title")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              {!started ? (
                <Stack gap="card">
                  <Field.Root required>
                    <Field.Label>{t("settlementImports.dialog.shop")}</Field.Label>
                    <ShopSelect teamId={teamId} value={shopId} onChange={setShopId} />
                    {shop && (
                      <HStack gap="2" mt="1">
                        <MarketplaceBadge marketplace={shop.marketplace} size="sm" />
                        {!importable && (
                          <Text fontSize="sm" color="orange.fg" data-testid="import-unsupported">
                            {t("settlementImports.dialog.unsupported")}
                          </Text>
                        )}
                      </HStack>
                    )}
                  </Field.Root>

                  <Field.Root required invalid={fileError !== ""}>
                    <Field.Label>{t("settlementImports.dialog.file")}</Field.Label>
                    <FileUpload.Root
                      accept={ACCEPT}
                      maxFiles={1}
                      disabled={!importable}
                      onFileChange={(details) =>
                        // A file the `accept` list filtered out arrives as REJECTED, not as nothing — say why.
                        details.rejectedFiles.length > 0 && details.acceptedFiles.length === 0
                          ? rejectFile()
                          : pick(details.acceptedFiles[0])
                      }
                    >
                      <FileUpload.HiddenInput data-testid="import-file-input" />
                      <FileUpload.Trigger asChild>
                        <Button variant="outline" colorPalette="brand" data-testid="import-pick-file">
                          <Icon as={FileSpreadsheet} boxSize="4" />
                          {file ? t("settlementImports.dialog.replaceFile") : t("settlementImports.dialog.pickFile")}
                        </Button>
                      </FileUpload.Trigger>
                    </FileUpload.Root>
                    {file && (
                      <Text fontSize="sm" data-testid="import-file-name">
                        {file.name}
                      </Text>
                    )}
                    {fileError ? (
                      <Field.ErrorText data-testid="import-file-error">{fileError}</Field.ErrorText>
                    ) : (
                      <Field.HelperText>{t("settlementImports.dialog.fileHelp")}</Field.HelperText>
                    )}
                  </Field.Root>
                </Stack>
              ) : (
                <ImportProgress
                  step={state.step}
                  count={state.count}
                  running={running}
                  done={state.phase === "done"}
                  failed={state.phase === "failed"}
                  error={state.error || lastError?.message || ""}
                  lines={state.lines}
                  problems={problems}
                  showLog={showLog}
                  onToggleLog={() => setShowLog((v) => !v)}
                  file={state.file}
                />
              )}
            </Dialog.Body>

            <Dialog.Footer>
              {!started ? (
                <>
                  <Dialog.ActionTrigger asChild>
                    <Button variant="outline">{t("settlementImports.dialog.cancel")}</Button>
                  </Dialog.ActionTrigger>
                  <Button
                    colorPalette="brand"
                    disabled={!shop || !file || !importable}
                    data-testid="start-import"
                    onClick={begin}
                  >
                    {t("settlementImports.dialog.start")}
                  </Button>
                </>
              ) : (
                <>
                  {state.file && !running && (
                    <Button
                      variant="outline"
                      data-testid="open-imported-file"
                      onClick={() => navigate(`/settlement/imports/${state.file!.id}`)}
                    >
                      {t("settlementImports.dialog.openFile")}
                    </Button>
                  )}
                  <Dialog.ActionTrigger asChild>
                    <Button colorPalette={running ? undefined : "brand"} data-testid="import-close">
                      {running ? t("settlementImports.dialog.closeRunning") : t("settlementImports.dialog.close")}
                    </Button>
                  </Dialog.ActionTrigger>
                </>
              )}
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function ImportProgress({
  step,
  count,
  running,
  done,
  failed,
  error,
  lines,
  problems,
  showLog,
  onToggleLog,
  file,
}: {
  step: number;
  count: number;
  running: boolean;
  done: boolean;
  failed: boolean;
  error: string;
  lines: ImportLogLine[];
  problems: ImportLogLine[];
  showLog: boolean;
  onToggleLog: () => void;
  file: ReturnType<typeof useImportStream>["state"]["file"];
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="card" data-testid="import-progress">
      <Stack gap="1">
        <HStack justify="space-between">
          <Text fontSize="sm" data-testid="import-progress-text">
            {count > 0
              ? t("settlementImports.dialog.progress", { step, count })
              : t("settlementImports.dialog.reading")}
          </Text>
          {file && <UploadedFileStatusBadge status={file.status} />}
        </HStack>
        {/* No `count` yet means the file is still being read — the bar has no end to measure against. */}
        <Progress.Root value={count > 0 ? step : null} max={Math.max(count, 1)} colorPalette="brand">
          <Progress.Track>
            <Progress.Range />
          </Progress.Track>
        </Progress.Root>
      </Stack>

      {file && <FileTally tally={file.tally} />}

      {running && (
        <Text fontSize="sm" color="fg.muted" data-testid="import-keeps-going">
          {t("settlementImports.dialog.keepsGoing")}
        </Text>
      )}

      {failed && (
        <Box borderWidth="1px" borderColor="red.muted" rounded="md" p="3" data-testid="import-failed">
          <Text fontWeight="medium" color="red.fg">
            {t("settlementImports.dialog.failed")}
          </Text>
          <Text fontSize="sm" color="red.fg" data-testid="import-failed-reason">
            {error}
          </Text>
        </Box>
      )}

      {done && (
        <Stack gap="1" data-testid="import-summary">
          <Text fontWeight="medium">
            {problems.length === 0
              ? t("settlementImports.dialog.allPosted")
              : t("settlementImports.dialog.notPosted", { count: problems.length })}
          </Text>
          {problems.slice(0, SUMMARY_LINES).map((line, i) => (
            <Text key={i} fontSize="sm" color={LEVEL_COLOR[line.level]} data-testid="import-problem">
              {line.message}
            </Text>
          ))}
          {problems.length > SUMMARY_LINES && (
            <Text fontSize="sm" color="fg.muted">
              {t("settlementImports.dialog.moreOnPage", { count: problems.length - SUMMARY_LINES })}
            </Text>
          )}
        </Stack>
      )}

      <Box>
        <Button size="xs" variant="ghost" onClick={onToggleLog} data-testid="import-log-toggle">
          {showLog
            ? t("settlementImports.dialog.hideLog")
            : t("settlementImports.dialog.showLog", { count: lines.length })}
        </Button>
        {showLog && (
          <Stack
            gap="0"
            mt="2"
            maxH="48"
            overflowY="auto"
            fontFamily="mono"
            fontSize="xs"
            borderWidth="1px"
            rounded="md"
            p="2"
            data-testid="import-log"
          >
            {lines.map((line, i) => (
              <Text key={i} color={LEVEL_COLOR[line.level] ?? "fg.muted"}>
                {line.message}
              </Text>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
