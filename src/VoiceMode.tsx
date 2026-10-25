import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { QuoteDetails, type Finance, type Quote } from "./Drive";
import type { ShoppingState } from "./ShoppingPanel";
import {
  LiveVoiceConnection,
  type LiveCredentials,
  type VoiceCall,
} from "./live-voice";

type Draft = {
  id: string;
  revision: number;
  kind: "finance" | "insurance" | "reservation";
  event: {
    contact?: { name: string; phone: string };
    finance?: Finance;
    offerId?: string | null;
    insurance?: { mode: string; monthly: number };
  };
  quote?: Quote;
};
type Context = {
  state: ShoppingState;
  draft: Draft | null;
  reservationContact?: { id: string; name: string; phone: string } | null;
  [key: string]: unknown;
};
type Token = LiveCredentials & {
  voiceSessionId: string;
  maxSessionSeconds: number;
  context: Context;
};
const detailLabels = {
  savings: "Available savings",
  reserve: "Protected emergency savings",
  monthlyBudget: "Total monthly budget",
  ownershipCosts: "Monthly running costs",
  downPayment: "Down payment",
  apr: "Fixed APR",
  months: "Loan term",
};

export default function VoiceMode({
  state,
  available,
  api,
  setState,
  lock,
  onActiveChange,
  onDraft,
  onReservationContact,
}: {
  state: ShoppingState;
  available: boolean;
  api: (path: string, body?: unknown) => Promise<any>;
  setState: Dispatch<SetStateAction<ShoppingState | null>>;
  lock: MutableRefObject<boolean>;
  onActiveChange: (active: boolean) => void;
  onDraft: (draft: Draft | null) => void;
  onReservationContact?: (contact: {
    id: string;
    name: string;
    phone: string;
  }) => void;
}) {
  const [phase, setPhase] = useState<"off" | "connecting" | "live">("off");
  const [activity, setActivity] = useState("Listening");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [approving, setApproving] = useState(false);
  const [transcript, setTranscript] = useState<
    Array<{ role: "user" | "agent"; text: string; open: boolean }>
  >([]);
  const connection = useRef<LiveVoiceConnection | null>(null);
  const lease = useRef("");
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(state.revision);
  const queue = useRef(Promise.resolve());
  const cancelled = useRef(new Set<string>());
  const live = useRef({
    api,
    state,
    onActiveChange,
    onDraft,
    onReservationContact,
  });
  live.current = { api, state, onActiveChange, onDraft, onReservationContact };

  function receiveContext(context: Context) {
    if (context.state.revision < live.current.state.revision) return;
    revision.current = context.state.revision;
    setState((current) =>
      current && context.state.revision >= current.revision
        ? context.state
        : current,
    );
    if (context.reservationContact)
      live.current.onReservationContact?.(context.reservationContact);
    setDraft(context.draft);
    live.current.onDraft(context.draft);
  }
  function stop(message = "") {
    generation.current++;
    connection.current?.stop();
    connection.current = null;
    const previousLease = lease.current;
    lease.current = "";
    if (previousLease)
      void live.current
        .api("voice/stop", { voiceSessionId: previousLease })
        .catch(() => {});
    if (timer.current) clearTimeout(timer.current);
    setPhase("off");
    setMuted(false);
    setDraft(null);
    live.current.onDraft(null);
    live.current.onActiveChange(false);
    if (message) setError(message);
  }
  useEffect(
    () => () => {
      generation.current++;
      connection.current?.stop();
      if (timer.current) clearTimeout(timer.current);
      if (lease.current)
        void live.current
          .api("voice/stop", { voiceSessionId: lease.current })
          .catch(() => {});
      live.current.onActiveChange(false);
    },
    [],
  );

  async function execute(call: VoiceCall, run: number) {
    if (
      run !== generation.current ||
      !lease.current ||
      (call.id && cancelled.current.has(call.id))
    )
      return;
    const name = call.name || "";
    let response: Record<string, unknown>;
    if (name === "get_shopping_context") {
      try {
        const context = await live.current.api("voice/context");
        if (run !== generation.current) return;
        receiveContext(context);
        response = { result: context };
      } catch {
        response = {
          error:
            "Could not read current context. Ask the user to check their backend connection.",
        };
      }
    } else if (lock.current)
      response = {
        error:
          "The screen is updating. Get the latest context before trying again.",
      };
    else {
      lock.current = true;
      try {
        const context = await live.current.api("voice/tool", {
          revision: call.args?.revision,
          voiceSessionId: lease.current,
          callId: call.id || crypto.randomUUID(),
          name,
          args: call.args || {},
        });
        if (run !== generation.current) return;
        receiveContext(context);
        response = { result: context };
      } catch (error) {
        response = {
          error:
            error instanceof Error
              ? error.message
              : "The tool failed. Get the current context before acting.",
        };
      } finally {
        lock.current = false;
      }
    }
    if (
      run === generation.current &&
      !(call.id && cancelled.current.has(call.id))
    )
      connection.current?.respond([{ id: call.id, name, response }]);
  }
  async function start() {
    if (!available || phase !== "off") return;
    const run = ++generation.current;
    setPhase("connecting");
    setError("");
    setTranscript([]);
    setMuted(false);
    window.speechSynthesis?.cancel();
    live.current.onActiveChange(true);
    try {
      const controller = new LiveVoiceConnection({
        onReady() {
          if (run !== generation.current) return;
          setPhase("live");
          setActivity("Listening");
        },
        onActivity(value) {
          if (run === generation.current) setActivity(value);
        },
        onTranscript(role, text, finished) {
          if (run !== generation.current) return;
          setTranscript((old) => {
            const lines = [...old];
            const last = lines.at(-1);
            if (last?.role === role && last.open) {
              const combined = text.startsWith(last.text)
                ? text
                : last.text.endsWith(text)
                  ? last.text
                  : last.text + text;
              lines[lines.length - 1] = {
                role,
                text: combined.slice(-2500),
                open: !finished,
              };
            } else
              lines.push({ role, text: text.slice(-2500), open: !finished });
            return lines.slice(-40);
          });
        },
        onTools(calls) {
          for (const call of calls)
            queue.current = queue.current
              .then(() => execute(call, run))
              .catch(() => {
                if (run === generation.current)
                  stop(
                    "A voice action could not complete. Reconnect to continue from the current screen.",
                  );
              });
        },
        onCancelled(ids) {
          ids.forEach((id) => cancelled.current.add(id));
        },
        onError(message) {
          if (run === generation.current) stop(message);
        },
        onClose() {
          if (run === generation.current)
            stop(
              "Voice disconnected. Click Voice mode to continue from the current shopping step.",
            );
        },
      });
      connection.current = controller;
      await controller.prepareAudio();
      if (run !== generation.current) return;
      const credentials: Token = await live.current.api("voice/token", {
        revision: live.current.state.revision,
      });
      if (run !== generation.current) {
        controller.stop();
        void live.current
          .api("voice/stop", { voiceSessionId: credentials.voiceSessionId })
          .catch(() => {});
        return;
      }
      lease.current = credentials.voiceSessionId;
      cancelled.current.clear();
      receiveContext(credentials.context);
      timer.current = setTimeout(
        () =>
          stop(
            "This voice session has ended. Click Voice mode to continue your current plan.",
          ),
        credentials.maxSessionSeconds * 1000,
      );
      await controller.connect(credentials, credentials.context);
    } catch (error) {
      if (run === generation.current)
        stop(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone access was denied. Allow microphone access for this site, then retry."
            : error instanceof Error
              ? error.message
              : "Could not start Voice mode.",
        );
    }
  }
  useEffect(() => {
    if (phase !== "live" || state.revision === revision.current) return;
    let active = true;
    live.current
      .api("voice/context")
      .then((context: Context) => {
        if (!active || !connection.current) return;
        receiveContext(context);
        connection.current.sendContext(
          `The user updated the screen or pressed D2. Use this current backend state; explain the change briefly and continue the next needed question. Do not repeat a completed action. ${JSON.stringify(context)}`,
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [state.revision, phase]);

  async function approve() {
    if (!draft || !lease.current || lock.current) return;
    setApproving(true);
    lock.current = true;
    try {
      const context = await live.current.api("voice/tool", {
        revision: draft.revision,
        voiceSessionId: lease.current,
        callId: crypto.randomUUID(),
        name: "confirm_details",
        args: {
          revision: draft.revision,
          draftId: draft.id,
          userConfirmed: true,
        },
      });
      receiveContext(context);
      connection.current?.sendContext(
        `The user clicked Confirm these details. Backend accepted this readback. Continue from this context: ${JSON.stringify(context)}`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not confirm these details.",
      );
    } finally {
      lock.current = false;
      setApproving(false);
    }
  }
  const supported =
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    "AudioContext" in window &&
    "AudioWorkletNode" in window;
  return (
    <section className="voice-mode" aria-label="TOYO Live voice agent">
      <div className="voice-mode-heading">
        <div>
          <b>Talk to TOYO</b>
          <small role="status">
            {phase === "live"
              ? `Live · ${muted ? "Microphone muted" : activity}`
              : phase === "connecting"
                ? "Connecting to Gemini Live…"
                : "Voice mode is off"}
          </small>
        </div>
        <button
          type="button"
          disabled={
            phase === "off" &&
            (!available || !supported || !!state.reservationId)
          }
          aria-pressed={phase !== "off"}
          onClick={() => (phase === "off" ? void start() : stop())}
        >
          {phase === "off" ? "Voice mode" : "Stop voice mode"}
        </button>
      </div>
      <p>
        {state.stage === "complete"
          ? "Optional reservation dictation: Voice mode sends your spoken name and phone number to Gemini to transcribe and read back. You can type instead. Consent to saving is a separate checkbox below. After reviewing, you can ask TOYO to save your reservation."
          : "TOYO talks you through HQ, the garage, financing, and payment + insurance. It reads back your numbers and explains whether the plan fits. If D2 is unavailable, say “confirm” after TOYO asks you to approve the displayed option, car or final reviewed plan. Say “next car” to keep browsing."}
      </p>
      {!available && (
        <small>
          Live voice is not connected yet. Configure Gemini Live on the backend
          to enable it.
        </small>
      )}
      {!supported && (
        <small>
          Microphone voice mode needs HTTPS or localhost and a browser with
          audio capture support.
        </small>
      )}
      {phase === "live" && (
        <button
          className="voice-mute"
          onClick={() => {
            connection.current?.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? "Unmute microphone" : "Mute microphone"}
        </button>
      )}
      {error && (
        <p className="toyo-error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <div className="voice-readback">
          <h4>Please check what TOYO heard</h4>
          {draft.kind === "finance" && draft.event.finance ? (
            <dl>
              <div>
                <dt>Payment method</dt>
                <dd>{draft.event.finance.method}</dd>
              </div>
              {Object.entries(detailLabels)
                .filter(
                  ([key]) =>
                    draft.event.finance?.method === "loan" ||
                    !["apr", "months", "downPayment"].includes(key),
                )
                .map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {key === "apr"
                        ? `${draft.event.finance![key as keyof Finance]}%`
                        : key === "months"
                          ? `${draft.event.finance!.months} months`
                          : `$${Number(draft.event.finance![key as keyof Finance]).toLocaleString()}`}
                    </dd>
                  </div>
                ))}
              <div>
                <dt>Selected rebate</dt>
                <dd>{draft.quote?.offerName || "None"}</dd>
              </div>
            </dl>
          ) : draft.kind === "reservation" ? (
            <p>
              Name: <b>{draft.event.contact?.name}</b>
              <br />
              Phone: <b>{draft.event.contact?.phone}</b>. Check every digit.
              Confirming fills the form; storage consent and submission are
              still required.
            </p>
          ) : (
            <p>
              {draft.event.insurance?.mode === "included"
                ? "Insurance included in running costs"
                : `Additional insurance: $${draft.event.insurance?.monthly}/month`}
              . This is a simulation, not an insurance policy.
            </p>
          )}
          {draft.quote && <QuoteDetails quote={draft.quote} />}
          <p>
            Say yes after TOYO reads these back, correct any value, or confirm
            below. This saves the plan details, not a purchase.
          </p>
          <button disabled={approving} onClick={() => void approve()}>
            Confirm these details
          </button>
        </div>
      )}
      {transcript.length > 0 && (
        <details className="voice-transcript">
          <summary>Conversation transcript</summary>
          <div aria-live="polite">
            {transcript.map((line, index) => (
              <p key={index}>
                <b>{line.role === "user" ? "You" : "TOYO"}:</b> {line.text}
              </p>
            ))}
          </div>
        </details>
      )}
      <small>
        Uses your computer microphone. Final selection: D2 twice or Choose.
        Final checkout: your magic-wand button.
      </small>
    </section>
  );
}
