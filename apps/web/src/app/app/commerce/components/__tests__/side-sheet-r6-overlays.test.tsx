/**
 * P263 R6-11 (WEDGE review of R5): a dialog opened over a sheet is a layer too (components/ui/overlay-stack.ts). Escape
 * closes only the topmost layer: the one opened last, or one nested inside another. The dialogs that open over a
 * commerce SideSheet: components/ui/confirm-dialog.tsx (billing-form-modal, recurring-panel), finance's
 * confirm-dialog.tsx, and the expense page's bill-pay-dialog.tsx (beside its ExpenseFormSideSheet).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }), Toaster: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_r6",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_r6" }),
}));
vi.mock("@/lib/workspace", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), getStoredBusinessId: () => "biz_r6" }));

import { SideSheet } from "../side-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConfirmDialog as FinanceConfirmDialog } from "@/app/app/finance/components/confirm-dialog";
import { BillPayDialog } from "@/app/app/expenses/components/bill-pay-dialog";
import type { Expense } from "@/lib/client";

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", headers: new Headers({ "content-type": "application/json" }), json: async () => [], text: async () => "[]", clone() { return this; } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const esc = () => act(() => { fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" }); });

const BILL = {
  id: "exp_r6", description: "Phone bill", amount: 320, currency: "TTD", date: "2026-11-01T00:00:00.000Z", dueDate: "2026-11-30T00:00:00.000Z",
  vendor: "Digicel", paymentMethod: null, tags: [], isRecurring: false, status: "BILL", categoryId: null,
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
} as unknown as Expense;

/** A sheet, and a dialog that opens over it later (as the callers do: a sibling rendered after the sheet). */
function OverSheet({ dialog, onSheetClose }: { dialog: (open: boolean, close: () => void) => React.ReactNode; onSheetClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SideSheet open onClose={onSheetClose} title="Edit Recurring"><button onClick={() => setOpen(true)}>Ask</button></SideSheet>
      {dialog(open, () => setOpen(false))}
    </>
  );
}

describe("R6-11: Escape in a dialog opened over a sheet closes only the dialog", () => {
  it("components/ui ConfirmDialog", async () => {
    const sheet = vi.fn(), cancel = vi.fn();
    render(<OverSheet onSheetClose={sheet} dialog={(open, close) => <ConfirmDialog open={open} title="Stop schedule?" message="It will not run again." onConfirm={() => {}} onCancel={() => { cancel(); close(); }} />} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    esc();
    expect(cancel, "Escape did not close the dialog").toHaveBeenCalledTimes(1);
    expect(sheet, "Escape in the dialog closed the sheet under it").not.toHaveBeenCalled();
    await settle();
    esc();
    expect(sheet, "control: with the dialog gone, Escape closes the sheet").toHaveBeenCalledTimes(1);
  });
  it("finance ConfirmDialog", async () => {
    const sheet = vi.fn(), cancel = vi.fn();
    render(<OverSheet onSheetClose={sheet} dialog={(open, close) => <FinanceConfirmDialog open={open} title="Void payment?" description="This cannot be undone." onConfirm={() => {}} onCancel={() => { cancel(); close(); }} />} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    esc();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(sheet, "Escape in the dialog closed the sheet under it").not.toHaveBeenCalled();
  });
  it("BillPayDialog", async () => {
    const sheet = vi.fn(), closePay = vi.fn();
    render(<OverSheet onSheetClose={sheet} dialog={(open, close) => open && <BillPayDialog businessId="biz_r6" bill={BILL} onClose={() => { closePay(); close(); }} onPaid={() => {}} isCurrentBusiness={() => true} />} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    esc();
    expect(closePay, "Escape did not close Pay").toHaveBeenCalledTimes(1);
    expect(sheet, "Escape in Pay closed the sheet under it").not.toHaveBeenCalled();
  });
});

describe("R6-11: the topmost layer is the one opened last", () => {
  it("a sheet earlier in the document, opened after a later one, is the one Escape closes", async () => {
    const early = vi.fn(), late = vi.fn();
    function Two() {
      const [earlyOpen, setEarlyOpen] = useState(false);
      return (
        <>
          <SideSheet open={earlyOpen} onClose={early} title="Early in the document"><p>early</p></SideSheet>
          <SideSheet open onClose={late} title="Late in the document"><button onClick={() => setEarlyOpen(true)}>Open the other</button></SideSheet>
        </>
      );
    }
    render(<Two />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open the other" }));
    await settle();
    esc();
    expect(early, "the sheet opened last did not close").toHaveBeenCalledTimes(1);
    expect(late, "the sheet underneath closed").not.toHaveBeenCalled();
  });
});
