import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { reservationCsv } from "./reservations.mjs";
const digest = (value) => createHash("sha256").update(value).digest();
const statusSchema = z
  .object({ status: z.enum(["new", "contacted", "confirmed", "cancelled"]) })
  .strict();

export function createReservationMonitor(
  store,
  { adminToken = process.env.RESERVATION_ADMIN_TOKEN } = {},
) {
  const router = Router();
  const attempts = new Map();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!adminToken || adminToken.length < 32)
      return res
        .status(503)
        .json({
          error:
            "Reservation monitor is disabled. Configure a server-only RESERVATION_ADMIN_TOKEN with at least 32 characters.",
        });
    const ip = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until <= now) attempts.delete(key);
    const failed = attempts.get(ip);
    if (failed?.count >= 10)
      return res
        .status(429)
        .json({ error: "Too many sign-in attempts. Wait five minutes." });
    const token = req.get("Authorization")?.replace(/^Bearer /, "") || "";
    if (!timingSafeEqual(digest(token), digest(adminToken))) {
      if (attempts.size > 1000) attempts.clear();
      attempts.set(ip, {
        count: (failed?.count || 0) + 1,
        until: failed?.until || now + 300000,
      });
      return res
        .status(401)
        .json({ error: "Enter a valid reservation monitor access key." });
    }
    attempts.delete(ip);
    next();
  });
  router.get("/reservations", async (_req, res) => {
    try {
      res.json({ provider: store.provider, reservations: await store.list() });
    } catch {
      res
        .status(503)
        .json({
          error:
            "Reservation database is unavailable. Check the backend configuration.",
        });
    }
  });
  router.use("/reservations/:id", (req, res, next) => {
    if (!z.uuid().safeParse(req.params.id).success)
      return res.status(400).json({ error: "Invalid reservation reference." });
    next();
  });
  router.get("/reservations/:id", async (req, res) => {
    try {
      const receipt = await store.detail(req.params.id);
      if (!receipt)
        return res.status(404).json({ error: "Reservation not found." });
      if (req.query.format === "csv")
        return res
          .attachment(`reservation-${receipt.id}.csv`)
          .type("text/csv")
          .send(reservationCsv(receipt));
      res.json(receipt);
    } catch {
      res.status(503).json({ error: "Could not load reservation." });
    }
  });
  router.post("/reservations/:id/status", async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Choose a valid reservation status." });
    try {
      const receipt = await store.update(req.params.id, parsed.data.status);
      if (!receipt)
        return res.status(404).json({ error: "Reservation not found." });
      res.json(receipt);
    } catch {
      res.status(503).json({ error: "Could not update reservation status." });
    }
  });
  return router;
}
