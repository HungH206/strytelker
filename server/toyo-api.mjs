import { Router } from "express";
import { arduinoAction } from "./arduino-actions.mjs";
import { offers } from "./offers.mjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  inventory,
  createShoppingSession,
  shoppingTransition,
  matchingVehicles,
} from "./toyo-engine.mjs";

const eventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("VISIT"),
      location: z.enum(["hq", "dealer", "finance", "checkout"]),
    })
    .strict(),
  z.object({ type: z.literal("ANSWER"), yes: z.boolean() }).strict(),
  z.object({ type: z.literal("PROFILE"), profile: z.unknown() }).strict(),
  z
    .object({ type: z.literal("NEXT_CAR"), all: z.boolean().optional() })
    .strict(),
  z.object({ type: z.literal("INSPECT_CAR"), vehicleId: z.string() }).strict(),
  ...["CHOOSE_CAR", "BACK", "CONFIRM", "BROWSE_ALL"].map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
  z
    .object({
      type: z.literal("FINANCE"),
      finance: z.unknown(),
      offerId: z.string().nullable().optional(),
      eligibilityAcknowledged: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("INSURANCE"), insurance: z.unknown() }).strict(),
]);

export function createToyoRouter(ai, arduino) {
  const router = Router();
  const sessions = new Map();
  const ttl = 2 * 60 * 60 * 1000;
  function clean() {
    for (const [token, session] of sessions)
      if (Date.now() - session.updated > ttl) {
        arduino?.disarm(token);
        sessions.delete(token);
      }
  }
  function get(req, res, next) {
    clean();
    const token = req.get("X-Journey-Token");
    const session = sessions.get(token);
    if (!session)
      return res
        .status(404)
        .json({ error: "Session expired. Start again at TOYO HQ." });
    req.toyo = session;
    req.toyoToken = token;
    next();
  }
  function apply(session, event, source) {
    session.browserArm = null;
    session.state = shoppingTransition(session.state, event, source);
    session.updated = Date.now();
  }
  router.get("/config", (_req, res) =>
    res.json({ inventory, offers, gemini: !!ai }),
  );
  router.get("/hardware", (_req, res) =>
    res.json(arduino?.status() || { connected: false }),
  );
  router.post("/sessions", (_req, res) => {
    clean();
    if (sessions.size >= 200)
      return res
        .status(429)
        .json({ error: "Too many sessions. Restart the local server." });
    const token = randomBytes(24).toString("hex");
    const session = {
      state: createShoppingSession(),
      updated: Date.now(),
      busy: false,
    };
    sessions.set(token, session);
    res.json({ token, state: session.state });
  });
  router.get("/session", get, (req, res) => res.json(req.toyo.state));
  router.use(get);
  router.use((req, res, next) => {
    if (req.toyo.busy || req.body?.revision !== req.toyo.state.revision)
      return res.status(409).json({
        error: "TOYO has updated this session. Try again with the latest view.",
      });
    next();
  });
  router.post("/event", (req, res) => {
    const event = eventSchema.safeParse(req.body.event);
    if (!event.success)
      return res.status(400).json({ error: "Invalid TOYO action." });
    try {
      apply(req.toyo, event.data, "simulator");
      arduino?.disarm(req.toyoToken);
      res.json(req.toyo.state);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof z.ZodError
            ? "Check the entered values and required acknowledgments."
            : error.message,
      });
    }
  });
  router.post("/recommend", async (req, res) => {
    const session = req.toyo;
    if (session.state.stage !== "dealer")
      return res
        .status(409)
        .json({ error: "Finish the HQ questionnaire first." });
    const matches = matchingVehicles(session.state.profile);
    if (!matches.length || !ai) return res.json(session.state);
    session.busy = true;
    session.browserArm = null;
    arduino?.disarm(req.toyoToken);
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: JSON.stringify({
          preferences: session.state.profile,
          candidates: matches.map(({ id, name, kind, price }) => ({
            id,
            name,
            kind,
            price,
          })),
        }),
        config: {
          systemInstruction:
            "You are TOYO, a Toyota shopping assistant. Select the best matching vehicle from candidates only. Respect body style and price range. Do not invent stock, discounts, features, approvals, or prices. Explain your choice in one sentence based only on the provided data. Return JSON with vehicleId and reason.",
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              vehicleId: { type: "string", enum: matches.map((car) => car.id) },
              reason: { type: "string" },
            },
            required: ["vehicleId", "reason"],
          },
        },
      });
      const result = z
        .object({
          vehicleId: z.enum(matches.map((car) => car.id)),
          reason: z.string().min(1).max(600),
        })
        .parse(JSON.parse(response.text));
      session.state = {
        ...session.state,
        vehicleId: result.vehicleId,
        recommendation: result.reason,
        recommendationSource: "gemini",
        revision: session.state.revision + 1,
      };
      session.updated = Date.now();
      res.json(session.state);
    } catch {
      res.status(503).json({
        error:
          "Gemini could not rank the catalog. Your rule-based matches are still available.",
      });
    } finally {
      session.busy = false;
    }
  });
  router.post("/hardware/disarm", (req, res) => {
    arduino?.disarm(req.toyoToken, req.body.nonce);
    if (!req.body.nonce || req.body.nonce === req.toyo.browserArm?.nonce)
      req.toyo.browserArm = null;
    res.json({ armed: false });
  });
  router.post("/hardware/arm", (req, res) => {
    const session = req.toyo;
    const { stage, revision } = session.state;
    try {
      arduinoAction(session.state, 1);
      if (!arduino) throw new Error("Arduino is not configured.");
      session.browserArm = null;
      const nonce = arduino.arm(
        (count) => {
          if (
            session.busy ||
            session.state.revision !== revision ||
            Date.now() - session.updated > ttl
          )
            return;
          try {
            const event = arduinoAction(session.state, count);
            apply(session, event, "hardware");
          } catch {
            /* Invalid or empty selections never advance. */
          }
        },
        { owner: req.toyoToken, gestures: stage !== "checkout" },
      );
      res.json({ armed: true, expiresIn: 30, nonce });
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });
  router.post("/browser-serial/arm", (req, res) => {
    try {
      arduinoAction(req.toyo.state, 1);
      arduino?.disarm(req.toyoToken);
      const nonce = randomBytes(12).toString("hex");
      req.toyo.browserArm = {
        nonce,
        revision: req.toyo.state.revision,
        expires: Date.now() + 30000,
      };
      res.json({
        nonce,
        expiresIn: 30,
        gestures: req.toyo.state.stage !== "checkout",
      });
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });
  router.post("/browser-serial/disarm", (req, res) => {
    if (req.body.nonce === req.toyo.browserArm?.nonce)
      req.toyo.browserArm = null;
    res.json({ armed: false });
  });
  router.post("/browser-serial/press", (req, res) => {
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        nonce: z.string().regex(/^[a-f0-9]{24}$/),
        count: z.union([z.literal(1), z.literal(2)]),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ error: "Invalid serial gesture." });
    const arm = req.toyo.browserArm;
    if (
      !arm ||
      arm.nonce !== body.data.nonce ||
      arm.revision !== body.data.revision ||
      Date.now() >= arm.expires
    )
      return res.status(409).json({
        error:
          "This Arduino press is stale or was already used. Rearm and try again.",
      });
    req.toyo.browserArm = null;
    try {
      const event = arduinoAction(req.toyo.state, body.data.count);
      apply(req.toyo, event, "browser_serial");
      res.json(req.toyo.state);
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });
  return router;
}
