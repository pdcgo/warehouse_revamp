import type { ElementType } from "react";
import { Breadcrumb as ChakraBreadcrumb, Icon } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";

export interface BreadcrumbItem {
  // Omit to render as plain text. The LAST item normally has no href — you are already there, and a
  // link to the current page is a link that does nothing.
  href?: string;
  // A lucide component, shown before the name. Usually only on the first (root) item.
  icon?: ElementType;
  name?: string;
}

// Breadcrumb says where you are in a hierarchy, and gives one click back to each level above.
//
// It matters more here than in a content site because the screens nest three and four deep — a team,
// then a warehouse, then a rack, then one product's stock in it — and the browser back button is a
// poor substitute: it retraces the path you TOOK, which after a few filters and a detail panel is
// not the path you are IN.
//
// Links route through react-router, not bare anchors, so going up a level does not reload the app
// and lose every cached query on the way.
export const description =
  "Where you are in a nested hierarchy, with one click back to each level above. Routes through react-router, so going up does not reload the app.";

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <ChakraBreadcrumb.Root size="sm" data-testid="breadcrumb">
      <ChakraBreadcrumb.List>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const content = (
            <>
              {item.icon && <Icon as={item.icon} boxSize="3.5" />}
              {item.name}
            </>
          );

          return (
            <ChakraBreadcrumb.Item key={i}>
              {/* The current page is CurrentLink, not Link: it carries aria-current, so a screen
                  reader announces which crumb you are on rather than reading a list of peers. */}
              {isLast || !item.href ? (
                <ChakraBreadcrumb.CurrentLink data-testid={`crumb-${i}`}>
                  {content}
                </ChakraBreadcrumb.CurrentLink>
              ) : (
                <>
                  <ChakraBreadcrumb.Link asChild data-testid={`crumb-${i}`}>
                    <RouterLink to={item.href}>{content}</RouterLink>
                  </ChakraBreadcrumb.Link>
                  <ChakraBreadcrumb.Separator />
                </>
              )}
            </ChakraBreadcrumb.Item>
          );
        })}
      </ChakraBreadcrumb.List>
    </ChakraBreadcrumb.Root>
  );
}
