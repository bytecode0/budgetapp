import type { Request, Response, NextFunction } from "express";

// Security headers for every API response (LPBETA-23), the helmet defaults
// that matter for a JSON API, without the dependency. The API never serves
// HTML, so its CSP allows nothing at all. The frontend's own headers (with a
// CSP the app can live with) are in vercel.json.
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) res.setHeader(key, value);
  next();
}
