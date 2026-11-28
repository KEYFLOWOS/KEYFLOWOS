/**
 * P306 FU-PDF-AUTOTABLE-EXPORTS (launch-track, D-331). Every web PDF export but the invoice's loaded jspdf-autotable for
 * its side effect (`await import("jspdf-autotable")`) and then called `doc.autoTable(...)`. jspdf-autotable 5 no longer
 * patches jsPDF on import (checked in jsdom and in real Chromium: a new document has no autoTable), so:
 *   - contacts' exportToPDF and exportInsightsReport("pdf") threw "doc.autoTable is not a function" (no PDF at all);
 *   - the reports export (exportReportPDF) and the revenue presets (exportRevenuePresetPDF) called it optionally
 *     (`autoTable?.bind`), so their PDFs downloaded without a single table: a false green in the product.
 * Every export now uses the named `autoTable(doc, options)` (as the invoice already did). Pinned with the real
 * libraries: each export saves one PDF holding its tables' rows.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Every PDF an export saves, as text. The real jsPDF is wrapped only so that save() records the document's output
 * instead of writing a file (under vitest jspdf resolves to its Node build, whose save writes to disk).
 */
const saved = vi.hoisted(() => [] as Array<{ name: string; text: string }>);
vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  const Real = actual.default;
  class Recording extends Real {
    constructor(...args: ConstructorParameters<typeof Real>) {
      super(...args);
      (this as unknown as { save: (name?: string) => unknown }).save = (name?: string) => {
        saved.push({ name: name ?? "", text: this.output() });
        return this;
      };
    }
  }
  return { ...actual, default: Recording, jsPDF: Recording };
});
afterEach(() => { saved.length = 0; });

/** The one PDF saved, and that it was the only one. */
const onlyPdf = () => {
  expect(saved.map((x) => x.name), "not exactly one PDF was saved").toHaveLength(1);
  return saved[0].text;
};

describe("P306: the named autoTable, as the exports now use it", () => {
  it("autoTable(doc, options) writes the table's cells and records where it ended", async () => {
    const { default: JsPDF } = await import("jspdf");
    const { autoTable } = await import("jspdf-autotable");
    const doc = new JsPDF();
    autoTable(doc, { head: [["Metric", "Value"]], body: [["Revenue P306", "TTD 1,234.50"]] });
    expect((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY).toBeGreaterThan(0);
    const out = doc.output();
    expect(out).toContain("(Revenue P306) Tj");
    expect(out).toContain("(TTD 1,234.50) Tj");
  });
});

describe("P306: each export saves a PDF holding its tables", () => {
  it("contacts' exportToPDF: one row per contact", async () => {
    const { exportToPDF } = await import("../contacts-export");
    await exportToPDF([
      { id: "c1", firstName: "Ada", lastName: "Customer", email: "ada@example.test", phone: "+18685550101", status: "CLIENT", tags: ["vip"] },
      { id: "c2", firstName: "Bo", lastName: "Lead", email: "bo@example.test", phone: null, status: "LEAD", tags: [] },
    ] as never, "p306.pdf");
    const text = onlyPdf();
    expect(text).toContain("(Contact Database) Tj");
    expect(text, "the contacts table was not written").toContain("ada@example.test");
    expect(text).toContain("bo@example.test");
  });
  it("exportInsightsReport(pdf): the summary table and the top revenue clients", async () => {
    const { exportInsightsReport } = await import("../contacts-export");
    await exportInsightsReport({
      totalContacts: 42, leads: 10, prospects: 12, clients: 20, conversionRate: "47.6%", pipelineValue: 98765, newThisWeek: 3, period: "Last 30 days",
      contacts: [{ firstName: "Zed", lastName: "Revenue", email: "zed@example.test", status: "CLIENT", meta: { totalRevenue: 5000 } }],
    }, "pdf");
    const text = onlyPdf();
    expect(text, "the summary table was not written").toContain("(Conversion Rate) Tj");
    expect(text).toContain("(47.6%) Tj");
    expect(text, "the top revenue clients table was not written").toContain("Zed Revenue");
  });
  it("exportReportPDF: the key metrics, expense categories and top clients tables", async () => {
    const { exportReportPDF } = await import("@/app/app/reports/components/export-pdf");
    await exportReportPDF({
      type: "executive",
      generatedAt: "2026-11-28T12:00:00.000Z",
      aiNarrative: "",
      metrics: {
        period: { start: "2026-11-01", end: "2026-11-28" },
        currency: "TTD",
        revenue: { total: 12000, invoiceCount: 4, averageInvoice: 3000, byStatus: {}, outstanding: 500, outstandingCount: 1, overdueCount: 2, topClients: [{ name: "Client P306", total: 7000 }] },
        expenses: { total: 3000, count: 5, averageExpense: 600, byCategory: [{ category: "Fuel P306", total: 900, count: 2 }], topVendors: [{ vendor: "Vendor P306", total: 400 }] },
        profitability: { netProfit: 9000, profitMargin: 75, revenueToExpenseRatio: 4 },
        clients: { totalContacts: 42, byStatus: [] },
        bookings: { total: 7, confirmed: 3, completed: 3, cancelled: 1, pending: 0, completionRate: 43 },
        products: { total: 2 },
        business: { name: "Shop P306", industry: null, archetype: null, revenueModel: null },
      },
    } as never);
    const text = onlyPdf();
    expect(text, "the key metrics table was not written").toContain("(Total Revenue) Tj");
    expect(text).toContain("(Overdue Invoices) Tj");
    expect(text, "the expense categories table was not written").toContain("(Fuel P306) Tj");
    expect(text, "the top clients table was not written").toContain("(Client P306) Tj");
  });
  it("exportRevenuePresetPDF (by source): its rows", async () => {
    const { exportRevenuePresetPDF } = await import("@/app/app/reports/components/revenue-reports-view");
    await exportRevenuePresetPDF("by-source", { rows: [{ source: "WhatsApp P306", channel: "direct", revenue: 4321, invoiceCount: 3 }] });
    const text = onlyPdf();
    expect(text).toContain("Revenue by Source");
    expect(text, "the revenue table was not written").toContain("WhatsApp P306");
  });
});
