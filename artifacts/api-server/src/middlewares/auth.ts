import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { authenticateDeveloperKey } from "../lib/db-store";

declare global {
  namespace Express {
    interface Request {
      ekyvaUserId?: string;
    }
  }
}

export async function requireEkyvaAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const bearer = req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  let userId: string | null | undefined = auth?.userId;
  if (!userId && bearer?.startsWith("ek_live_")) {
    userId = await authenticateDeveloperKey(bearer);
  }
  userId = userId ?? (process.env.NODE_ENV !== "production" ? "demo-user" : undefined);
  if (!userId) {
    res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
    return;
  }
  req.ekyvaUserId = userId;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const userId = req.ekyvaUserId;
  const adminIds = (process.env.EKYVA_ADMIN_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!userId || (process.env.NODE_ENV === "production" && !adminIds.includes(userId))) {
    res.status(403).json({ error: "Admin access required", code: "FORBIDDEN" });
    return;
  }
  next();
}
