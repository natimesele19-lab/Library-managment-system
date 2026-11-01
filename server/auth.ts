import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

export type AuthRequest = Request & { user?: { id: string; role: string; patronId?: string }; tenantId?: string | null };

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
      select: { id: true, role: true, active: true, tenantId: true, patronId: true, patron: { select: { active: true } } },
    });
    if (!user?.active) {
      res.status(401).json({ error: "Account is inactive." });
      return;
    }
    if (user.role === "MEMBER" && (!user.patronId || !user.patron?.active)) {
      res.status(401).json({ error: "Patron account is inactive or not linked." });
      return;
    }
    if (user.role === "SUPER_ADMIN") {
      const requestedTenantId = req.header("x-tenant-id")?.trim();
      if (requestedTenantId) {
        const tenant = await prisma.tenant.findUnique({ where: { id: requestedTenantId }, select: { id: true, active: true } });
        if (!tenant?.active) {
          if (req.path.startsWith("/platform/") || req.path === "/auth/me") {
            req.tenantId = null;
          } else {
            res.status(403).json({ error: "The selected school is unavailable or suspended." });
            return;
          }
        } else {
          req.tenantId = tenant.id;
        }
      } else {
        req.tenantId = null;
      }
    } else {
      if (!user.tenantId) {
        res.status(401).json({ error: "Account is not assigned to a school." });
        return;
      }
      const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { id: true, active: true } });
      if (!tenant?.active) {
        res.status(403).json({ error: "This school is suspended. Contact the platform owner." });
        return;
      }
      req.tenantId = tenant.id;
    }
    req.user = { id: user.id, role: user.role, patronId: user.patronId || undefined };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token." });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN" &&
      !(req.user?.role === "SUPER_ADMIN" && req.tenantId)) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  next();
}

export function requirePlatformAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Platform owner access is required." });
    return;
  }
  next();
}

export function requireStaff(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "LIBRARIAN" &&
      !(req.user?.role === "SUPER_ADMIN" && req.tenantId)) {
    res.status(403).json({ error: "Library staff access is required." });
    return;
  }
  next();
}
