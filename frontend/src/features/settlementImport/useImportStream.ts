import { useCallback, useEffect, useRef, useState } from "react";
import { rpcError, settlementImporterClient } from "../../api/clients";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import {
  LogLevel,
  type UploadedFile,
  UploadedFileStatus,
} from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { useInvalidateUploadedFiles } from "./queries";

// The two platforms a statement can come from. The shop's marketplace picks the RPC — a person never
// chooses the platform, so a TikTok file cannot be sent down the Shopee import by a wrong click.
export const IMPORTABLE_MARKETPLACES: readonly Marketplace[] = [Marketplace.SHOPEE, Marketplace.TIKTOK];

export function canImportFrom(marketplace: Marketplace | undefined): boolean {
  return marketplace !== undefined && IMPORTABLE_MARKETPLACES.includes(marketplace);
}

// The server's ceiling (the request's `max_len`), checked here too so an oversized file is refused
// before it is sent rather than after.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ImportLogLine {
  level: LogLevel;
  message: string;
}

// idle → running → done | failed. `detached` is a closed dialog: the stream is dropped, the import is
// not (an-import-finishes-whether-anyone-watches), and the list shows where it got to.
export type ImportPhase = "idle" | "running" | "done" | "failed" | "detached";

export interface ImportState {
  phase: ImportPhase;
  lines: ImportLogLine[];
  step: number;
  count: number;
  // The file's own row, once it is stored — it carries the tallies and the link to the file's page.
  file: UploadedFile | null;
  // A transport or validation failure — the stream never started, or broke.
  error: string;
}

const IDLE: ImportState = { phase: "idle", lines: [], step: 0, count: 0, file: null, error: "" };

// useImportStream runs ONE import and folds its stream into screen state.
//
// Every message is a leveled log line; `step`, `count` and `file` ride along as they become known, so
// the bar, the tallies and the closing summary are read from fields — never parsed out of the text.
export function useImportStream() {
  const [state, setState] = useState<ImportState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  const invalidate = useInvalidateUploadedFiles();

  // Unmounting drops the watcher, never the import.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (args: { teamId: bigint; shopId: bigint; marketplace: Marketplace; file: File }) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setState({ ...IDLE, phase: "running" });

      let fileContent: Uint8Array;
      try {
        fileContent = new Uint8Array(await args.file.arrayBuffer());
      } catch (err) {
        setState({ ...IDLE, phase: "failed", error: rpcError(err) });
        return;
      }

      const request = { teamId: args.teamId, shopId: args.shopId, fileContent };
      const stream =
        args.marketplace === Marketplace.TIKTOK
          ? settlementImporterClient.tiktokSettlementImport(request, { signal: abort.signal })
          : settlementImporterClient.shopeeSettlementImport(request, { signal: abort.signal });

      let lastLevel = LogLevel.UNSPECIFIED;
      let lastFile: UploadedFile | null = null;

      try {
        for await (const msg of stream) {
          lastLevel = msg.level;
          if (msg.file) lastFile = msg.file;

          setState((s) => ({
            ...s,
            lines: [...s.lines, { level: msg.level, message: msg.message }],
            step: msg.step || s.step,
            count: msg.count || s.count,
            file: msg.file ?? s.file,
          }));
        }

        // The stream closing is the import finishing — for this watcher. A file refused as a whole ends on
        // an ERROR line: after it was stored its row reads FAILED, and before (the shop check) there is no
        // row at all.
        const failed =
          lastFile?.status === UploadedFileStatus.FAILED || (lastFile === null && lastLevel === LogLevel.ERROR);
        setState((s) => ({ ...s, phase: failed ? "failed" : "done" }));
      } catch (err) {
        // Closing the dialog aborts the STREAM. The import carries on server-side, so this is not a failure.
        if (abort.signal.aborted) return;
        setState((s) => ({ ...s, phase: "failed", error: rpcError(err) }));
      } finally {
        void invalidate();
      }
    },
    [invalidate],
  );

  // The person closed the dialog mid-import. Only the window closes.
  const detach = useCallback(() => {
    if (abortRef.current && !abortRef.current.signal.aborted) {
      abortRef.current.abort();
    }
    setState((s) => (s.phase === "running" ? { ...s, phase: "detached" } : s));
    void invalidate();
  }, [invalidate]);

  const reset = useCallback(() => setState(IDLE), []);

  return { state, start, detach, reset };
}
