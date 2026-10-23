// The one place to customise how every email looks. Templates and components
// read from here; copy (all wording) lives in locales/{es,en}.ts.

export interface ToneColors {
  background: string;
  border: string;
  text: string;
}

export interface EmailTheme {
  productName: string;
  /** Absolute URL of a hosted logo (LOGO_URL). Without it, a coloured mark is drawn. */
  logoUrl: string | null;
  /** Base URL for links in emails (APP_URL). */
  appUrl: string;
  supportEmail: string;
  fontStack: string;
  monoFontStack: string;
  /** Border radii in px. */
  radius: { card: number; box: number; button: number };
  colors: {
    primary: string;
    secondary: string;
    onPrimary: string;
    pageBackground: string;
    card: string;
    border: string;
    text: string;
    muted: string;
    subtle: string;
  };
  /** Accent bar colour at the top of the card, per kind of email. */
  accents: { brand: string; warning: string; danger: string; neutral: string };
  tones: { info: ToneColors; success: ToneColors; warning: ToneColors; danger: ToneColors };
  billing: {
    // TODO: the Premium price is hardcoded, as it was in the old subscription
    // emails (and in the frontend locales). It should come from the Stripe price
    // behind STRIPE_PREMIUM_PRICE_ID so a price change cannot leave emails stale.
    premiumMonthlyCents: number;
    currency: string;
  };
}

const BRAND = {
  productName: "LifePlan",
  // Shown in footers and used as Reply-To where an email asks the user to reply.
  supportEmail: "contact@luisvespa.com",
  fontStack: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  monoFontStack: "'SFMono-Regular',Menlo,Consolas,'Courier New',Courier,monospace",
  radius: { card: 16, box: 12, button: 10 },
  colors: {
    primary: "#1E3A8A",
    secondary: "#10B981",
    onPrimary: "#FFFFFF",
    pageBackground: "#F0F4FF",
    card: "#FFFFFF",
    border: "#E2E8F0",
    text: "#111827",
    muted: "#6B7280",
    subtle: "#9CA3AF",
  },
  accents: { brand: "#1E3A8A", warning: "#F59E0B", danger: "#DC2626", neutral: "#475569" },
  tones: {
    info: { background: "#F0F4FF", border: "#C7D2FE", text: "#1E3A8A" },
    success: { background: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
    warning: { background: "#FFFBEB", border: "#FCD34D", text: "#92400E" },
    danger: { background: "#FEF2F2", border: "#FECACA", text: "#991B1B" },
  },
  billing: { premiumMonthlyCents: 999, currency: "EUR" },
} satisfies Omit<EmailTheme, "logoUrl" | "appUrl">;

/** Resolved at render time so env changes (and tests) are picked up without a restart. */
export function getTheme(): EmailTheme {
  return {
    ...BRAND,
    logoUrl: process.env.LOGO_URL || null,
    // Same default the mailers have always used for local development.
    appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
  };
}
