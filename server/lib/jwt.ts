import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-change-in-production";
const JWT_EXPIRES_IN = "7d";

export function signToken(payload: object, expiresIn: string = JWT_EXPIRES_IN): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as any);
}

export function verifyToken(token: string): any {
  return jwt.verify(token, JWT_SECRET);
}
