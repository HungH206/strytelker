import { useEffect, useRef, useState } from "react";
import "./Drive.css";
type Vehicle = {
  id: string;
  name: string;
  price: number;
  character: string;
  description: string;
};
export type Finance = {
  method: "cash" | "loan";
  savings: number;
  downPayment: number;
  reserve: number;
  monthlyBudget: number;
  ownershipCosts: number;
  apr: number;
  months: number;
};
export type Quote = {
  rebate?: number;
  offerName?: string | null;
  appliedOfferId?: string | null;
  price: number;
  fees: number;
  estimatedOtdPrice?: number;
  feeSource?: string;
  total: number;
  principal: number;
  monthly: number;
  interest: number;
  totalPaid: number;
  monthlyWithOwnership: number;
  cashRemaining: number;
  cashShortfall: number;
  eligible: boolean;
  reasons: string[];
  assumptions: Finance;
};
type Journey = {
  chapter: number;
  revision: number;
  vehicleId: string | null;
  quote: Quote | null;
  outcome: string | null;
  confirmationSource: string | null;
  dialogue: string;
  dialogueSource: string;
};
type Config = { vehicles: Vehicle[]; gemini: boolean; elevenLabs: boolean };
const initialFinance: Finance = {
  method: "loan",
  savings: 8000,
  downPayment: 5000,
  reserve: 2000,
  monthlyBudget: 600,
  ownershipCosts: 150,
  apr: 6.5,
  months: 60,
};
const chapters = [
  "A wish for freedom",
  "The royal showroom",
  "The financial crossroads",
  "The magic confirmation",
  "Your next chapter",
];
const dollars = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
export default function Drive({
  onChapterChange,
}: {
  onChapterChange?: (chapter: number) => void;
}) {
  const [config, setConfig] = useState<Config | null>(null),
    [journey, setJourney] = useState<Journey | null>(null),
    [finance, setFinance] = useState(initialFinance),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [speaking, setSpeaking] = useState(false),
    [voiceStatus, setVoiceStatus] = useState("");
  useEffect(() => {
    if (journey) onChapterChange?.(journey.chapter);
  }, [journey?.chapter, onChapterChange]);
  const token = useRef(""),
    lock = useRef(false),
    audio = useRef<HTMLAudioElement | null>(null),
    audioUrl = useRef(""),
    audioController = useRef<AbortController | null>(null),
    speechSequence = useRef(0),
    alive = useRef(true);
  function stop() {
    speechSequence.current++;
    audioController.current?.abort();
    audio.current?.pause();
    audio.current = null;
    if (audioUrl.current) {
      URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = "";
    }
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }
  async function api(path: string, body?: unknown) {
    const r = await fetch(`/api/drive/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Journey-Token": token.current,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "The story could not continue.");
    return data;
  }
  async function start() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    stop();
    try {
      const result = await api("journeys", {});
      if (alive.current) {
        token.current = result.token;
        setJourney(result.state);
        setFinance(initialFinance);
        setVoiceStatus("");
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Could not start the story.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    api("config")
      .then((c) => {
        if (alive.current) setConfig(c);
      })
      .catch(() => {
        if (alive.current)
          setError("Start the backend with npm run dev to load the showroom.");
      });
    void start();
    return () => {
      alive.current = false;
      stop();
    };
  }, []);
  async function act(event: Record<string, unknown>) {
    if (!journey || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    stop();
    setVoiceStatus("");
    try {
      setJourney(await api("event", { revision: journey.revision, event }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function armArduino() {
    if (!journey || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("hardware/arm", { revision: journey.revision });
      setVoiceStatus(
        "Arduino armed for 30 seconds. Release, then press the physical button.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not arm Arduino.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (journey?.chapter !== 4) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (lock.current) return;
      const revision = journey.revision;
      try {
        const latest = await api("journey");
        if (!cancelled && !lock.current && latest.revision > revision) {
          stop();
          setJourney((current) =>
            current?.revision === revision ? latest : current,
          );
        }
      } catch {
        /* Explicit actions report expired sessions and connection errors. */
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [journey?.chapter, journey?.revision]);
  async function personalize() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    stop();
    try {
      setJourney(await api("dialogue", {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lumi could not connect.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function browserVoice() {
    stop();
    if (!journey || !("speechSynthesis" in window)) {
      setVoiceStatus(
        "Browser narration is unavailable. You can still read the scene.",
      );
      return;
    }
    const speech = new SpeechSynthesisUtterance(journey.dialogue);
    speech.rate = 0.9;
    const sequence = speechSequence.current;
    speech.onend = () => {
      if (sequence === speechSequence.current) setSpeaking(false);
    };
    speech.onerror = speech.onend;
    setSpeaking(true);
    setVoiceStatus("Browser voice");
    window.speechSynthesis.speak(speech);
  }
  async function narrate() {
    if (speaking) {
      stop();
      return;
    }
    if (!config?.elevenLabs) {
      browserVoice();
      return;
    }
    stop();
    const sequence = speechSequence.current;
    const controller = new AbortController();
    audioController.current = controller;
    setSpeaking(true);
    setVoiceStatus("Preparing ElevenLabs narration…");
    try {
      const r = await fetch("/api/drive/narration", {
        method: "POST",
        headers: { "X-Journey-Token": token.current },
        signal: controller.signal,
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error);
      }
      const blob = await r.blob();
      if (sequence !== speechSequence.current) return;
      audioUrl.current = URL.createObjectURL(blob);
      audio.current = new Audio(audioUrl.current);
      audio.current.onended = () => {
        stop();
      };
      audio.current.onerror = () => {
        setVoiceStatus("Audio playback failed. Try browser voice.");
        stop();
      };
      await audio.current.play();
      setVoiceStatus("ElevenLabs voice");
    } catch (e) {
      if (controller.signal.aborted) return;
      setSpeaking(false);
      setVoiceStatus(
        e instanceof Error
          ? e.message
          : "Voice unavailable. Try browser voice.",
      );
    }
  }
  const vehicle = config?.vehicles.find((v) => v.id === journey?.vehicleId),
    quote = journey?.quote;
  const fields: Array<[keyof Finance, string]> = [
    ["savings", "Available savings"],
    ["reserve", "Keep for emergencies"],
    ["monthlyBudget", "Total monthly car budget"],
    ["ownershipCosts", "Monthly running costs"],
  ];
  function numberField(key: keyof Finance, label: string) {
    return (
      <label key={key}>
        {label}
        <div className="drive-input">
          <span>{key === "apr" ? "%" : "$"}</span>
          <input
            type="number"
            min="0"
            max={key === "apr" ? 35 : 1000000}
            step={key === "apr" ? 0.1 : 50}
            required
            value={finance[key]}
            onChange={(e) =>
              setFinance({
                ...finance,
                [key]: e.target.value === "" ? 0 : e.target.valueAsNumber,
              })
            }
          />
        </div>
      </label>
    );
  }
  return (
    <div className="drive-app">
      <header className="drive-header">
        <a href="/" className="drive-brand">
          ✧{" "}
          <span>
            Once Upon <em>a Drive</em>
          </span>
        </a>
        <span className="drive-badge">AN INTERACTIVE FAIRYTALE</span>
        <a href="/?lumi">Visit LumiWorld ↗</a>
      </header>
      <main className="drive-main">
        <div className="drive-intro">
          <p className="eyebrow">CINDERELLA’S FIRST RIDE</p>
          <h1>
            A little magic.
            <br />
            <em>A thoughtful first step.</em>
          </h1>
          <p>
            Help Cinderella find a Toyota that fits her dreams—and her life.
          </p>
          <span className="simulation-label">
            Educational simulation · Fictional prices and loan terms
          </span>
        </div>
        <ol className="drive-chapters" aria-label="Story progress">
          {chapters.map((name, i) => (
            <li
              key={name}
              className={
                journey && journey.chapter === i + 1
                  ? "current"
                  : journey && journey.chapter > i + 1
                    ? "done"
                    : ""
              }
              aria-current={journey?.chapter === i + 1 ? "step" : undefined}
            >
              <span>{journey && journey.chapter > i + 1 ? "✓" : i + 1}</span>
              {name}
            </li>
          ))}
        </ol>
        {journey ? (
          <div className="drive-layout">
            <aside className="drive-story">
              <div className="carriage-art" aria-hidden="true">
                <span className="drive-moon">☾</span>
                <span className="drive-sparkles">
                  ✧　　　✦
                  <br />
                  　　·　　　　✧
                </span>
                <div className="road" />
                <div className={`car-silhouette ${vehicle?.id || ""}`}>
                  <div className="car-top" />
                  <div className="car-body" />
                  <i />
                  <i />
                </div>
                <span className="art-title">
                  {vehicle?.name || "Your story starts here"}
                </span>
              </div>
              <div className="drive-dialogue">
                <div className="dialogue-meta">
                  <span>✦ LUMI, YOUR STORY COMPANION</span>
                  <span>
                    {journey.dialogueSource === "gemini"
                      ? "Gemini"
                      : "Scripted scene"}
                  </span>
                </div>
                <h2>{chapters[journey.chapter - 1]}</h2>
                <p aria-live="polite">{journey.dialogue}</p>
                <div className="voice-actions">
                  <button disabled={busy} onClick={narrate}>
                    {speaking ? "■ Stop narration" : "♫ Read the scene"}
                  </button>
                  {config?.elevenLabs && (
                    <button disabled={busy} onClick={browserVoice}>
                      Browser voice
                    </button>
                  )}
                  <button
                    disabled={busy || !config?.gemini}
                    onClick={personalize}
                  >
                    {busy ? "One moment…" : "✧ Personalize with Gemini"}
                  </button>
                </div>
                <small role="status">
                  {voiceStatus ||
                    (!config?.gemini
                      ? "Add a Gemini key to personalize the dialogue."
                      : "Gemini personalizes dialogue. Story rules stay consistent.")}
                </small>
              </div>
            </aside>
            <section className="drive-panel" aria-busy={busy}>
              <p className="eyebrow">CHAPTER 0{journey.chapter} / 05</p>
              {journey.chapter === 1 && (
                <>
                  <h2>Choose her next carriage.</h2>
                  <p className="drive-muted">
                    Three possibilities. One new beginning.
                  </p>
                  <div className="vehicle-list">
                    {config?.vehicles.map((v, i) => (
                      <button
                        disabled={busy}
                        key={v.id}
                        onClick={() =>
                          act({ type: "SELECT_VEHICLE", vehicleId: v.id })
                        }
                      >
                        <span className="vehicle-number">0{i + 1}</span>
                        <span>
                          <small>{v.character}</small>
                          <strong>{v.name}</strong>
                          <p>{v.description}</p>
                        </span>
                        <span className="vehicle-price">
                          {dollars(v.price)}
                          <small>demo price →</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="drive-callout">
                    Prices are seeded for this story. They are not current
                    MSRPs, dealer quotes, or available offers.
                  </div>
                </>
              )}
              {journey.chapter === 2 && (
                <>
                  <h2>
                    A closer look at the {vehicle?.name.replace("Toyota ", "")}.
                  </h2>
                  <p className="drive-muted">
                    A thoughtful choice includes the full picture.
                  </p>
                  <dl className="quote-list">
                    <div>
                      <dt>Illustrative vehicle price</dt>
                      <dd>{dollars(vehicle?.price || 0)}</dd>
                    </div>
                    <div>
                      <dt>Assumed taxes & fees</dt>
                      <dd>{dollars(2200)}</dd>
                    </div>
                    <div className="total">
                      <dt>Illustrative purchase total</dt>
                      <dd>{dollars((vehicle?.price || 0) + 2200)}</dd>
                    </div>
                  </dl>
                  <div className="drive-callout">
                    Fuel, insurance, maintenance, and registration can change
                    the monthly cost. We’ll include your running-cost estimate
                    in the next chapter.
                  </div>
                  <button
                    className="drive-primary"
                    disabled={busy}
                    onClick={() => act({ type: "ACCEPT_VEHICLE" })}
                  >
                    Explore the payment options →
                  </button>
                  <button
                    className="drive-secondary"
                    disabled={busy}
                    onClick={() => act({ type: "COMPARE" })}
                  >
                    Compare a different Toyota
                  </button>
                </>
              )}
              {journey.chapter === 3 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act({ type: "PREPARE_OFFER", finance });
                  }}
                >
                  <h2>Give the dream a plan.</h2>
                  <p className="drive-muted">
                    Try different assumptions for {vehicle?.name}.
                  </p>
                  <fieldset disabled={busy} className="drive-finance">
                    <legend>How will Cinderella pay?</legend>
                    <div className="payment-options">
                      {(["cash", "loan"] as const).map((method) => (
                        <button
                          type="button"
                          aria-pressed={finance.method === method}
                          className={
                            finance.method === method ? "selected" : ""
                          }
                          key={method}
                          onClick={() => setFinance({ ...finance, method })}
                        >
                          {method === "cash"
                            ? "Pay in full"
                            : "Illustrative loan"}
                        </button>
                      ))}
                    </div>
                    <div className="finance-fields">
                      {fields.map(([key, label]) => numberField(key, label))}
                      {finance.method === "loan" && (
                        <>
                          {numberField("downPayment", "Down payment")}
                          {numberField("apr", "Illustrative fixed APR")}
                          <label>
                            Loan term
                            <select
                              value={finance.months}
                              onChange={(e) =>
                                setFinance({
                                  ...finance,
                                  months: Number(e.target.value),
                                })
                              }
                            >
                              {[36, 48, 60, 72].map((n) => (
                                <option key={n} value={n}>
                                  {n} months
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                  </fieldset>
                  <p className="drive-footnote">
                    Monthly budget includes loan payment and estimated running
                    costs. APR and fees are assumptions. Affordability here is a
                    simplified budget check, not lender approval.
                  </p>
                  <button
                    className="drive-primary"
                    disabled={busy}
                    type="submit"
                  >
                    Calculate & review the plan →
                  </button>
                </form>
              )}
              {journey.chapter === 4 && quote && (
                <>
                  <h2>
                    {quote.eligible
                      ? "A plan with room to dream."
                      : "A pause can be a wise choice."}
                  </h2>
                  <div
                    className={`eligibility ${quote.eligible ? "fits" : "needs-work"}`}
                  >
                    {quote.eligible
                      ? "✓ Fits the entered assumptions"
                      : "◇ Needs a different plan"}
                  </div>
                  <QuoteDetails quote={quote} />
                  {quote.reasons.length > 0 && (
                    <ul className="finance-reasons">
                      {quote.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  <div className="magic-gate">
                    <span>✦</span>
                    <h3>The Magic Confirmation</h3>
                    <p>
                      {quote.eligible
                        ? "Confirm this pretend purchase to finish the story."
                        : "Finish with a hopeful savings-plan ending, or revise the plan below."}
                    </p>
                    <button
                      className="drive-primary"
                      disabled={busy}
                      onClick={() =>
                        act({ type: "CONFIRM", source: "simulator" })
                      }
                    >
                      Simulate Magic Button press ✧
                    </button>
                    <button
                      className="drive-secondary"
                      disabled={busy}
                      onClick={armArduino}
                    >
                      Arm Arduino button
                    </button>
                    <small>
                      USB Arduino · Arm, then press your physical button within
                      30 seconds.
                    </small>
                  </div>
                  <div className="drive-button-row">
                    <button
                      className="drive-secondary"
                      disabled={busy}
                      onClick={() => act({ type: "REVISE" })}
                    >
                      Revise the numbers
                    </button>
                    <button
                      className="drive-secondary"
                      disabled={busy}
                      onClick={() => act({ type: "COMPARE" })}
                    >
                      Compare cars
                    </button>
                  </div>
                </>
              )}
              {journey.chapter === 5 && quote && (
                <>
                  <div className="drive-ending">
                    <span>
                      {journey.outcome === "simulated_purchase" ? "🗝" : "✧"}
                    </span>
                    <p className="eyebrow">
                      {journey.outcome === "simulated_purchase"
                        ? "A PRETEND KEY. A REAL LESSON."
                        : "EVERY DREAM DESERVES A PLAN."}
                    </p>
                    <h2>
                      {journey.outcome === "simulated_purchase"
                        ? "Her next chapter awaits."
                        : "The journey is still beginning."}
                    </h2>
                    <p>
                      {journey.outcome === "simulated_purchase"
                        ? `${vehicle?.name} fits the assumptions in this story. Cinderella has confirmed a simulated purchase.`
                        : "Cinderella keeps her savings and takes home a plan to revisit."}
                    </p>
                  </div>
                  <QuoteDetails quote={quote} />
                  {journey.outcome === "savings_plan" && (
                    <div className="drive-callout">
                      {quote.cashShortfall > 0
                        ? `${dollars(quote.cashShortfall)} more savings would cover this plan’s upfront cost while preserving the chosen reserve. `
                        : ""}
                      {quote.monthlyWithOwnership >
                      quote.assumptions.monthlyBudget
                        ? `The monthly estimate is ${dollars(quote.monthlyWithOwnership - quote.assumptions.monthlyBudget)} over budget. `
                        : ""}
                      Compare a lower-priced car, review running costs, or
                      revisit the savings and payment plan.
                    </div>
                  )}
                  <p className="drive-footnote">
                    Confirmed through{" "}
                    {journey.confirmationSource === "hardware"
                      ? "the Arduino button"
                      : "the browser simulator"}
                    . No payment, credit check, loan application, or binding
                    agreement was made.
                  </p>
                  <button
                    className="drive-primary"
                    disabled={busy}
                    onClick={start}
                  >
                    Begin a new fairytale ↗
                  </button>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="drive-loading" role="status">
            {busy ? "Opening the storybook…" : "The story is ready to begin."}
            <button className="drive-primary" disabled={busy} onClick={start}>
              Start story
            </button>
          </div>
        )}
        {error && (
          <div className="drive-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <span>Once Upon a Drive · Hackathon prototype</span>
          <span>
            Fictional educational experience. Not affiliated with Toyota.
          </span>
        </footer>
      </main>
    </div>
  );
}
export function QuoteDetails({ quote: q }: { quote: Quote }) {
  return (
    <dl className="quote-list">
      <div>
        <dt>Base MSRP</dt>
        <dd>{dollars(q.price)}</dd>
      </div>
      <div>
        <dt>
          Estimated taxes & fees
          <small>{q.feeSource || "Illustrative fee assumption"}</small>
        </dt>
        <dd>{dollars(q.fees)}</dd>
      </div>
      <div>
        <dt>Estimated OTD before rebate and loan interest</dt>
        <dd>{dollars(q.estimatedOtdPrice ?? q.price + q.fees)}</dd>
      </div>
      {!!q.rebate && (
        <>
          <div>
            <dt>
              {q.offerName || "Selected rebate"}
              <small>Assumed eligibility · simulation</small>
            </dt>
            <dd>−{dollars(q.rebate)}</dd>
          </div>
          <div className="total">
            <dt>Total after rebate</dt>
            <dd>{dollars(q.total)}</dd>
          </div>
        </>
      )}
      {q.assumptions.method === "loan" && (
        <>
          <div>
            <dt>Down payment</dt>
            <dd>{dollars(q.assumptions.downPayment)}</dd>
          </div>
          <div>
            <dt>Amount financed</dt>
            <dd>{dollars(q.principal)}</dd>
          </div>
          <div className="total">
            <dt>
              Monthly loan payment
              <small>
                {q.assumptions.months} months · {q.assumptions.apr}% fixed APR
              </small>
            </dt>
            <dd>{dollars(q.monthly)}</dd>
          </div>
          <div>
            <dt>Total interest (estimate)</dt>
            <dd>{dollars(q.interest)}</dd>
          </div>
          <div>
            <dt>Total purchase + interest</dt>
            <dd>{dollars(q.totalPaid)}</dd>
          </div>
        </>
      )}
      <div>
        <dt>Monthly ownership estimate</dt>
        <dd>{dollars(q.assumptions.ownershipCosts)}</dd>
      </div>
      <div className="total">
        <dt>
          Total estimated monthly cost
          <small>Budget: {dollars(q.assumptions.monthlyBudget)}</small>
        </dt>
        <dd>{dollars(q.monthlyWithOwnership)}</dd>
      </div>
      <div>
        <dt>
          Savings after upfront payment
          <small>Protected reserve: {dollars(q.assumptions.reserve)}</small>
        </dt>
        <dd>{dollars(q.cashRemaining)}</dd>
      </div>
    </dl>
  );
}
