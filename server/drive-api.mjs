import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  vehicles,
  createJourney,
  transition,
  scriptedDialogue,
} from "./drive-engine.mjs";
export function createDriveRouter(ai, arduino) {
  const router = Router(),
    sessions = new Map();
  const ttl = 2 * 60 * 60 * 1000;
  const clean = () => {
    for (const [id, s] of sessions)
      if (Date.now() - s.updated > ttl) sessions.delete(id);
  };
  const get = (req) => {
    clean();
    const id = req.get("X-Journey-Token");
    return id ? sessions.get(id) : undefined;
  };
  const view = (s) => ({
    ...s.state,
    dialogue: s.dialogue,
    dialogueSource: s.dialogueSource,
  });
  router.get("/config", (_req, res) =>
    res.json({
      vehicles,
      gemini: !!ai,
      elevenLabs: !!(
        process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID
      ),
    }),
  );
  router.post("/journeys", (_req, res) => {
    clean();
    if (sessions.size >= 200)
      return res.status(429).json({
        error: "Too many local journeys. Restart the server to clear them.",
      });
    const token = randomBytes(24).toString("hex"),
      state = createJourney();
    const s = {
      state,
      dialogue: scriptedDialogue(state),
      dialogueSource: "scripted",
      updated: Date.now(),
      busy: false,
    };
    sessions.set(token, s);
    res.json({ token, state: view(s) });
  });
  const eventSchema = z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("SELECT_VEHICLE"),
        vehicleId: z.enum(["corolla", "camry", "rav4"]),
      })
      .strict(),
    ...["COMPARE", "ACCEPT_VEHICLE", "REVISE"].map((type) =>
      z.object({ type: z.literal(type) }).strict(),
    ),
    z
      .object({ type: z.literal("PREPARE_OFFER"), finance: z.unknown() })
      .strict(),
    z
      .object({ type: z.literal("CONFIRM"), source: z.literal("simulator") })
      .strict(),
  ]);
  router.post("/event", (req, res) => {
    const s = get(req);
    if (!s)
      return res
        .status(404)
        .json({ error: "Journey expired. Start a new story." });
    const body = z
      .object({ revision: z.number().int().nonnegative(), event: eventSchema })
      .strict()
      .safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ error: "Invalid story action or inputs." });
    if (s.busy || body.data.revision !== s.state.revision)
      return res.status(409).json({
        error: "The story has changed. Refresh the journey before confirming.",
      });
    try {
      s.state = transition(s.state, body.data.event);
      s.dialogue = scriptedDialogue(s.state);
      s.dialogueSource = "scripted";
      s.updated = Date.now();
      res.json(view(s));
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof z.ZodError
            ? "Check the financial inputs: use nonnegative numbers and a supported term."
            : error.message,
      });
    }
  });
  router.get("/journey", (req, res) => {
    const session = get(req);
    if (!session)
      return res
        .status(404)
        .json({ error: "Journey expired. Start a new story." });
    res.json(view(session));
  });
  router.get("/hardware", (_req, res) =>
    res.json(arduino?.status() || { connected: false }),
  );
  router.post("/hardware/arm", (req, res) => {
    const session = get(req);
    if (!session)
      return res
        .status(404)
        .json({ error: "Journey expired. Start a new story." });
    const revision = session.state.revision;
    if (
      session.busy ||
      session.state.chapter !== 4 ||
      req.body?.revision !== revision
    ) {
      return res
        .status(409)
        .json({ error: "Review the current plan before arming the button." });
    }
    try {
      if (!arduino) throw new Error("Arduino is not configured.");
      arduino.arm(() => {
        if (
          session.busy ||
          session.state.chapter !== 4 ||
          session.state.revision !== revision ||
          Date.now() - session.updated > ttl
        )
          return;
        session.state = transition(session.state, {
          type: "CONFIRM",
          source: "hardware",
        });
        session.dialogue = scriptedDialogue(session.state);
        session.dialogueSource = "scripted";
        session.updated = Date.now();
      });
      res.json({ armed: true, expiresIn: 30 });
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });
  router.post("/dialogue", async (req, res) => {
    const s = get(req);
    if (!s)
      return res
        .status(404)
        .json({ error: "Journey expired. Start a new story." });
    if (s.busy)
      return res.status(409).json({ error: "Lumi is already writing." });
    if (!ai) return res.json(view(s));
    s.busy = true;
    const revision = s.state.revision;
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: JSON.stringify({
          state: s.state,
          script: scriptedDialogue(s.state),
        }),
        config: {
          systemInstruction:
            "Write 60–100 words of warm fairy-tale dialogue for Cinderella and Lumi in an educational, simulated car purchase. Follow the provided chapter and outcome exactly. Do not invent prices, amounts, rates, approval, financing terms, savings timelines, or real Toyota specifications. Do not calculate or alter eligibility. Do not request personal information. Explain that any confirmation is a pretend purchase. Preserve a positive savings-plan ending when outcome is savings_plan. Return only narrative prose.",
        },
      });
      const text = response.text?.trim();
      if (!text || text.length > 2500) throw new Error("Invalid dialogue");
      if (s.state.revision === revision) {
        s.dialogue = text;
        s.dialogueSource = "gemini";
      }
      res.json(view(s));
    } catch {
      res.status(503).json({
        error: "Gemini is unavailable. The scripted scene is still ready.",
      });
    } finally {
      s.busy = false;
    }
  });
  router.post("/narration", async (req, res) => {
    const s = get(req);
    if (!s)
      return res
        .status(404)
        .json({ error: "Journey expired. Start a new story." });
    if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID)
      return res.status(503).json({
        error: "ElevenLabs is not configured. Use browser narration.",
      });
    if (s.audioBusy)
      return res
        .status(429)
        .json({ error: "Narration is already generating." });
    s.audioBusy = true;
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID)}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: s.dialogue,
            model_id: "eleven_multilingual_v2",
          }),
          signal: AbortSignal.timeout(25000),
        },
      );
      if (!response.ok) throw new Error("Speech unavailable");
      res.type("audio/mpeg").send(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.status(503).json({
        error:
          "ElevenLabs could not narrate this scene. Browser narration is available.",
      });
    } finally {
      s.audioBusy = false;
    }
  });
  return router;
}
