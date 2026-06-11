import { useRef, useCallback, useEffect, useLayoutEffect } from "react";

/**
 * Mobile chat scroll for Arc setup sheets.
 * Sticks to bottom unless the user has scrolled up.
 */
export function useArcChatScroll(triggerDeps) {
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const stickBottomRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = dist < 96;
  }, []);

  const scrollToEnd = useCallback((behavior = "auto", force = false) => {
    if (!force && !stickBottomRef.current) return;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    });
  }, []);

  useLayoutEffect(() => {
    stickBottomRef.current = true;
    scrollToEnd("auto", true);
  }, [scrollToEnd]);

  useEffect(() => {
    scrollToEnd("smooth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, triggerDeps);

  const onComposerFocus = useCallback(() => {
    stickBottomRef.current = true;
    setTimeout(() => scrollToEnd("smooth", true), 120);
  }, [scrollToEnd]);

  return { scrollRef, bottomRef, onScroll, onComposerFocus, scrollToEnd };
}
