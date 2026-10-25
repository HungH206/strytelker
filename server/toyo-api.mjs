import {
  createReservationStore,
  reservationCsv,
  contactSchema,
} from "./reservations.mjs";
import { Router } from "express";
import {
  createVoiceService,
  executeVoiceTool,
  voiceContext,
  voiceTools,
} from "./voice-agent.mjs";
import { arduinoAction } from "./arduino-actions.mjs";
import { offers } from "./offers.mjs";
import {
  createMarketSearch,
  marketSearchSchema,
  MarketSearchError,
} from "./market-search.mjs";
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

export function createToyoRouter(
  ai,
  arduino,
  marketSearch = createMarketSearch(),
  voiceService = createVoiceService(ai),
  reservationStore,
) {
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
    if (event.type === "CONFIRM" && session.voiceDraft)
      throw new Error(
        "Confirm or cancel the pending voice readback before final checkout.",
      );
    session.browserArm = null;
    session.voiceDraft = null;
    session.state = shoppingTransition(session.state, event, source);
    session.updated = Date.now();
  }
  router.get("/config", (_req, res) =>
    res.json({
      inventory,
      offers,
      gemini: !!ai,
      serpApi: marketSearch.configured,
      liveVoice: voiceService.configured,
    }),
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
  router.get("/voice/context", get, (req, res) =>
    res.json(voiceContext(req.toyo)),
  );
  // Stop must work even if the screen revision changed while the user was speaking.
  router.post("/voice/stop", get, (req, res) => {
    if (req.body?.voiceSessionId === req.toyo.voiceLease?.id) {
      req.toyo.voiceLease = null;
      req.toyo.voiceDraft = null;
      req.toyo.voiceCalls = new Map();
    }
    res.json({ stopped: true });
  });
  let store = reservationStore;
  const reservations = () => (store ??= createReservationStore());
  router.get("/reservation/export", get, async (req, res) => {
    try {
      const receipt = await reservations().get(req.toyoToken);
      if (!receipt)
        return res.status(404).json({ error: "Save your reservation first." });
      const csv = req.query.format === "csv";
      res.set("Cache-Control", "no-store");
      res.attachment(`toyo-reservation-${receipt.id}.${csv ? "csv" : "json"}`);
      if (csv) return res.type("text/csv").send(reservationCsv(receipt));
      return res
        .type("application/json")
        .send(JSON.stringify(receipt, null, 2));
    } catch {
      res.status(503).json({
        error: "Reservation database unavailable. Try again shortly.",
      });
    }
  });
  router.use(get);
  router.use((req, res, next) => {
    if (req.toyo.busy || req.body?.revision !== req.toyo.state.revision)
      return res.status(409).json({
        error: "TOYO has updated this session. Try again with the latest view.",
      });
    next();
  });
  async function submitReservation(session, token, source) {
    if (
      session.busy ||
      !session.state.reservationReady ||
      !session.reservationDraft ||
      session.state.reservationId ||
      session.voiceDraft
    )
      throw new Error(
        "Review the current reservation and agree to save before submitting.",
      );
    session.busy = true;
    session.browserArm = null;
    arduino?.disarm(token);
    try {
      const receipt = await reservations().save(
        token,
        { ...session.state, reservationSubmissionSource: source },
        session.reservationDraft,
      );
      session.reservationDraft = null;
      session.reservationContact = null;
      session.state = {
        ...session.state,
        revision: session.state.revision + 1,
        reservationReady: false,
        reservationId: receipt.id,
        reservationError: null,
        reservationSource: source,
      };
      session.updated = Date.now();
      return session.state;
    } finally {
      session.busy = false;
    }
  }
  router.post("/reservation/prepare", (req, res) => {
    const session = req.toyo;
    const parsed = contactSchema.safeParse(req.body.contact);
    if (
      !parsed.success ||
      req.body.reviewed !== true ||
      session.voiceDraft ||
      session.state.stage !== "complete" ||
      session.state.outcome !== "simulated_purchase" ||
      session.state.reservationId
    )
      return res.status(400).json({
        error:
          "Confirm the car, finish voice readback, review contact details and agree to save first.",
      });
    session.reservationDraft = parsed.data;
    session.reservationContact = null;
    session.browserArm = null;
    arduino?.disarm(req.toyoToken);
    session.state = {
      ...session.state,
      revision: session.state.revision + 1,
      reservationReady: true,
      reservationError: null,
    };
    session.updated = Date.now();
    res.json(session.state);
  });
  router.post("/reservation/cancel", (req, res) => {
    if (req.toyo.state.reservationId)
      return res.status(409).json({ error: "Reservation already saved." });
    req.toyo.reservationDraft = null;
    req.toyo.reservationContact = null;
    req.toyo.voiceDraft = null;
    req.toyo.browserArm = null;
    arduino?.disarm(req.toyoToken);
    req.toyo.state = {
      ...req.toyo.state,
      revision: req.toyo.state.revision + 1,
      reservationReady: false,
    };
    res.json(req.toyo.state);
  });
  router.post("/reservation", async (req, res) => {
    try {
      res.json(await submitReservation(req.toyo, req.toyoToken, "simulator"));
    } catch {
      res.status(409).json({
        error:
          "Could not save the reviewed reservation. Check the details and database connection, then retry.",
      });
    }
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
  router.post("/voice/token", async (req, res) => {
    if (!voiceService.configured)
      return res.status(503).json({
        error:
          "Gemini Live is not configured on the backend. Add GEMINI_API_KEY and restart.",
      });
    if (req.toyo.voiceMintBusy)
      return res
        .status(429)
        .json({ error: "A voice connection is already being prepared." });
    req.toyo.voiceMintBusy = true;
    try {
      res.json(await voiceService.issue(req.toyo));
    } catch {
      res.status(503).json({
        error:
          "Could not start Gemini Live. Check the backend Gemini key, Live model access, and GEMINI_LIVE_MODEL configuration.",
      });
    } finally {
      req.toyo.voiceMintBusy = false;
    }
  });
  router.post("/voice/tool", async (req, res) => {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        voiceSessionId: z.string(),
        callId: z.string().min(1).max(160),
        name: z.enum(
          voiceTools
            .filter((tool) => tool.name !== "get_shopping_context")
            .map((tool) => tool.name),
        ),
        args: z.record(z.string(), z.unknown()),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid voice tool request." });
    const input = parsed.data;
    const session = req.toyo;
    if (
      !session.voiceLease ||
      session.voiceLease.id !== input.voiceSessionId ||
      Date.now() >= session.voiceLease.expires
    )
      return res.status(409).json({
        error:
          "Voice mode has stopped or expired. Click Voice mode to reconnect.",
      });
    if (input.args.revision !== input.revision)
      return res
        .status(409)
        .json({ error: "Voice revision does not match the current screen." });
    const previous = session.voiceCalls?.get(input.callId);
    const signature = JSON.stringify([input.name, input.args]);
    if (previous)
      return previous.signature === signature
        ? res.json(previous.result)
        : res.status(409).json({
            error: "A voice call ID cannot be reused for a different action.",
          });
    try {
      let result;
      if (input.name === "save_reservation") {
        z.object({
          revision: z.number().int().nonnegative(),
          userConfirmed: z.literal(true),
        })
          .strict()
          .parse(input.args);
        await submitReservation(session, req.toyoToken, "voice");
        result = voiceContext(session);
      } else result = executeVoiceTool(session, input.name, input.args);
      session.browserArm = null;
      arduino?.disarm(req.toyoToken);
      if (session.voiceCalls.size >= 100)
        session.voiceCalls.delete(session.voiceCalls.keys().next().value);
      session.voiceCalls.set(input.callId, { signature, result });
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof z.ZodError
            ? "Check the spoken details and confirm the requested action explicitly. Finance needs valid amounts, APR and a supported loan term."
            : error.message,
      });
    }
  });
  router.post("/market-search", async (req, res) => {
    const input = marketSearchSchema.safeParse(req.body);
    if (!input.success)
      return res.status(400).json({
        error: "Choose prices or offers and use a valid five-digit ZIP code.",
      });
    const session = req.toyo;
    if (
      session.state.stage !== "dealer" ||
      session.state.vehicleId !== input.data.vehicleId
    )
      return res
        .status(409)
        .json({ error: "Select this vehicle in the garage before searching." });
    if (session.searchBusy)
      return res
        .status(429)
        .json({ error: "A search is already running. Wait for its results." });
    const revision = session.state.revision;
    const vehicle = inventory.find((car) => car.id === input.data.vehicleId);
    if (!vehicle)
      return res.status(400).json({ error: "Unknown catalog vehicle." });
    session.searchBusy = true;
    try {
      const result = await marketSearch.search(vehicle, input.data);
      if (session.state.revision !== revision)
        return res.status(409).json({
          error:
            "Your vehicle selection changed during the search. Search again for the current choice.",
        });
      // Search snippets never mutate inventory prices, rebates, quotes or session revisions.
      res.json(result);
    } catch (error) {
      res.status(error instanceof MarketSearchError ? error.status : 502).json({
        error:
          error instanceof MarketSearchError
            ? error.message
            : "Search is temporarily unavailable. Try again later.",
      });
    } finally {
      session.searchBusy = false;
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
      if (session.state.stage === "checkout" && session.voiceDraft)
        throw new Error(
          "Finish the pending voice readback before arming checkout.",
        );
      arduinoAction(session.state, 1);
      if (!arduino) throw new Error("Arduino is not configured.");
      session.browserArm = null;
      const nonce = arduino.arm(
        async (count) => {
          if (
            session.busy ||
            session.state.revision !== revision ||
            Date.now() - session.updated > ttl
          )
            return;
          try {
            const event = arduinoAction(session.state, count);
            if (event.type === "SUBMIT_RESERVATION")
              await submitReservation(session, req.toyoToken, "hardware");
            else apply(session, event, "hardware");
          } catch {
            if (session.state.stage === "complete")
              session.state = {
                ...session.state,
                revision: session.state.revision + 1,
                reservationError:
                  "Reservation was not saved. Check the database connection and retry with one D2 press or Save demo reservation.",
              };
          }
        },
        {
          owner: req.toyoToken,
          gestures: stage !== "checkout" && stage !== "complete",
        },
      );
      res.json({ armed: true, expiresIn: 30, nonce });
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });
  router.post("/browser-serial/arm", (req, res) => {
    try {
      if (req.toyo.state.stage === "checkout" && req.toyo.voiceDraft)
        throw new Error(
          "Finish the pending voice readback before arming checkout.",
        );
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
        gestures:
          req.toyo.state.stage !== "checkout" &&
          req.toyo.state.stage !== "complete",
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
  router.post("/browser-serial/press", async (req, res) => {
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
      if (event.type === "SUBMIT_RESERVATION")
        await submitReservation(req.toyo, req.toyoToken, "browser_serial");
      else apply(req.toyo, event, "browser_serial");
      res.json(req.toyo.state);
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });
  return router;
}
