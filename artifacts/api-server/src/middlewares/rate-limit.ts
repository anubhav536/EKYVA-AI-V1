import Redis from "ioredis";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

let redis: Redis | null = null;

function client(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redis.on("error", (error) => logger.warn({ err: error }, "Redis rate-limit client error"));
  }
  return redis;
}

export function rateLimit(options: { limit: number; windowSeconds: number }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const store = client();
    if (!store) {
      next();
      return;
    }
    const identity = req.ekyvaUserId ?? req.ip ?? "anonymous";
    const bucket = Math.floor(Date.now() / (options.windowSeconds * 1000));
    const key = `ekyva:rate:${identity}:${req.path}:${bucket}`;
    try {
      if (store.status === "wait") await store.connect();
      const count = await store.incr(key);
      if (count === 1) await store.expire(key, options.windowSeconds);
      res.setHeader("X-RateLimit-Limit", options.limit);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, options.limit - count));
      if (count > options.limit) {
        res.status(429).json({ error: "Rate limit exceeded", code: "RATE_LIMITED" });
        return;
      }
      next();
    } catch (error) {
      logger.warn({ err: error }, "Rate-limit store unavailable; allowing request");
      next();
    }
  };
}
