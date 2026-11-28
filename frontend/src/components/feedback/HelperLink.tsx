import { Icon, Link } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface HelperLinkProps {
  /** The page where the missing thing is made — an app path (`/inventories/racks`). */
  href: string;
  /** What the link says — the page or the act it leads to. */
  label: string;
  testId: string;
}

export const description =
  "The link a helper gives when a picker has nothing to offer: the page where the missing thing is made, opened in a NEW TAB (target=_blank, rel=noopener noreferrer) so the form it sits in keeps everything typed (a-helper-link-opens-a-new-tab). Its label, an external-link icon, and \"opens in a new tab\" in its name.";

// HelperLink — WHERE TO GO AND MAKE WHAT IS MISSING, without leaving the form (a-helper-link-opens-a-new-tab).
//
// A NEW TAB, ALWAYS: the restock form's lines and the accept page's counts are typed state, and a same-tab link would
// throw them away. The picker beside the link reads its list again when the person comes back (api/rereadOnReturn.ts),
// so what was made over there can be picked here at once.
//
// A plain `href`, not the router's Link: a new tab is a page load of its own, and a plain anchor needs no router around
// it (a component story, a dialog). `noopener noreferrer` — the opened page gets no handle on this one.
export function HelperLink({ href, label, testId }: HelperLinkProps) {
  const { t } = useTranslation();

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      colorPalette="brand"
      fontSize="sm"
      fontWeight="bold"
      aria-label={`${label}, ${t("common.opensInNewTab")}`}
      data-testid={testId}
    >
      {label}
      <Icon as={ExternalLink} boxSize="3.5" flexShrink={0} />
    </Link>
  );
}
