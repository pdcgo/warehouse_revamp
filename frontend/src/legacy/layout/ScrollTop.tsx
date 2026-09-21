import { useEffect, useRef, useState, type RefObject } from "react";
import { Box, Icon } from "@chakra-ui/react";
import { ArrowUp } from "lucide-react";
import { Button } from "../components/inputs/Button";
import { Animate } from "../components/feedback/Animate";

// How far down before the button appears. Roughly "you have scrolled past the header" — below that
// the top is still on screen and a button to reach it is noise.
const SHOW_AFTER_PX = 100;

export const description =
  "A back-to-top button that appears once the CONTENT PANE has been scrolled. Listens to that pane, not the window — the shell scrolls its content, not the document.";

export interface ScrollTopProps {
  // The scrolling pane. This shell scrolls its content area, so the window's own scroll position
  // never changes and a window listener would never fire.
  scrollRef: RefObject<HTMLElement | null>;
}

export function ScrollTop({ scrollRef }: ScrollTopProps) {
  const [show, setShow] = useState(false);
  // Held in a ref so the scroll handler is not re-created — and re-attached — on every state change.
  const showing = useRef(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    function onScroll() {
      const next = (node!.scrollTop || 0) > SHOW_AFTER_PX;
      // Only re-render on a CROSSING, not on every scroll event. A list scrolled fast fires this
      // dozens of times a second, and setting the same boolean each time is dozens of wasted
      // renders of everything below.
      if (next !== showing.current) {
        showing.current = next;
        setShow(next);
      }
    }

    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  return (
    <Animate show={show}>
      <Box position="sticky" bottom="3" mx="auto" w="fit-content" zIndex="docked" data-testid="scroll-top">
        <Button
          tone="active"
          variant="subtle"
          borderRadius="full"
          boxShadow="sm"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <Icon as={ArrowUp} boxSize="4" />
          Back to top
        </Button>
      </Box>
    </Animate>
  );
}
