// Radiografía Financiera — PDF report generator (R4).
//
// Builds the personalized report we email after the user leaves their address.
// Pure: takes an XRayResult, returns a PDF Buffer. Default language Spanish
// (the lead magnet's audience). Uses pdfkit's built-in Helvetica (WinAnsi covers
// €, á, ñ, ¿…), so no external fonts are bundled.
import PDFDocument from "pdfkit";
import type { XRayResult } from "./analyze.js";
import { categoryLabel, pillarLabel, stageLabel, opportunityText, type Lang } from "./labels.js";

const NAVY = "#1E3A8A";
const GREEN = "#10B981";
const INK = "#111827";
const GREY = "#6B7280";
const LIGHT = "#9CA3AF";
const AMBER = "#B45309";

export function generateXrayPdf(result: XRayResult, lang: Lang = "es"): Promise<Buffer> {
  const money = (n: number, decimals = false) =>
    new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-GB", {
      style: "currency", currency: "EUR",
      minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0,
    }).format(n);
  const T = STRINGS[lang];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { page } = doc;
    const left = doc.page.margins.left;
    const contentW = page.width - doc.page.margins.left - doc.page.margins.right;

    // ── Header ──
    doc.rect(0, 0, page.width, 6).fill(NAVY);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(22).text(T.title, left, 60);
    doc.fillColor(GREY).font("Helvetica").fontSize(11)
      .text(T.period(result.period.months, result.period.from, result.period.to), { continued: false });
    doc.moveDown(1.2);

    // ── Summary cards ──
    const cards = [
      { label: T.income, value: money(result.summary.totalIncome), color: NAVY },
      { label: T.expenses, value: money(result.summary.totalExpenses), color: INK },
      { label: result.summary.net >= 0 ? T.saved : T.overspent, value: money(Math.abs(result.summary.net)), color: GREEN },
      { label: T.savingsRate, value: `${Math.round(result.summary.savingsRate * 100)}%`, color: NAVY },
    ];
    const cardW = (contentW - 3 * 10) / 4;
    let y = doc.y;
    cards.forEach((c, i) => {
      const x = left + i * (cardW + 10);
      doc.roundedRect(x, y, cardW, 62, 8).fill("#F0F4FF");
      doc.fillColor(GREY).font("Helvetica").fontSize(8).text(c.label.toUpperCase(), x + 10, y + 12, { width: cardW - 20 });
      doc.fillColor(c.color).font("Helvetica-Bold").fontSize(15).text(c.value, x + 10, y + 30, { width: cardW - 20 });
    });
    doc.y = y + 62 + 14;

    if (result.balances?.hasData) {
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11)
        .text(T.balanceLine(money(result.balances.total), result.balances.runwayMonths), left, doc.y, { width: contentW });
    }
    if (result.internalTransfers.count > 0) {
      doc.fillColor(GREY).font("Helvetica").fontSize(9)
        .text(T.internalNote(result.internalTransfers.count, money(result.internalTransfers.total)), left, doc.y, { width: contentW });
    }
    doc.moveDown(0.6);

    // ── Health index ──
    sectionTitle(doc, left, T.healthTitle);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(34).text(`${result.health.score}`, { continued: true })
      .fillColor(LIGHT).font("Helvetica").fontSize(14).text(" / 100");
    doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(13).text(stageLabel(result.health.stage, lang));
    doc.fillColor(GREY).font("Helvetica").fontSize(10)
      .text(result.health.pillars.map(p => `${pillarLabel(p.key, lang)} ${p.score}`).join("   ·   "));
    doc.moveDown(1);

    // ── Categories ──
    if (result.categories.length) {
      sectionTitle(doc, left, T.categoriesTitle);
      result.categories.slice(0, 7).forEach(c => {
        const label = c.label ?? categoryLabel(c.key, lang);
        row(doc, left, contentW, `${label}`, `${money(c.total)}  ·  ${money(c.annualized)}/${T.year}`);
      });
      doc.moveDown(0.8);
    }

    // ── Ant expenses ──
    if (result.antExpenses.items.length) {
      sectionTitle(doc, left, T.antTitle);
      doc.fillColor(AMBER).font("Helvetica-Bold").fontSize(16).text(`${money(result.antExpenses.annualized)} / ${T.year}`);
      doc.fillColor(GREY).font("Helvetica").fontSize(10).text(T.antReframe(money(result.antExpenses.annualized * 5)));
      doc.moveDown(0.3);
      result.antExpenses.items.slice(0, 5).forEach(i => {
        row(doc, left, contentW, pretty(i.merchant), `${i.count}×  ·  ${money(i.avgTicket, true)}`);
      });
      doc.moveDown(0.8);
    }

    // ── Wealth (savings + investment) ──
    if (result.wealth.total > 0) {
      sectionTitle(doc, left, T.wealthTitle);
      doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(16).text(`${money(result.wealth.total)}`);
      doc.fillColor(GREY).font("Helvetica").fontSize(10).text(T.wealthSub(money(result.wealth.savings), money(result.wealth.investment)));
      doc.moveDown(0.3);
      result.wealth.items.slice(0, 6).forEach(i => {
        row(doc, left, contentW, pretty(i.merchant), i.kind === "investment" ? T.investment : T.savings);
      });
      doc.moveDown(0.8);
    }

    // ── Recurring ──
    if (result.recurring.count) {
      sectionTitle(doc, left, T.recurringTitle);
      doc.fillColor(GREY).font("Helvetica").fontSize(10)
        .text(T.recurringSub(result.recurring.count, money(result.recurring.monthlyTotal)));
      doc.moveDown(0.3);
      result.recurring.items.slice(0, 8).forEach(i => {
        row(doc, left, contentW, pretty(i.merchant), `${money(i.monthlyAmount, true)}/${T.month}  ·  ${money(i.annualized)}/${T.year}`);
      });
      doc.moveDown(0.8);
    }

    // ── Opportunities ──
    if (result.opportunities.length) {
      if (doc.y > page.height - 200) doc.addPage();
      sectionTitle(doc, left, T.opportunitiesTitle);
      result.opportunities.forEach(o => {
        const { title, detail } = opportunityText(o.id, o.params, o.annualSaving, lang, n => money(n));
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(`•  ${title}`, { continued: o.annualSaving > 0 });
        if (o.annualSaving > 0) doc.fillColor(GREEN).font("Helvetica-Bold").text(`   +${money(o.annualSaving)}/${T.year}`);
        doc.fillColor(GREY).font("Helvetica").fontSize(10).text(`    ${detail}`);
        doc.moveDown(0.4);
      });
    }

    // ── Footer CTA ──
    const fy = page.height - 90;
    doc.rect(0, fy, page.width, 90).fill("#F0F4FF");
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text(T.ctaTitle, left, fy + 20, { width: contentW });
    doc.fillColor(GREY).font("Helvetica").fontSize(10).text(T.ctaBody, { width: contentW });

    doc.end();
  });
}

function sectionTitle(doc: PDFKit.PDFDocument, left: number, text: string) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.fillColor("#1E3A8A").font("Helvetica-Bold").fontSize(13).text(text, left);
  doc.moveDown(0.3);
}

function row(doc: PDFKit.PDFDocument, left: number, width: number, label: string, value: string) {
  if (doc.y > doc.page.height - 80) doc.addPage();
  const y = doc.y;
  doc.fillColor("#111827").font("Helvetica").fontSize(10).text(label, left, y, { width: width * 0.55 });
  doc.fillColor("#6B7280").font("Helvetica").fontSize(10).text(value, left + width * 0.55, y, { width: width * 0.45, align: "right" });
  doc.moveDown(0.15);
}

function pretty(m: string): string {
  return m.replace(/\b\w/g, c => c.toUpperCase());
}

const STRINGS = {
  es: {
    title: "Radiografía Financiera",
    period: (m: number, from: string, to: string) => `Tu informe personalizado · ${m} meses (${from} → ${to})`,
    income: "Ingresos", expenses: "Gastos", saved: "Ahorraste", overspent: "Gastaste de más", savingsRate: "Tasa de ahorro",
    healthTitle: "Tu Índice de Salud Financiera",
    categoriesTitle: "A dónde va tu dinero",
    antTitle: "Tus gastos hormiga",
    antReframe: (a: string) => `Eso son unos ${a} en los próximos 5 años.`,
    wealthTitle: "Ahorro e inversión detectados",
    wealthSub: (s: string, i: string) => `Ahorro: ${s}  ·  Inversión: ${i}. Esto no es gasto: es patrimonio que conservas.`,
    savings: "Ahorro", investment: "Inversión",
    internalNote: (c: number, a: string) => `${c} traspasos entre tus cuentas reconciliados (${a}) — fuera de ingresos, gastos y ahorro.`,
    balanceLine: (total: string, months: number | null) => `Patrimonio líquido: ${total}${months != null ? ` · cubre ~${months} meses de gastos` : ""}`,
    recurringTitle: "Recurrentes y suscripciones",
    recurringSub: (c: number, a: string) => `${c} pagos recurrentes · ${a} al mes.`,
    opportunitiesTitle: "Tus oportunidades",
    ctaTitle: "Esto es solo el principio.",
    ctaBody: "Crea tu cuenta gratis en LifePlan y sigue tu dinero vivo, con tus datos ya cargados. Incluye el Manual de Transformación Financiera.",
    year: "año", month: "mes",
  },
  en: {
    title: "Financial X-Ray",
    period: (m: number, from: string, to: string) => `Your personalized report · ${m} months (${from} → ${to})`,
    income: "Income", expenses: "Expenses", saved: "You saved", overspent: "You overspent", savingsRate: "Savings rate",
    healthTitle: "Your Financial Health Index",
    categoriesTitle: "Where your money goes",
    antTitle: "Your ant expenses",
    antReframe: (a: string) => `That's around ${a} over the next 5 years.`,
    wealthTitle: "Savings & investment detected",
    wealthSub: (s: string, i: string) => `Savings: ${s}  ·  Investment: ${i}. This isn't spending — it's wealth you keep.`,
    savings: "Savings", investment: "Investment",
    internalNote: (c: number, a: string) => `${c} transfers between your accounts reconciled (${a}) — left out of income, spending and savings.`,
    balanceLine: (total: string, months: number | null) => `Liquid net worth: ${total}${months != null ? ` · covers ~${months} months of spending` : ""}`,
    recurringTitle: "Recurring & subscriptions",
    recurringSub: (c: number, a: string) => `${c} recurring payments · ${a} per month.`,
    opportunitiesTitle: "Your opportunities",
    ctaTitle: "This is just the beginning.",
    ctaBody: "Create your free LifePlan account and track your money live, with your data already loaded. Includes the Financial Transformation Manual.",
    year: "year", month: "month",
  },
} as const;
