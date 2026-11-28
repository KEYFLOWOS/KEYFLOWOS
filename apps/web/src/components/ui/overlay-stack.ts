"use client";

import { useEffect } from "react";

/**
 * P263 R6-11: the overlay layers that are open: the commerce SideSheet and QuickSheet, and the dialogs that open over
 * them (components/ui ConfirmDialog, finance's ConfirmDialog, the expense page's BillPayDialog). Escape belongs to the
 * topmost layer only: a layer nested inside another is above it; otherwise the one opened last is. (Other overlays
 * with an Escape or a dialog role are a board row of their own.)
 */
const layers = new Map<HTMLElement, number>();
let openedCount = 0;

/** Whether `el` is an open layer with no open layer above it. */
export function isTopmostLayer(el: HTMLElement | null): boolean {
  const mine = el ? layers.get(el) : undefined;
  if (!el || mine === undefined) return false;
  for (const [other, opened] of layers) {
    if (other === el || other.contains(el)) continue; // el is nested in other: el is above it
    if (el.contains(other) || opened > mine) return false;
  }
  return true;
}

/** Registers the element in `ref` as an open layer while `open`. */
export function useOverlayLayer(open: boolean, ref: { current: HTMLElement | null }): void {
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    layers.set(el, ++openedCount);
    return () => { layers.delete(el); };
  }, [open, ref]);
}

/**
 * A layer that closes on Escape: registered while `open`, and `close` runs on an Escape that no layer inside it already
 * handled (it prevented the default, as Radix's layers and ContactSelect's list do) when it is the topmost layer.
 */
export function useTopmostEscape(open: boolean, ref: { current: HTMLElement | null }, close: () => void): void {
  useOverlayLayer(open, ref);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && isTopmostLayer(ref.current)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, ref, close]);
}
