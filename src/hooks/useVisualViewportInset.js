import { useState, useEffect } from "react";

/** Pixels the visual keyboard (or browser chrome) lifts the bottom edge. */
export function useVisualViewportInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport;
      if (!vv) {
        setInset(0);
        return;
      }
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    update();
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
