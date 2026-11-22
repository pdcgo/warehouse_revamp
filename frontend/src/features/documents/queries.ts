import { useQuery } from "@tanstack/react-query";
import { documentClient } from "../../api/clients";
import { key } from "../../api/queryClient";

/** A link is treated as gone this long BEFORE it expires — what is drawn must still open when it is clicked. */
const LINK_MARGIN_MS = 60_000;

/** A document's download link, and when it stops working (`expiresAt`, ms; `null` = the answer named no end). */
export interface DocumentLink {
  url: string;
  expiresAt: number | null;
}

/** How much longer a link may be reused: the rest of its life less the margin — 0 when its answer named no end. */
export function linkLife(link: DocumentLink | undefined, now: number): number {
  if (!link || link.expiresAt === null) return 0;

  return Math.max(0, link.expiresAt - LINK_MARGIN_MS - now);
}

// THE DOWNLOAD LINK FOR A DOCUMENT ON SCREEN — read when it is SHOWN (the receipt just attached to the order form), not
// one fetched on a click: those stay calls (features/orders/labels.ts, features/restock/ReceiptPhoto.tsx), since a link
// minted on render would expire on an open page.
//
// ⚠ NEVER CACHED PAST THE LINK'S LIFE. GetDownloadUrl signs a private file for a short while (document_service's
// URLTTL) and says until when (`expires_at_unix`): the answer is reused for that life less a margin (a remount, the
// same file shown again), never after it — `staleTime` is the life that is left, and a cached link already past it is
// not handed out while the fresh one is asked. An answer naming no end (a public file) is not reused at all: the plain
// always-fresh default. No retry: a preview that cannot load is not a failed attachment, and the card falls back to the
// file's name.
export function useDocumentLink(args: { teamId: bigint; documentId: string }) {
  const { teamId, documentId } = args;
  const query = useQuery({
    queryKey: key.documents(teamId, { link: documentId }),
    enabled: documentId !== "" && teamId > 0n,
    retry: false,
    staleTime: (q) => linkLife(q.state.data, Date.now()),
    queryFn: async (): Promise<DocumentLink> => {
      const res = await documentClient.getDownloadUrl({ teamId, documentId });

      return { url: res.url, expiresAt: res.expiresAtUnix > 0n ? Number(res.expiresAtUnix) * 1000 : null };
    },
  });

  const link = query.data;
  // A link past its life is never drawn, even for the beat before the fresh one lands.
  const usable = link !== undefined && (link.expiresAt === null || link.expiresAt - LINK_MARGIN_MS > Date.now());

  return { url: usable ? link.url : "", loading: query.isFetching, query };
}
