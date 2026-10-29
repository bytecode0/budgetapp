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
