// Renders every email template in every locale with sample data to static HTML
// (and plain-text) files, plus an index.html linking them. No network, no DB.
//
//   npm run email:preview               -> ./.email-preview
//   npm run email:preview -- some/dir   -> some/dir
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { escapeHtml } from "../lib/email/components.js";
import { DICTIONARIES, type EmailLocale } from "../lib/email/locales/index.js";
import { EMAIL_SAMPLES } from "../lib/email/samples.js";

const outDir = resolve(process.argv[2] ?? ".email-preview");
mkdirSync(outDir, { recursive: true });

const locales = Object.keys(DICTIONARIES) as EmailLocale[];
const rows: string[] = [];

for (const sample of EMAIL_SAMPLES) {
  const cells: string[] = [];
  for (const locale of locales) {
    const email = sample.render(locale);
    const base = `${sample.name}.${locale}`;
    writeFileSync(join(outDir, `${base}.html`), email.html);
    writeFileSync(join(outDir, `${base}.txt`), `Subject: ${email.subject}\n\n${email.text}`);
    cells.push(
      `<td><a href="${base}.html">${escapeHtml(email.subject)}</a><br><small><a href="${base}.txt">text</a></small></td>`,
    );
  }
  rows.push(`<tr><th>${escapeHtml(sample.name)}</th>${cells.join("")}</tr>`);
}

writeFileSync(
  join(outDir, "index.html"),
  `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Email preview</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#111827}table{border-collapse:collapse}
th,td{border:1px solid #E2E8F0;padding:10px 14px;text-align:left;vertical-align:top}th{background:#F8FAFC}</style>
</head><body>
<h1>Email preview</h1>
<p>Rendered with sample data. Theme: server/lib/email/theme.ts · Copy: server/lib/email/locales/</p>
<table><tr><th>Template</th>${locales.map((l) => `<th>${l}</th>`).join("")}</tr>
${rows.join("\n")}
</table></body></html>`,
);

console.log(`Wrote ${EMAIL_SAMPLES.length * locales.length} emails to ${outDir}/index.html`);
