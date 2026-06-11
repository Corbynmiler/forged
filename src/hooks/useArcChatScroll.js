import { useRef, useCallback, useEffect, useLayoutEffect } from "react";

/**
 * Mobile chat scroll for Arc setup sheets.
 * Sticks to bottom unless the user has scrolled up; restores composer on keyboard open.
 */
export function useArcChatScroll(triggerDeps, { inputDockId } = {}) {
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

  useEffect(() => {
    if (!inputDockId) return;
    const onVv = () => {
      const vv = window.visualViewport;
      const dock = document.getElementById(inputDockId);
      if (!vv || !dock) return;
      const pad = Math.max(10, window.innerHeight - vv.height - vv.offsetTop + 10);
      dock.style.paddingBottom = `max(${pad}px, env(safe-area-inset-bottom, 10px))`;
      if (stickBottomRef.current) scrollToEnd("auto", true);
    };
    window.visualViewport?.addEventListener("resize", onVv);
    window.visualViewport?.addEventListener("scroll", onVv);
    onVv();
    return () => {
      window.visualViewport?.removeEventListener("resize", onVv);
      window.visualViewport?.removeEventListener("scroll", onVv);
    };
  }, [inputDockId, scrollToEnd]);

  const onComposerFocus = useCallback(() => {
    stickBottomRef.current = true;
    setTimeout(() => scrollToEnd("smooth", true), 120);
  }, [scrollToEnd]);

  return { scrollRef, bottomRef, onScroll, onComposerFocus };
}
