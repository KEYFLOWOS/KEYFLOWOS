/**
 * P237 FU-OPS-STATUS-SAVE-RACE (launch-track, D-315). Operations' store status toggle called
 * onConfigChange("storeSettings", { storeStatus }) and then onSaveConfig() in the same tick, and the hook's
 * handleSaveConfig sent the storefrontConfig of its own render: the status just chosen was not in what was saved, so
 * the saved storefront kept the old status. A status change now saves the config with the new status.
 * Real hook (useStoreData) and real OperationsMode, wired as the Store page wires them; only lib/client's reads and
 * writes, lib/api, the workspace and toasts are stubbed (the harness is use-store-data-r7.test.tsx's).
 *
 * R1 (first review, 2 MINOR test gaps): R1-1 a change-and-save made for A after the page has switched to B sends
 * nothing (saveConfig's tenancy guard); R1-2 withConfigChange's three rules, pinned directly: "__root" merges at the
 * top, an array section (sections, faqEntries) is replaced, any other section is merged.
 *
 * R2 (D-331): R2-2 that late call also leaves B's own storefront config as it was (A's change is not applied to B's
 * local state); P280 the status toggle is disabled while a save is in flight, and a second press sends nothing.
 *
 * R3 (both reviews of R2, D-331): a store status press is one unit, handleStoreStatusChange: the config save and, when
 * the store's enabled state must follow, the store-enabled write. Nothing is shown before both succeed; a failure of
 * either (an error reply or a rejected request) shows the error, restores what was saved and leaves the screen as it
 * was; the busy state always ends (R3-1, R3-2, R3-6). One flight, even for two presses before a render (R3-3). Every
 * status control (the toggle, the Active / Paused / Coming Soon choices, the Go Live suggestion) is disabled and
 * aria-busy while a status save runs, and the toggle says "Saving..." (R3-4, R3-5, R3-10). A press before the
 * storefront read lands writes and shows nothing (R3-8); saveConfig's own tenancy guard is pinned (R3-9). The
 * console is no longer silenced here (R3-11).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";

const A = "biz_A";
type Res<T> = { data: T | null; error: string | null };
const ok = <T,>(data: T): Res<T> => ({ data, error: null });
const failed = <T,>(): Res<T> => ({ data: null, error: "Internal server error" });

const ws = vi.hoisted(() => ({ businessId: "biz_A" }));
const client = vi.hoisted(() => ({
  getBusinessById: vi.fn(),
  updateBusiness: vi.fn(),
  fetchStorefrontConfig: vi.fn(),
  updateStorefrontConfig: vi.fn(),
  fetchServices: vi.fn(),
  fetchStaff: vi.fn(),
  fetchAllProducts: vi.fn(),
  fetchStoreGraph: vi.fn(),
  fetchStoreReadiness: vi.fn(),
  fetchStoreAnalytics: vi.fn(),
  backfillStoreLinks: vi.fn(),
}));
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/client")>()), ...client }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), apiGet: api.apiGet }));
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  refreshWorkspace: vi.fn(() => Promise.resolve(ws.businessId)),
  getStoredBusinessId: vi.fn(() => ws.businessId),
}));
vi.mock("@/hooks/use-app-layout", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/hooks/use-app-layout")>()), useMemberModuleLevels: () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// Panels of the Operations tab that read on their own; not what this pins.
vi.mock("../delivery-config-panel", () => ({ DeliveryConfigPanel: () => null }));
vi.mock("../shipping-zones-panel", () => ({ ShippingZonesPanel: () => null }));
vi.mock("../qualification-config", () => ({ QualificationConfig: () => null }));
vi.mock("../hours-editor", async (importOriginal) => ({ ...(await importOriginal<typeof import("../hours-editor")>()), HoursEditor: () => null }));

import { useStoreData, withConfigChange } from "../../hooks/use-store-data";
import type { StorefrontConfig } from "@/lib/client";
import { OperationsMode } from "../operations-mode";

/** The Operations tab as the Store page renders it (store/page.tsx). */
function Operations() {
  const s = useStoreData();
  if (s.loading || !s.businessId) return <p>loading</p>;
  return (
    <OperationsMode
      businessId={s.businessId}
      storeEnabled={s.storeEnabled}
      businessHours={s.businessHours}
      storefrontConfig={s.storefrontConfig}
      onConfigChange={s.handleConfigChange}
      onSaveConfig={s.handleSaveConfig}
      onStoreStatusChange={s.handleStoreStatusChange}
      statusSaving={s.statusSaving}
      configSaving={s.configSaving}
      onHoursChange={s.setBusinessHours}
      onSaveHours={s.handleSaveHours}
      hoursSaving={s.hoursSaving}
      commerceProducts={s.commerceProducts}
    />
  );
}

let storeEnabled = true;
beforeEach(() => {
  ws.businessId = A;
  storeEnabled = true;
  window.localStorage.clear();
  client.getBusinessById.mockImplementation(async () => ok({ id: A, name: "Shop A", slug: "shop-a", businessHours: null, storeEnabled }));
  client.updateBusiness.mockImplementation(async (b: { storeEnabled?: boolean }) => ok({ id: A, storeEnabled: b.storeEnabled }));
  client.fetchStorefrontConfig.mockImplementation(async () =>
    ok({ hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {}, storeSettings: { storeStatus: "active", deliveryOptions: ["pickup"] } }));
  client.updateStorefrontConfig.mockImplementation(async (_b: string, cfg: unknown) => ok(cfg));
  client.fetchServices.mockImplementation(async () => ok([]));
  client.fetchStaff.mockImplementation(async () => ok([]));
  client.fetchAllProducts.mockImplementation(async () => ok([]));
  client.fetchStoreGraph.mockImplementation(async () => ok({ mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 0 }));
  client.fetchStoreReadiness.mockImplementation(async () => failed());
  client.fetchStoreAnalytics.mockImplementation(async () => failed());
  client.backfillStoreLinks.mockImplementation(async () => {});
  api.apiGet.mockImplementation(async () => ({ data: null, error: null }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const savedStatus = () => {
  const calls = client.updateStorefrontConfig.mock.calls;
  return (calls.at(-1)?.[1] as { storeSettings?: { storeStatus?: string } } | undefined)?.storeSettings?.storeStatus;
};

describe("P237: a store status change saves the status just chosen", () => {
  it("Active -> Pause: the storefront config sent has storeStatus 'paused'", async () => {
    render(<Operations />);
    const pause = await screen.findByRole("button", { name: "Pause" });
    await act(async () => { fireEvent.click(pause); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    expect(client.updateStorefrontConfig.mock.calls.at(-1)?.[0]).toBe(A);
    expect(savedStatus(), "the save sent the status from before the change").toBe("paused");
  });
  it("the rest of the store settings are kept in what is saved (the new status is merged, not a reset)", async () => {
    render(<Operations />);
    const toggle = await screen.findByRole("button", { name: "Pause" }); // found outside act: act holds renders until it ends
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    const sent = client.updateStorefrontConfig.mock.calls.at(-1)?.[1] as { storeSettings?: Record<string, unknown> };
    expect(sent.storeSettings).toEqual({ storeStatus: "paused", deliveryOptions: ["pickup"] });
  });
  it("Paused -> Go Live: the config sent has storeStatus 'active', and the page then says Active", async () => {
    storeEnabled = false;
    client.fetchStorefrontConfig.mockImplementation(async () =>
      ok({ hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {}, storeSettings: { storeStatus: "paused" } }));
    render(<Operations />);
    // two "Go Live" when paused (the status card's and the suggestion's); both call handleStatusChange("active")
    const [toggle] = await screen.findAllByRole("button", { name: "Go Live" }); // found outside act: act holds renders
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    expect(savedStatus()).toBe("active");
    expect(await screen.findByText(/Store Status: Active/)).toBeTruthy();
  });
  it("control: one save per change (the status is not saved twice)", async () => {
    render(<Operations />);
    const toggle = await screen.findByRole("button", { name: "Pause" }); // found outside act: act holds renders until it ends
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1);
  });
});

describe("P237 R1-1: a change-and-save made for A after a switch to B sends nothing", () => {
  it("the handler captured while A was shown, called once B is shown: no storefront config is written", async () => {
    const hook = renderHook(() => useStoreData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.businessId).toBe(A);
    const captured = hook.result.current.handleStoreStatusChange; // A's handler
    act(() => {
      ws.businessId = "biz_B";
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } }));
    });
    await waitFor(() => expect(hook.result.current.businessId).toBe("biz_B"));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    client.updateStorefrontConfig.mockClear();
    const bBefore = JSON.stringify(hook.result.current.storefrontConfig);
    await act(async () => { await captured("paused"); });
    expect(client.updateStorefrontConfig, "A's change was written after the page switched to B").not.toHaveBeenCalled();
    expect(client.updateBusiness, "A's store-enabled change was written after the switch").not.toHaveBeenCalled();
    // R2-2: and B's own config, as shown, is not changed by A's late call
    expect(JSON.stringify(hook.result.current.storefrontConfig), "A's change was applied to B's storefront config").toBe(bBefore);
  });
});

describe("P237 R1-2: withConfigChange", () => {
  const base = {
    hero: { headline: "Hi", imageUrl: "x" },
    sections: [{ id: "s1" }, { id: "s2" }],
    faqEntries: [{ q: "old", a: "old" }],
    storeSettings: { storeStatus: "active", deliveryOptions: ["pickup"] },
  } as unknown as StorefrontConfig;
  it('"__root" merges the updates at the top level', () => {
    const next = withConfigChange(base, "__root", { seo: { title: "T" } }) as unknown as Record<string, unknown>;
    expect(next.seo).toEqual({ title: "T" });
    expect(next.hero).toEqual({ headline: "Hi", imageUrl: "x" });
  });
  for (const key of ["sections", "faqEntries"]) {
    it(`an array section (${key}) is replaced by the updates, not merged`, () => {
      const replacement = [{ id: "only" }] as unknown as Record<string, unknown>;
      const next = withConfigChange(base, key, replacement) as unknown as Record<string, unknown>;
      expect(next[key]).toEqual([{ id: "only" }]);
      expect(Array.isArray(next[key]), `${key} became an object`).toBe(true);
    });
  }
  it("any other section is merged: its other keys are kept", () => {
    const next = withConfigChange(base, "storeSettings", { storeStatus: "paused" }) as unknown as Record<string, unknown>;
    expect(next.storeSettings).toEqual({ storeStatus: "paused", deliveryOptions: ["pickup"] });
    expect(next.hero, "another section changed").toEqual({ headline: "Hi", imageUrl: "x" });
  });
  it("a section that did not exist is created", () => {
    const next = withConfigChange(base, "promotions", { banner: "Sale" }) as unknown as Record<string, unknown>;
    expect(next.promotions).toEqual({ banner: "Sale" });
  });
  it("the config passed in is not changed (a new object is returned)", () => {
    const before = JSON.stringify(base);
    withConfigChange(base, "storeSettings", { storeStatus: "paused" });
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("P237 R2 (P280): the status toggle waits for the save in flight", () => {
  it("while a save is in flight the toggle is disabled, and pressing it again sends no second save", async () => {
    let release!: (v: unknown) => void;
    client.updateStorefrontConfig.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<Operations />);
    const pause = await screen.findByRole("button", { name: "Pause" });
    await act(async () => { fireEvent.click(pause); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1));
    const toggle = screen.getByRole("button", { name: /Saving/ });
    expect(toggle, "the toggle can be pressed while its save is in flight").toBeDisabled();
    expect(toggle.getAttribute("aria-busy"), "the toggle does not say it is busy").toBe("true");
    await act(async () => { fireEvent.click(toggle); });
    expect(client.updateStorefrontConfig, "a second status save was sent while the first was in flight").toHaveBeenCalledTimes(1);
    await act(async () => { release(ok({})); });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^(Pause|Go Live)$/ })[0]).toBeEnabled());
    expect(screen.queryByRole("button", { name: /Saving/ }), "the toggle still says Saving after the save").toBeNull();
  });
  it("the Go Live suggestion, pressed while the status save is in flight, sends no second save (the handler refuses)", async () => {
    storeEnabled = false;
    client.fetchStorefrontConfig.mockImplementation(async () =>
      ok({ hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {}, storeSettings: { storeStatus: "paused" } }));
    // the config save held: the store stays offline, so the "Go Live" suggestion stays on screen
    let releaseConfig!: (v: unknown) => void;
    client.updateStorefrontConfig.mockImplementation((_b: string, cfg: unknown) => new Promise((r) => { releaseConfig = () => r(ok(cfg)); }));
    render(<Operations />);
    const [statusCard] = await screen.findAllByRole("button", { name: "Go Live" });
    await act(async () => { fireEvent.click(statusCard); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1));
    const suggestion = screen.getAllByRole("button", { name: "Go Live" }).find((b) => b !== statusCard);
    expect(suggestion, "the Go Live suggestion is not on screen").toBeTruthy();
    // R3-10: the suggestion is disabled and busy while the status save runs
    expect(suggestion, "the Go Live suggestion can be pressed mid-save").toBeDisabled();
    expect(suggestion!.getAttribute("aria-busy")).toBe("true");
    await act(async () => { fireEvent.click(suggestion!); });
    expect(client.updateStorefrontConfig, "the suggestion sent a second status save mid-flight").toHaveBeenCalledTimes(1);
    // R3-7: and no second store-enabled write either (the guard comes before every write): once the held config save
    // answers, the press's one store-enabled write follows, and only that one
    await act(async () => { releaseConfig(undefined); });
    await waitFor(() => expect(client.updateBusiness).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(client.updateBusiness, "the suggestion sent a second store-enabled write mid-flight").toHaveBeenCalledTimes(1);
    expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1);
  });
});

/** The store status card's toggle (Pause or Go Live), once the page has loaded. */
const statusToggle = async () => (await screen.findAllByRole("button", { name: /^(Pause|Go Live)$/ }))[0];
const statusShown = () => screen.getByText(/^Store Status: /).textContent;

describe("P237 R3-1 / R3-2 / R3-6: a status press is one unit, and a failure leaves things as they were", () => {
  for (const [how, fail] of [
    ["an error reply", () => client.updateStorefrontConfig.mockResolvedValue({ data: null, error: "Internal server error" })],
    ["a rejected request (network drop)", () => client.updateStorefrontConfig.mockRejectedValue(new Error("network down"))],
  ] as const) {
    it(`the config save fails with ${how}: the error is said, the status shown and the store's enabled state are unchanged, and the toggle works again`, async () => {
      render(<Operations />);
      const pause = await statusToggle();
      expect(statusShown()).toBe("Store Status: Active");
      fail();
      await act(async () => { fireEvent.click(pause); });
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to save storefront config"));
      expect(statusShown(), "the card shows a status that was not saved").toBe("Store Status: Active");
      expect(client.updateBusiness, "the store was unpublished though its status was not saved").not.toHaveBeenCalled();
      const again = await statusToggle();
      await waitFor(() => expect(again, "the toggle stayed disabled after the failure").toBeEnabled());
      expect(again.getAttribute("aria-busy")).toBeNull();
      client.updateStorefrontConfig.mockImplementation(async (_b: string, cfg: unknown) => ok(cfg));
      await act(async () => { fireEvent.click(again); });
      await waitFor(() => expect(statusShown()).toBe("Store Status: Paused"));
    });
  }
  it("the store-enabled write fails after the config saved: the config is restored, nothing shown changes, and the error is said", async () => {
    client.updateBusiness.mockResolvedValue({ data: null, error: "Forbidden" });
    render(<Operations />);
    const pause = await statusToggle();
    await act(async () => { fireEvent.click(pause); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(2));
    const statuses = client.updateStorefrontConfig.mock.calls.map((c) => (c[1] as { storeSettings?: { storeStatus?: string } }).storeSettings?.storeStatus);
    expect(statuses, "the saved status was not put back").toEqual(["paused", "active"]);
    expect(statusShown()).toBe("Store Status: Active");
    expect(toast.error).toHaveBeenCalled();
    await waitFor(async () => expect(await statusToggle()).toBeEnabled());
  });
  it("the store-enabled write rejects: the same (config restored, nothing shown changes)", async () => {
    client.updateBusiness.mockRejectedValue(new Error("network down"));
    render(<Operations />);
    const toggle = await statusToggle(); // found outside act: act holds renders until it ends
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(2));
    expect(statusShown()).toBe("Store Status: Active");
  });
  it("control: both writes succeed: both are sent once, and the card then shows the new status", async () => {
    render(<Operations />);
    const toggle = await statusToggle(); // found outside act: act holds renders until it ends
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(statusShown()).toBe("Store Status: Paused"));
    expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1);
    expect(client.updateBusiness).toHaveBeenCalledTimes(1);
    expect(client.updateBusiness.mock.calls[0][0]).toMatchObject({ businessId: A, storeEnabled: false });
  });
});

describe("P237 R3-3: two presses before a render send one save", () => {
  it("two activations in one act: one config save and one store-enabled write", async () => {
    client.updateStorefrontConfig.mockImplementation(() => new Promise(() => {}));
    render(<Operations />);
    const pause = await statusToggle();
    await act(async () => { fireEvent.click(pause); fireEvent.click(pause); });
    expect(client.updateStorefrontConfig, "a second press before the render sent a second save").toHaveBeenCalledTimes(1);
  });
});

describe("P237 R3-4 / R3-10: every status control waits for the status save", () => {
  it("the Active / Paused / Coming Soon choices are disabled and aria-busy mid-save", async () => {
    client.updateStorefrontConfig.mockImplementation(() => new Promise(() => {}));
    render(<Operations />);
    const toggle = await statusToggle(); // found outside act: act holds renders until it ends
    await act(async () => { fireEvent.click(toggle); });
    fireEvent.click(screen.getByRole("button", { name: /^Store Status/ })); // open the section holding the choices
    const choices = screen.getAllByRole("button").filter((b) => /^(Active|Paused|Coming Soon)/.test(b.textContent ?? ""));
    expect(choices.length, "the status choices are not on screen").toBe(3);
    for (const c of choices) {
      expect(c, `${c.textContent} can be pressed mid-save`).toBeDisabled();
      expect(c.getAttribute("aria-busy")).toBe("true");
    }
  });
});

describe("P237 R3-8: a press before the storefront read lands writes and shows nothing", () => {
  it("the storefront read failed: Pause sends no write and the card still shows Active", async () => {
    client.fetchStorefrontConfig.mockImplementation(async () => failed());
    render(<Operations />);
    const pause = await statusToggle();
    await act(async () => { fireEvent.click(pause); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(client.updateStorefrontConfig, "a status was saved over a storefront that was never read").not.toHaveBeenCalled();
    expect(client.updateBusiness).not.toHaveBeenCalled();
    expect(statusShown()).toBe("Store Status: Active");
  });
});

describe("P237 R3-9: saveConfig's own tenancy guard", () => {
  it("A's handleSaveConfig, captured while A was shown and called after a switch to B, writes nothing", async () => {
    const hook = renderHook(() => useStoreData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const captured = hook.result.current.handleSaveConfig; // A's
    act(() => {
      ws.businessId = "biz_B";
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } }));
    });
    await waitFor(() => expect(hook.result.current.businessId).toBe("biz_B"));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    client.updateStorefrontConfig.mockClear();
    await act(async () => { await captured(); });
    expect(client.updateStorefrontConfig, "A's config was written after the switch to B").not.toHaveBeenCalled();
  });
});
