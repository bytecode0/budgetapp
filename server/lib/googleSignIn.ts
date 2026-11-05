// Who a Google sign-in lands on (LPBETA-15). Two rules close a pre-registered
// takeover: someone registers a friend's email with their own password (the
// account stays unverified), the friend later signs in with Google, and the
// account turns verified with the attacker's password still on it.
//  - Google must say the email is verified; otherwise any Google account
//    carrying that address would get in.
//  - When Google verifies an account nobody had verified, its password goes:
//    whoever set it never proved they own the email. The owner can set one
//    with "forgot password". The name is Google's too (the old one came
//    from the same unverified sign-up), and the caller welcomes the account
//    like a new one (`claimed`). Its language is reset too: to the UI
//    language of this sign-in, or the default.
import type { PrismaClient } from "@prisma/client";
import type { EmailLocale } from "./email/locales/index.js";

export interface GoogleProfile {
  email?: string;
  name?: string;
  picture?: string;
  verified_email?: boolean;
}

export type GoogleSignInResult =
  | { error: "no_email" | "unverified" }
  | {
      userId: string;
      email: string;
      name: string | null;
      /** Created by this sign-in. */
      isNewUser: boolean;
      /** An existing account nobody had verified, verified by this sign-in. */
      claimed: boolean;
    };

type Db = Pick<PrismaClient, "user" | "userSettings">;

export async function googleSignIn(
  db: Db,
  profile: GoogleProfile,
  lang: EmailLocale | null = null,
  now: Date = new Date(),
): Promise<GoogleSignInResult> {
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
  const claimed = await db.user.updateMany({
    where: { id: user.id, emailVerified: null },
    data: {
      emailVerified: now,
      passwordHash: null,
      failedLogins: 0,
      loginLockedUntil: null,
      ...(profile.name && { name: profile.name }),
    },
  });
  const isClaimed = !!existing && claimed.count === 1;
  if (isClaimed) {
    const language = lang ?? "es";
    await db.userSettings.upsert({
      where: { userId: user.id },
      update: { language },
      create: { userId: user.id, monthlyIncome: 0, language },
    });
  }
  return {
    userId: user.id,
    email,
    name: isClaimed && profile.name ? profile.name : user.name,
    isNewUser: !existing,
    claimed: isClaimed,
  };
}
