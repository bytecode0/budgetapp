// Who a Google sign-in lands on (LPBETA-15). Two rules close a pre-registered
// takeover: someone registers a friend's email with their own password (the
// account stays unverified), the friend later signs in with Google, and the
// account turns verified with the attacker's password still on it.
//  - Google must say the email is verified; otherwise any Google account
//    carrying that address would get in.
//  - When Google verifies an account nobody had verified, its password goes:
//    whoever set it never proved they own the email. The owner can set one
//    with "forgot password".
import type { PrismaClient } from "@prisma/client";

export interface GoogleProfile {
  email?: string;
  name?: string;
  picture?: string;
  verified_email?: boolean;
}

export type GoogleSignInResult =
  | { error: "no_email" | "unverified" }
  | { userId: string; email: string; name: string | null; isNewUser: boolean };

type Db = Pick<PrismaClient, "user">;

export async function googleSignIn(db: Db, profile: GoogleProfile, now: Date = new Date()): Promise<GoogleSignInResult> {
  const email = profile.email;
  if (!email) return { error: "no_email" };
  if (profile.verified_email !== true) return { error: "unverified" };

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  const user = await db.user.upsert({
    where: { email },
    // emailVerified is set below, together with dropping the password, never alone.
    update: { image: profile.picture },
    create: { email, name: profile.name, image: profile.picture, emailVerified: now },
  });
  // Conditional on the account still being unverified, so it is atomic with
  // the check: a register that races in can't keep its password either (it
  // only writes while the account is unverified, see POST /register).
  await db.user.updateMany({
    where: { id: user.id, emailVerified: null },
    data: { emailVerified: now, passwordHash: null, failedLogins: 0, loginLockedUntil: null },
  });
  return { userId: user.id, email, name: user.name, isNewUser: !existing };
}
