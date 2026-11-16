import jwt from "jsonwebtoken";

// No fallback: a default secret would be public, and anyone could forge a
// session. Missing JWT_SECRET stops the server at startup instead.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set: sessions cannot be signed. Set it in .env (local) or in Vercel.");
}
const JWT_EXPIRES_IN = "7d";

export function signToken(payload: object, expiresIn: string = JWT_EXPIRES_IN): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn } as any);
}

export function verifyToken(token: string): any {
  return jwt.verify(token, JWT_SECRET!);
}

// Session cookies (LPBETA-21): the JWT carries the user and the session
// version it was issued with (`tv`). requireAuth compares it with
// User.tokenVersion, so bumping that ends every session issued before.
export function signSessionToken(userId: string, tokenVersion: number): string {
  return signToken({ userId, tv: tokenVersion });
}

/** Whether a verified session payload is still current. A token from before
 *  LPBETA-21 has no `tv` and counts as version 0, so deploying this signs
 *  nobody out; it dies with the first bump like any other. */
export function sessionVersionMatches(payload: { tv?: unknown }, tokenVersion: number): boolean {
  return (payload.tv === undefined ? 0 : payload.tv) === tokenVersion;
}
