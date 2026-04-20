import { Router, Response, Request } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { sendPartnerInviteEmail } from "../lib/mailer.js";

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
      where: { userId: myId }, select: { linkedUserId: true },
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

    // Send email — non-fatal: if Resend fails (e.g. unverified domain in dev) we still
    // return the invite so the flow can be tested via the acceptUrl.
    let emailWarning: string | undefined;
    try {
      await sendPartnerInviteEmail(normalizedEmail, me?.name ?? "Your partner", acceptUrl);
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

    // Accept: link my account to the sender
    await prisma.$transaction([
      prisma.userSettings.upsert({
        where: { userId: myId },
        update: { linkedUserId: invite.senderId },
        create: { userId: myId, linkedUserId: invite.senderId },
      }),
      prisma.partnerInvite.update({
        where: { token },
        data: { status: "accepted" },
      }),
    ]);

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
// Either party can unlink. Secondary clears their linkedUserId; primary finds and clears secondary's.
partnerRouter.delete("/unlink", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const myId = req.authUserId!;

    // Am I the secondary?
    const mySettings = await prisma.userSettings.findUnique({
      where: { userId: myId }, select: { linkedUserId: true },
    });

    if (mySettings?.linkedUserId) {
      await prisma.userSettings.update({
        where: { userId: myId },
        data: { linkedUserId: null },
      });
      return res.json({ success: true });
    }

    // Am I the primary? Find and clear the secondary.
    const secondarySettings = await prisma.userSettings.findFirst({
      where: { linkedUserId: myId },
    });
    if (secondarySettings) {
      await prisma.userSettings.update({
        where: { userId: secondarySettings.userId },
        data: { linkedUserId: null },
      });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: "No partner link found" });
  } catch (err) {
    console.error("[partner/unlink]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
