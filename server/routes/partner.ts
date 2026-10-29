import { Router, Response, Request } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { sendPartnerInviteEmail } from "../lib/mailer.js";
import { resolveLocale } from "../lib/email/locales/index.js";
import { ensureHousehold } from "../lib/household.js";
import { mergeMemberIntoPool } from "../lib/partnerMerge.js";
import { unlinkMemberFromPool } from "../lib/partnerUnlink.js";
import { lockSettings, acceptBlocker } from "../lib/partnerLink.js";

export const partnerRouter = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

// ── GET /api/partner/status ──────────────────────────────────────────────────
// Returns the full partner relationship state for the authenticated user
partnerRouter.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const myId = req.authUserId!;

    // Check if I am the linked (secondary) account
    const mySettings = await prisma.userSettings.findUnique({
      where: { userId: myId },
      select: { linkedUserId: true },
    });

    if (mySettings?.linkedUserId) {
      const primary = await prisma.user.findUnique({
        where: { id: mySettings.linkedUserId },
        select: { name: true, email: true },
      });
      return res.json({
        state: "linked_secondary",
        linkedTo: { name: primary?.name ?? "Unknown", email: primary?.email ?? "" },
      });
    }

    // Check if someone is linked to me (I am the primary)
    const secondarySettings = await prisma.userSettings.findFirst({
      where: { linkedUserId: myId },
      select: { userId: true },
    });

    if (secondarySettings) {
      const secondary = await prisma.user.findUnique({
        where: { id: secondarySettings.userId },
        select: { name: true, email: true },
      });
      return res.json({
        state: "linked_primary",
        linkedPartner: { name: secondary?.name ?? "Unknown", email: secondary?.email ?? "" },
      });
    }

    // Check for a pending invite I sent
    const pendingInvite = await prisma.partnerInvite.findFirst({
      where: { senderId: myId, status: "pending", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (pendingInvite) {
      return res.json({
        state: "invite_pending",
        pendingInvite: { email: pendingInvite.invitedEmail, expiresAt: pendingInvite.expiresAt },
      });
    }

    return res.json({ state: "none" });
  } catch (err) {
    console.error("[partner/status]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/partner/invite ─────────────────────────────────────────────────
partnerRouter.post("/invite", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const myId = req.authUserId!;
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Must not invite yourself
    const me = await prisma.user.findUnique({ where: { id: myId }, select: { email: true, name: true } });
    if (me?.email?.toLowerCase() === normalizedEmail) {
      return res.status(400).json({ error: "You can't invite yourself" });
    }

    // Must not already be linked
    const mySettings = await prisma.userSettings.findUnique({
      where: { userId: myId }, select: { linkedUserId: true, language: true },
    });
    if (mySettings?.linkedUserId) {
      return res.status(400).json({ error: "You are already linked to a partner" });
    }
    const alreadyHasPartner = await prisma.userSettings.findFirst({ where: { linkedUserId: myId } });
    if (alreadyHasPartner) {
      return res.status(400).json({ error: "Someone is already linked to your account" });
    }

    // Cancel any existing pending invite from this user
    await prisma.partnerInvite.updateMany({
      where: { senderId: myId, status: "pending" },
      data: { status: "cancelled" as any },
    });

    const token = crypto.randomUUID();
    const invite = await prisma.partnerInvite.create({
      data: {
        senderId: myId,
        invitedEmail: normalizedEmail,
        token,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const acceptUrl = `${APP_URL}/?invite=${token}`;

    // Send email — non-fatal: if sending fails (e.g. email env vars unset in dev) we still
    // return the invite so the flow can be tested via the acceptUrl.
    let emailWarning: string | undefined;
    try {
      // The invitee may have no account yet, so the email goes out in the inviter's language.
      await sendPartnerInviteEmail(normalizedEmail, me?.name ?? "", acceptUrl, resolveLocale(mySettings?.language));
    } catch (emailErr: any) {
      console.warn("[partner/invite] email not sent:", emailErr?.message);
      emailWarning = "Invite created but email could not be sent. Use the link below to share manually.";
    }

    return res.json({
      invite: { email: invite.invitedEmail, expiresAt: invite.expiresAt },
      ...(emailWarning && { warning: emailWarning, acceptUrl }),
    });
  } catch (err) {
    console.error("[partner/invite]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/partner/invite ───────────────────────────────────────────────
// Cancel a pending outgoing invite
partnerRouter.delete("/invite", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.partnerInvite.updateMany({
      where: { senderId: req.authUserId!, status: "pending" },
      data: { status: "cancelled" as any },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("[partner/invite/delete]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/partner/invite/:token ───────────────────────────────────────────
// Public — validate token and return invite details (for the accept screen)
partnerRouter.get("/invite/:token", async (req: Request, res: Response) => {
  try {
    const invite = await prisma.partnerInvite.findUnique({
      where: { token: req.params.token },
      include: { sender: { select: { name: true, email: true } } },
    });

    if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
      return res.status(404).json({ error: "Invite not found or expired" });
    }

    return res.json({
      invite: {
        invitedEmail: invite.invitedEmail,
        senderName: invite.sender.name ?? "Unknown",
        senderEmail: invite.sender.email ?? "",
      },
    });
  } catch (err) {
    console.error("[partner/invite/get]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/partner/accept ─────────────────────────────────────────────────
// Accept an invite. The authenticated user becomes linked to the sender.
partnerRouter.post("/accept", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const myId = req.authUserId!;
    const { token } = req.body;

    if (!token) return res.status(400).json({ error: "Token is required" });

    const invite = await prisma.partnerInvite.findUnique({
      where: { token },
      include: { sender: { select: { name: true, email: true } } },
    });

    if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
      return res.status(400).json({ error: "Invite not found or expired" });
    }

    // Can't accept your own invite
    if (invite.senderId === myId) {
      return res.status(400).json({ error: "You can't accept your own invite" });
    }

    // Check I'm not already linked to someone
    const mySettings = await prisma.userSettings.findUnique({
      where: { userId: myId }, select: { linkedUserId: true },
    });
    if (mySettings?.linkedUserId) {
      return res.status(400).json({ error: "You are already linked to a partner account" });
    }

    // Data lives in ONE pool (the sender's). If I already have a partner
    // linked to me, or the sender is themself linked to someone else, linking
    // would chain pools and hide that third person's data.
    const [someoneLinkedToMe, senderSettings] = await Promise.all([
      prisma.userSettings.findFirst({ where: { linkedUserId: myId }, select: { id: true } }),
      prisma.userSettings.findUnique({ where: { userId: invite.senderId }, select: { linkedUserId: true } }),
    ]);
    if (someoneLinkedToMe) {
      return res.status(400).json({ error: "Someone is already linked to your account" });
    }
    if (senderSettings?.linkedUserId) {
      return res.status(400).json({ error: "The sender is already linked to another account" });
    }

    // Both settings rows must exist to be locked below.
    await Promise.all([myId, invite.senderId].map(userId =>
      prisma.userSettings.upsert({ where: { userId }, update: {}, create: { userId } })));

    // Accept, all or nothing: link my account to the sender, mirror the link
    // into the Household model (sender = owner, me = member), and move what I
    // created on my own (e.g. my onboarding) into the sender's pool — once
    // linked my data scope is that pool, so anything left under my own userId
    // would be hidden (server/lib/partnerMerge.ts).
    const outcome = await prisma.$transaction(async (tx) => {
      // The checks above ran outside the transaction; a concurrent accept could
      // have linked either of us since — including someone else accepting
      // another invite from the same sender, which would give the pool two
      // members. Re-check under the locks: every accept touching the sender
      // waits on the sender's row, so these reads see any earlier one.
      await lockSettings(tx, [myId, invite.senderId]);
      const [me, sender, linkedToMe, linkedToSender] = await Promise.all([
        tx.userSettings.findUnique({ where: { userId: myId }, select: { linkedUserId: true } }),
        tx.userSettings.findUnique({ where: { userId: invite.senderId }, select: { linkedUserId: true } }),
        tx.userSettings.findFirst({ where: { linkedUserId: myId }, select: { id: true } }),
        tx.userSettings.findFirst({ where: { linkedUserId: invite.senderId }, select: { id: true } }),
      ]);
      const blocker = acceptBlocker({
        meLinkedTo: me?.linkedUserId ?? null,
        someoneLinkedToMe: !!linkedToMe,
        senderLinkedTo: sender?.linkedUserId ?? null,
        someoneLinkedToSender: !!linkedToSender,
      });
      if (blocker) return blocker;

      // Claim the invite first, so a double submit can't merge twice.
      const claimed = await tx.partnerInvite.updateMany({
        where: { token, status: "pending" },
        data: { status: "accepted" },
      });
      if (claimed.count === 0) return "Invite not found or expired";
      await tx.userSettings.update({ where: { userId: myId }, data: { linkedUserId: invite.senderId } });
      const householdId = await ensureHousehold(invite.senderId, myId, "transparent", tx);
      await mergeMemberIntoPool(tx, { memberId: myId, poolId: invite.senderId, householdId });
      return "accepted";
    }, { timeout: 30_000 });
    if (outcome !== "accepted") return res.status(400).json({ error: outcome });

    return res.json({
      success: true,
      linkedTo: { name: invite.sender.name, email: invite.sender.email },
    });
  } catch (err) {
    console.error("[partner/accept]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/partner/unlink ───────────────────────────────────────────────
// Either party can unlink. The partner linked to the pool (the secondary) is
// the one who leaves it: in one transaction her link is cleared, her
// household membership removed, and everything she owns moves back to her own
// scope so it stays neither in her ex's pool nor hidden from her
// (server/lib/partnerUnlink.ts).
partnerRouter.delete("/unlink", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const myId = req.authUserId!;

    // Am I the secondary? Otherwise, am I the primary of someone?
    const mySettings = await prisma.userSettings.findUnique({
      where: { userId: myId }, select: { linkedUserId: true },
    });
    const link = mySettings?.linkedUserId
      ? { memberId: myId, poolId: mySettings.linkedUserId }
      : await prisma.userSettings.findFirst({ where: { linkedUserId: myId }, select: { userId: true } })
        .then(s => (s ? { memberId: s.userId, poolId: myId } : null));
    if (!link) return res.status(400).json({ error: "No partner link found" });

    const unlinked = await prisma.$transaction(async (tx) => {
      // Re-read under the locks: a concurrent unlink must not move twice.
      await lockSettings(tx, [link.memberId, link.poolId]);
      const current = await tx.userSettings.findUnique({ where: { userId: link.memberId }, select: { linkedUserId: true } });
      if (current?.linkedUserId !== link.poolId) return false;
      await unlinkMemberFromPool(tx, link);
      return true;
    }, { timeout: 30_000 });
    if (!unlinked) return res.status(400).json({ error: "No partner link found" });

    return res.json({ success: true });
  } catch (err) {
    console.error("[partner/unlink]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
