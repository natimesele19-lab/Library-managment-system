import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

export type AuthRequest = Request & { user?: { id: string; role: string; patronId?: string } };

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "") as { sub: string; role: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, active: true, patronId: true, patron: { select: { active: true } } },
    });
    if (!user?.active) {
      res.status(401).json({ error: "Account is inactive." });
      return;
    }
    if (user.role === "MEMBER" && (!user.patronId || !user.patron?.active)) {
      res.status(401).json({ error: "Patron account is inactive or not linked." });
      return;
    }
    req.user = { id: user.id, role: user.role, patronId: user.patronId || undefined };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token." });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  next();
}

export function requireStaff(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "LIBRARIAN") {
    res.status(403).json({ error: "Library staff access is required." });
    return;
  }
  next();
}
