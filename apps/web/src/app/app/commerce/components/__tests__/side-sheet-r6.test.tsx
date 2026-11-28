/**
 * P263 R6 (the local Chromium review of R5 at 691556f, D-331).
 *   R6-1  a sheet mounted open on a phone keeps its mount-time focus. useIsMobile() starts false, so every phone mount
 *         flips desktop -> phone right after it mounts; a child's autoFocus, or a child that focuses itself in a mount
 *         effect, had focus then, and the flip dropped it to <body> (what had focus was read from a focusin record
 *         that was not listening yet). What has focus is read when the shell is swapped, with the old shell in place.
 *   R6-2  focus outside the sheet when it flips, <body> included, is left alone: a field the user left (focus fell to
 *         <body> with no focusin, as a click on the overlay of a closeDisabled sheet does) is not focused again.
 *   R6-3  a change made by a child in the flip's own commit is not hidden: a focused field the child removes is told
 *         it lost focus; focus the child moves to another field stays there (that field hears its focus, the first
 *         one its blur). Focus is put back only when the swap left it on <body> or the panel.
 *   R6-4  closing with the opener gone leaves nothing of the exiting sheet focused.
 *   R6-5  an Escape a layer inside the sheet handled (defaultPrevented, as Radix does; ContactSelect closing its list)
 *         does not also close the sheet.
 * The blur Chromium fires on a removed focused node is reproduced as in side-sheet-p274.test.tsx (jsdom fires none).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  refreshWorkspace: async () => "biz_r6",
  getStoredBusinessId: () => "biz_r6",
  getCachedBusiness: () => ({ id: "biz_r6", currency: "TTD" }),
}));

import { SideSheet } from "../side-sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { ContactSelect } from "@/components/contacts/contact-select";

let phone = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();
beforeEach(() => {
  phone = false;
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() { return phone && /max-width/.test(query); },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = () => wait(30);
async function flip(toPhone: boolean) {
  phone = toPhone;
  act(() => { for (const fn of [...listeners]) fn({ matches: toPhone } as MediaQueryListEvent); });
  await settle();
}
const layout = () => (screen.getByRole("dialog").getAttribute("class") ?? "").includes("rounded-t-2xl") ? "phone" : "desktop";

/** Chromium's blur on a focused node that is removed or moved (jsdom fires none); see side-sheet-p274.test.tsx. */
function chromiumBlurOnRemove() {
  const proto = Node.prototype;
  const { appendChild, insertBefore, removeChild } = proto;
  const { remove } = Element.prototype;
  const blurIfInside = (n: Node) => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || !n.isConnected || !n.contains(a)) return;
    a.dispatchEvent(new FocusEvent("blur"));
    a.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  };
  proto.appendChild = function <T extends Node>(this: Node, n: T): T { blurIfInside(n); return appendChild.call(this, n) as T; };
  proto.insertBefore = function <T extends Node>(this: Node, n: T, ref: Node | null): T { blurIfInside(n); return insertBefore.call(this, n, ref) as T; };
  proto.removeChild = function <T extends Node>(this: Node, n: T): T { blurIfInside(n); return removeChild.call(this, n) as T; };
  Element.prototype.remove = function (this: Element) { blurIfInside(this); remove.call(this); };
  return () => { proto.appendChild = appendChild; proto.insertBefore = insertBefore; proto.removeChild = removeChild; Element.prototype.remove = remove; };
}
let restoreBlur: () => void = () => {};
beforeEach(() => { restoreBlur = chromiumBlurOnRemove(); });
afterEach(() => restoreBlur());

/** A native blur listener on the element (a widget that listens with addEventListener). */
function useNativeBlurs(ref: { current: HTMLElement | null }, onBlur: () => void) {
  useEffect(() => {
    const el = ref.current!;
    el.addEventListener("blur", onBlur);
    return () => el.removeEventListener("blur", onBlur);
  }, [ref, onBlur]);
}

describe("R6-1: a sheet mounted open on a phone keeps its mount-time focus", () => {
  beforeEach(() => { phone = true; });
  function Page({ open, children }: { open: boolean; children: React.ReactNode }) {
    return <>{open && <SideSheet open onClose={() => {}} title="Edit Expense">{children}</SideSheet>}</>;
  }
  it("a child's autoFocus: the field keeps focus through the mount flip to the bottom sheet", async () => {
    const view = render(<Page open={false}><input aria-label="First" autoFocus /></Page>);
    view.rerender(<Page open><input aria-label="First" autoFocus /></Page>);
    await settle();
    expect(layout(), "the sheet did not flip to the phone layout on mount").toBe("phone");
    expect(document.activeElement, "the mount flip dropped the autoFocus field's focus").toBe(screen.getByLabelText("First"));
  });
  it("a child that focuses itself in a mount effect keeps focus", async () => {
    function FocusesItself() {
      const ref = useRef<HTMLInputElement>(null);
      useEffect(() => { ref.current?.focus(); }, []);
      return <input ref={ref} aria-label="Amount" />;
    }
    const view = render(<Page open={false}><FocusesItself /></Page>);
    view.rerender(<Page open><FocusesItself /></Page>);
    await settle();
    expect(layout()).toBe("phone");
    expect(document.activeElement, "the mount flip dropped the field's focus").toBe(screen.getByLabelText("Amount"));
  });
  it("control: nothing focused at mount: the panel takes focus on a phone", async () => {
    const view = render(<Page open={false}><input aria-label="First" /></Page>);
    view.rerender(<Page open><input aria-label="First" /></Page>);
    await settle();
    expect(layout()).toBe("phone");
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
});

describe("R6-2: focus outside the sheet when it flips, <body> included, is left alone", () => {
  it("a field the user left to <body> (no focusin) is not focused again by a later flip", async () => {
    let focuses = 0;
    render(<SideSheet open onClose={() => {}} title="Edit Expense" closeDisabled><input aria-label="To" onFocus={() => { focuses++; }} /></SideSheet>);
    await settle();
    act(() => { screen.getByLabelText("To").focus(); });
    act(() => { (document.activeElement as HTMLElement).blur(); }); // as a click on the overlay does in Chromium
    expect(document.activeElement).toBe(document.body);
    const before = focuses;
    await flip(true);
    expect(document.activeElement, "the flip focused a field the user had left").toBe(document.body);
    expect(focuses - before, "the field heard a focus it was not given").toBe(0);
  });
});

describe("R6-3: a child's own change in the flip's commit is not hidden", () => {
  it("a focused field the child removes on the phone layout is told it lost focus", async () => {
    let blurs = 0;
    function DesktopOnly() {
      const isMobile = useIsMobile();
      const ref = useRef<HTMLInputElement>(null);
      const onBlur = useRef(() => { blurs++; }).current;
      return isMobile ? <p>phone</p> : <DesktopField fieldRef={ref} onBlur={onBlur} />;
    }
    function DesktopField({ fieldRef, onBlur }: { fieldRef: { current: HTMLInputElement | null }; onBlur: () => void }) {
      useNativeBlurs(fieldRef, onBlur);
      return <input ref={fieldRef} aria-label="Desktop field" />;
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><DesktopOnly /></SideSheet>);
    await settle();
    act(() => { screen.getByLabelText("Desktop field").focus(); });
    await flip(true);
    expect(screen.queryByLabelText("Desktop field")).toBeNull();
    expect(blurs, "the removed field's blur was swallowed and never told").toBe(1);
    expect(document.activeElement, "focus was left on <body>").toBe(screen.getByRole("dialog"));
  });
  it("focus a child moves to another field in the flip's commit stays there; each field hears its own event", async () => {
    const seen = { aBlurs: 0, aReactBlurs: 0, bFocuses: 0 };
    function MovesFocus() {
      const isMobile = useIsMobile();
      const a = useRef<HTMLInputElement>(null);
      const b = useRef<HTMLInputElement>(null);
      const onBlur = useRef(() => { seen.aBlurs++; }).current;
      useNativeBlurs(a, onBlur);
      useLayoutEffect(() => { if (isMobile) b.current?.focus(); }, [isMobile]);
      return (
        <>
          <input ref={a} aria-label="A" onBlur={() => { seen.aReactBlurs++; }} />
          <input ref={b} aria-label="B" onFocus={() => { seen.bFocuses++; }} />
        </>
      );
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><MovesFocus /></SideSheet>);
    await settle();
    act(() => { screen.getByLabelText("A").focus(); });
    await flip(true);
    expect(document.activeElement, "focus was pulled back from where the child moved it").toBe(screen.getByLabelText("B"));
    expect(seen.bFocuses, "B did not hear its focus").toBe(1);
    expect(seen.aBlurs, "A's blur was swallowed").toBe(1);
    expect(seen.aReactBlurs, "React did not hear A's blur").toBe(1);
  });
});

describe("R6-4: closing with the opener gone leaves nothing of the exiting sheet focused", () => {
  function Page({ open, withOpener }: { open: boolean; withOpener: boolean }) {
    return (
      <>
        {withOpener && <button>Opener</button>}
        <SideSheet open={open} onClose={() => {}} title="Edit Expense"><input aria-label="Field" /></SideSheet>
      </>
    );
  }
  it("the opener was removed while the sheet was open: on close, focus is not inside the exiting sheet", async () => {
    const view = render(<Page open={false} withOpener />);
    screen.getByRole("button", { name: "Opener" }).focus();
    view.rerender(<Page open withOpener />);
    await settle();
    act(() => { screen.getByLabelText("Field").focus(); });
    view.rerender(<Page open withOpener={false} />);
    view.rerender(<Page open={false} withOpener={false} />);
    const exiting = document.querySelector('[role="dialog"]');
    expect(exiting, "the sheet should still be animating out here").not.toBeNull();
    expect(exiting!.contains(document.activeElement), "focus stayed inside the exiting sheet").toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("control: the opener is there: focus returns to it", async () => {
    const view = render(<Page open={false} withOpener />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    view.rerender(<Page open withOpener />);
    await settle();
    act(() => { screen.getByLabelText("Field").focus(); });
    view.rerender(<Page open={false} withOpener />);
    expect(document.activeElement).toBe(opener);
  });
});

describe("R6-5: an Escape a layer inside the sheet handled does not close the sheet", () => {
  it("a child's keydown that prevents Escape's default (as Radix's layers do) leaves the sheet open", async () => {
    const onClose = vi.fn();
    render(
      <SideSheet open onClose={onClose} title="Edit Expense">
        <input aria-label="Combo" onKeyDown={(e) => { if (e.key === "Escape") e.preventDefault(); }} />
        <input aria-label="Plain" />
      </SideSheet>,
    );
    await settle();
    fireEvent.keyDown(screen.getByLabelText("Combo"), { key: "Escape" });
    expect(onClose, "the sheet closed on an Escape a layer inside it had handled").not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Plain"), { key: "Escape" });
    expect(onClose, "control: an Escape nothing handled closes the sheet").toHaveBeenCalledTimes(1);
  });
  it("ContactSelect's open list: the first Escape closes the list only; the next closes the sheet", async () => {
    const onClose = vi.fn();
    render(
      <SideSheet open onClose={onClose} title="New Schedule">
        <ContactSelect value="" onChange={() => {}} contacts={[{ id: "c1", firstName: "Ana", lastName: "Lee", email: "ana@example.test" }]} />
      </SideSheet>,
    );
    await settle();
    const box = screen.getByRole("combobox");
    act(() => { box.focus(); });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    await settle();
    expect(box.getAttribute("aria-expanded"), "the list did not open").toBe("true");
    fireEvent.keyDown(box, { key: "Escape" });
    await settle();
    expect(box.getAttribute("aria-expanded"), "the list did not close").toBe("false");
    expect(onClose, "the Escape that closed the list closed the sheet too").not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
