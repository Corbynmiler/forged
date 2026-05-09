import { useLayoutEffect, useRef } from "react";

const lockIds = new Set();
let savedScrollY = 0;

function applyBodyLock() {
  if (typeof document === "undefined") return;
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  const html = document.documentElement;
  const body = document.body;
  body.dataset.forgedScrollLockPrevHtmlOverflow = html.style.overflow;
  body.dataset.forgedScrollLockPrevBodyOverflow = body.style.overflow;
  body.dataset.forgedScrollLockPrevTouchAction = body.style.touchAction;
  body.dataset.forgedScrollLockPrevPosition = body.style.position;
  body.dataset.forgedScrollLockPrevTop = body.style.top;
  body.dataset.forgedScrollLockPrevLeft = body.style.left;
  body.dataset.forgedScrollLockPrevRight = body.style.right;
  body.dataset.forgedScrollLockPrevWidth = body.style.width;

  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.touchAction = "none";
  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

function releaseBodyLock() {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const body = document.body;
  const y = savedScrollY;

  html.style.overflow = body.dataset.forgedScrollLockPrevHtmlOverflow || "";
  body.style.overflow = body.dataset.forgedScrollLockPrevBodyOverflow || "";
  body.style.touchAction = body.dataset.forgedScrollLockPrevTouchAction || "";
  body.style.position = body.dataset.forgedScrollLockPrevPosition || "";
  body.style.top = body.dataset.forgedScrollLockPrevTop || "";
  body.style.left = body.dataset.forgedScrollLockPrevLeft || "";
  body.style.right = body.dataset.forgedScrollLockPrevRight || "";
  body.style.width = body.dataset.forgedScrollLockPrevWidth || "";

  delete body.dataset.forgedScrollLockPrevHtmlOverflow;
  delete body.dataset.forgedScrollLockPrevBodyOverflow;
  delete body.dataset.forgedScrollLockPrevTouchAction;
  delete body.dataset.forgedScrollLockPrevPosition;
  delete body.dataset.forgedScrollLockPrevTop;
  delete body.dataset.forgedScrollLockPrevLeft;
  delete body.dataset.forgedScrollLockPrevRight;
  delete body.dataset.forgedScrollLockPrevWidth;

  window.scrollTo(0, y);
}

function syncLocks() {
  if (typeof document === "undefined") return;
  if (lockIds.size > 0) {
    if (!document.body.dataset.forgedScrollLockActive) {
      document.body.dataset.forgedScrollLockActive = "1";
      applyBodyLock();
    }
  } else if (document.body.dataset.forgedScrollLockActive) {
    delete document.body.dataset.forgedScrollLockActive;
    releaseBodyLock();
  }
}

/**
 * Locks document/body scroll while `locked` is true. Safe when nested (multiple overlays).
 */
export function useScrollLock(locked) {
  const idRef = useRef(null);
  if (idRef.current == null) idRef.current = `forged-scroll-lock-${Math.random().toString(36).slice(2)}`;

  useLayoutEffect(() => {
    if (!locked) return;
    const id = idRef.current;
    lockIds.add(id);
    syncLocks();
    return () => {
      lockIds.delete(id);
      syncLocks();
    };
  }, [locked]);
}
