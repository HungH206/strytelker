import { useEffect, useRef, useState } from "react";
import { QuoteDetails, type Finance, type Quote } from "./Drive";
import type { Stop } from "./town";
import { useArduinoControls } from "./useArduinoControls";

export type ShoppingStage =
  "hq" | "dealer" | "finance" | "checkout" | "complete";
export const stageLocations: Record<ShoppingStage, Stop> = {
  hq: "hq",
  dealer: "dealer",
  finance: "finance",
  checkout: "insurance",
  complete: "insurance",
};
export type CatalogVehicle = {
  id: string;
  name: string;
  model: string;
  kind: string;
  bodyType: string;
  fuel: string;
  price: number;
  image: string | null;
  imageNote: string;
  source: string;
  sourceDate: string;
  priceLabel: string;
  availability: string;
};
type RebateOffer = {
  id: string;
  name: string;
  rebate_usd: number;
  eligibility: string;
  source_url: string;
  verification_status: string;
};
type ShoppingState = {
  revision: number;
  stage: ShoppingStage;
  question: "kind" | "range";
  option: number;
  profile: { kind?: string; range?: number };
  matches: string[];
  vehicleId: string | null;
  quote: Quote | null;
  finance: Finance | null;
  offerId: string | null;
  reviewed: boolean;
  outcome: string | null;
  confirmationSource: string | null;
  recommendationSource: string;
  recommendation: string;
  browseAll: boolean;
};
const kinds = ["Sedan", "SUV", "Minivans and Trucks"];
const ranges = ["$15,000–$25,000", "$25,000–$40,000", "Over $40,000"];
const defaults: Finance = {
  method: "loan",
  savings: 8000,
  downPayment: 5000,
  reserve: 2000,
  monthlyBudget: 600,
  ownershipCosts: 150,
  apr: 6.5,
  months: 60,
};
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
const financeFields: Array<[keyof Omit<Finance, "method" | "months">, string]> =
  [
    ["savings", "Available savings"],
    ["reserve", "Keep for emergencies"],
    ["monthlyBudget", "Total monthly car budget"],
    ["ownershipCosts", "Monthly running costs"],
    ["downPayment", "Down payment"],
    ["apr", "Illustrative fixed APR"],
  ];

function CarPhoto({ vehicle }: { vehicle: CatalogVehicle }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="toyo-photo">
      {vehicle.image && !failed ? (
        <img
          src={vehicle.image}
          alt={
            vehicle.imageNote ? "User-supplied sedan placeholder" : vehicle.name
          }
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="photo-placeholder">
          <span aria-hidden="true">
            {vehicle.bodyType === "Truck"
              ? "🛻"
              : vehicle.bodyType === "Minivan"
                ? "🚐"
                : "🚙"}
          </span>
          <b>{vehicle.model}</b>
          <small>Photo coming soon</small>
        </div>
      )}
    </div>
  );
}

export default function ShoppingPanel({
  onStageChange,
  navigationRequest,
}: {
  navigationRequest: { stop: Stop; id: number } | null;
  onStageChange: (stage: ShoppingStage) => void;
}) {
  const [state, setState] = useState<ShoppingState | null>(null);
  const [inventory, setInventory] = useState<CatalogVehicle[]>([]);
  const [offers, setOffers] = useState<RebateOffer[]>([]);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [offerEligibility, setOfferEligibility] = useState(false);
  const [gemini, setGemini] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finance, setFinance] = useState<Finance>(defaults);
  const [insuranceMode, setInsuranceMode] = useState<"included" | "additional">(
    "included",
  );
  const [insuranceMonthly, setInsuranceMonthly] = useState(120);
  const [accepted, setAccepted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const token = useRef("");
  const lock = useRef(false);
  const lifecycle = useRef(0);
  const recommendedProfile = useRef("");

  async function api(path: string, body?: unknown) {
    const response = await fetch(`/api/toyo/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Journey-Token": token.current,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "TOYO could not complete that action.");
    return result;
  }
  const arduino = useArduinoControls({ state, busy, lock, api, setState });
  async function start() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const generation = lifecycle.current;
    try {
      if (token.current && state)
        await api("hardware/disarm", { revision: state.revision }).catch(
          () => {},
        );
      const result = await api("sessions", {});
      if (generation !== lifecycle.current) return;
      token.current = result.token;
      setState(result.state);
      setFinance(defaults);
      setOfferId(null);
      setOfferEligibility(false);
      setAccepted(false);
      setInsuranceMode("included");
      arduino.setEnabled(false);
      recommendedProfile.current = "";
    } catch (error) {
      if (generation === lifecycle.current)
        setError(
          error instanceof Error
            ? error.message
            : "Start the backend with npm run dev.",
        );
    } finally {
      lock.current = false;
      if (generation === lifecycle.current) setBusy(false);
    }
  }
  useEffect(() => {
    const generation = ++lifecycle.current;
    api("config")
      .then((config) => {
        if (generation === lifecycle.current) {
          setInventory(config.inventory);
          setOffers(config.offers || []);
          setGemini(config.gemini);
        }
      })
      .catch(() => {
        if (generation === lifecycle.current)
          setError("Start the backend with npm run dev to load the catalog.");
      });
    // A generation guard prevents late responses from replacing a newer session.
    lock.current = false;
    void start();
    return () => {
      lifecycle.current++;
      window.speechSynthesis?.cancel();
    };
  }, []);
  useEffect(() => {
    if (state) onStageChange(state.stage);
  }, [state?.stage, onStageChange]);
  useEffect(() => {
    setAccepted(false);
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    if (state?.stage === "finance") {
      if (state.finance) setFinance(state.finance);
      setOfferId(state.offerId || null);
      setOfferEligibility(!!state.offerId);
    }
  }, [state?.stage]);

  async function act(event: Record<string, unknown>) {
    if (!state || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setState(await api("event", { revision: state.revision, event }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!navigationRequest || !state) return;
    const destination =
      navigationRequest.stop === "insurance"
        ? "checkout"
        : navigationRequest.stop;
    if (
      !["hq", "dealer", "finance", "checkout"].includes(destination) ||
      destination === state.stage ||
      (state.stage === "complete" && destination === "checkout")
    )
      return;
    if (busy) {
      setError(
        "TOYO is updating your plan. Try that location again in a moment.",
      );
      return;
    }
    void act({ type: "VISIT", location: destination });
  }, [navigationRequest]);

  async function recommend() {
    if (!state || lock.current || !gemini) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setState(await api("recommend", { revision: state.revision }));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Model unavailable. Your catalog matches remain available.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (state?.stage === "hq") recommendedProfile.current = "";
    if (state?.stage !== "dealer" || !gemini || busy) return;
    const profileKey = JSON.stringify(state.profile);
    if (recommendedProfile.current === profileKey) return;
    recommendedProfile.current = profileKey;
    void recommend();
  }, [state?.stage, gemini, busy]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        if (!token.current || lock.current) return;
        const currentToken = token.current;
        const latest = await api("session");
        if (!cancelled && !lock.current && currentToken === token.current)
          setState((current) =>
            current && latest.revision > current.revision ? latest : current,
          );
      } catch {
        /* Interactive requests report connection errors. */
      }
    }
    void poll();
    const timer = window.setInterval(poll, 800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const vehicle = inventory.find((car) => car.id === state?.vehicleId);
  const visibleCars = state?.browseAll
    ? inventory
    : inventory.filter((car) => state?.matches.includes(car.id));
  const questionText =
    state?.question === "kind"
      ? kinds[state.option] === "Minivans and Trucks"
        ? "Are you looking for minivans and trucks?"
        : `Would you like ${kinds[state.option] === "SUV" ? "an" : "a"} ${kinds[state.option]}?`
      : `Is your price range ${ranges[state?.option ?? 0]}?`;
  const guidance = !state
    ? "Welcome to TOYO."
    : state.stage === "hq"
      ? questionText
      : state.stage === "dealer"
        ? state.recommendation
        : state.stage === "finance"
          ? "Let’s build a payment plan that leaves room for everyday life."
          : state.stage === "checkout"
            ? "Review your payment assumptions and insurance before using the magic wand."
            : "Your simulation is complete.";
  function readGuidance() {
    if (!("speechSynthesis" in window)) {
      setError("Browser narration is unavailable.");
      return;
    }
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const speech = new SpeechSynthesisUtterance(guidance);
    speech.rate = 0.95;
    speech.onend = speech.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(speech);
  }

  return (
    <div className="toyo-panel" aria-busy={busy}>
      <div className="toyo-guide">
        <div className="toyo-avatar" aria-hidden="true">
          T<span>• •</span>
        </div>
        <div>
          <small>TOYO · YOUR SHOPPING AGENT</small>
          <p aria-live="polite">{guidance}</p>
          <button className="toyo-text-button" onClick={readGuidance}>
            {speaking ? "Stop voice" : "♫ Read TOYO’s guidance"}
          </button>
        </div>
      </div>
      <div className="hardware-card">
        <div>
          <b>
            {arduino.connected ? "● Arduino connected" : "○ Arduino offline"}
          </b>
          <label>
            <input
              type="checkbox"
              checked={arduino.enabled}
              disabled={
                arduino.transport === "browser" && !arduino.browserConnected
              }
              onChange={(event) => arduino.setEnabled(event.target.checked)}
            />
            Enable D2 controls
          </label>
        </div>
        <div className="arduino-connection">
          <label>
            Connection
            <select
              aria-label="Arduino connection"
              value={arduino.transport}
              onChange={(event) =>
                void arduino.changeTransport(
                  event.target.value as "browser" | "local",
                )
              }
            >
              <option value="browser">Browser USB · hosted website</option>
              <option value="local">Local server bridge</option>
            </select>
          </label>
          {arduino.transport === "browser" && (
            <>
              <button
                type="button"
                disabled={
                  arduino.connecting ||
                  (!arduino.browserSupported && !arduino.browserConnected)
                }
                onClick={() =>
                  void (arduino.browserConnected
                    ? arduino.disconnect()
                    : arduino.connect())
                }
              >
                {arduino.connecting
                  ? "Connecting…"
                  : arduino.browserConnected
                    ? "Disconnect Arduino"
                    : "Connect Arduino"}
              </button>
              {!arduino.browserSupported && (
                <small>
                  USB serial needs HTTPS (or localhost) and a supported desktop
                  browser such as Chrome.
                </small>
              )}
              <small>
                Connect the Arduino to this computer, close Serial Monitor, then
                choose its port. No local Node bridge is needed.
              </small>
            </>
          )}
          {arduino.transport === "local" && (
            <small>
              Uses the Arduino attached to the backend computer through
              ARDUINO_PORT.
            </small>
          )}
        </div>
        <p>
          {state?.stage === "hq"
            ? "1 press = Yes · 2 quick presses = No"
            : state?.stage === "dealer"
              ? "1 press = Next car · 2 quick presses = Choose car"
              : "After review: 1 press = Magic wand confirmation"}
        </p>
        <small role="status">{arduino.status}</small>
      </div>
      {error && (
        <div role="alert" className="toyo-error">
          {error}
        </div>
      )}
      {!state ? (
        <button className="primary-button" disabled={busy} onClick={start}>
          {busy ? "Opening TOYO HQ…" : "Start at TOYO HQ"}
        </button>
      ) : (
        <>
          {state.stage === "hq" && (
            <section className="toyo-card">
              <span className="toyo-eyebrow">01 / AGENT HEADQUARTERS</span>
              <h2>Let’s find your fit.</h2>
              <p className="toyo-muted">
                Two questions. Your preferences guide the recommendation.
              </p>
              <div className="question-card">
                <small>
                  QUESTION{" "}
                  {state.question === "kind"
                    ? "1 · BODY STYLE"
                    : "2 · PRICE RANGE"}
                </small>
                <h3>{questionText}</h3>
                <div className="question-options">
                  {(state.question === "kind" ? kinds : ranges).map(
                    (label, index) => (
                      <span
                        key={label}
                        className={state.option === index ? "current" : ""}
                      >
                        {label}
                      </span>
                    ),
                  )}
                </div>
                <div className="toyo-two-buttons">
                  <button
                    disabled={busy}
                    onClick={() => act({ type: "ANSWER", yes: true })}
                  >
                    1 · Yes
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => act({ type: "ANSWER", yes: false })}
                  >
                    2 · No, next option
                  </button>
                </div>
              </div>
              {state.profile.kind && (
                <p className="toyo-muted">
                  Body style selected: <b>{state.profile.kind}</b>
                </p>
              )}
              <p className="toyo-footnote">
                “Minivans and Trucks” includes the Tacoma pickup and Sienna
                minivan. Price bands refer to vehicle MSRP before fees. $25,000
                belongs to the middle band.
              </p>
            </section>
          )}
          {state.stage === "dealer" && (
            <section className="toyo-card">
              <span className="toyo-eyebrow">02 / TOYOTA DEALERSHIP</span>
              <h2>Your garage stash.</h2>
              <p className="toyo-muted">
                {state.profile.kind} · {ranges[state.profile.range ?? 0]} ·{" "}
                {state.recommendationSource === "gemini"
                  ? "Gemini selected your match"
                  : "Catalog matching"}
              </p>
              <div className="rebate-banner">
                <b>College Rebate · $500</b>
                <b>Military Cash Rebate · $500</b>
                <small>
                  Choose one in the financial district · eligibility and
                  financing required
                </small>
              </div>
              {gemini && (
                <button
                  className="toyo-text-button"
                  disabled={busy || !state.matches.length}
                  onClick={recommend}
                >
                  ✧ Ask TOYO to choose again
                </button>
              )}
              {vehicle ? (
                <>
                  <div className="garage-stage">
                    <div className="stage-light" />
                    <CarPhoto key={vehicle.id} vehicle={vehicle} />
                    <span>
                      {vehicle.bodyType} · {vehicle.fuel}
                    </span>
                    <h3>{vehicle.name}</h3>
                    <p>{money(vehicle.price)} · Starting MSRP</p>
                  </div>
                  {vehicle.imageNote && (
                    <p className="toyo-footnote">{vehicle.imageNote}</p>
                  )}
                  <div className="inventory-price">
                    <strong>{money(vehicle.price)}</strong>
                    <span>
                      Starting MSRP · catalog observed {vehicle.sourceDate}
                      <a href={vehicle.source} target="_blank" rel="noreferrer">
                        Toyota model details ↗
                      </a>
                    </span>
                  </div>
                  {!state.matches.includes(vehicle.id) && (
                    <p className="toyo-warning">
                      This vehicle is outside your HQ preferences. You can still
                      choose it and review affordability.
                    </p>
                  )}
                  <div className="toyo-two-buttons">
                    <button
                      disabled={busy}
                      onClick={() => act({ type: "NEXT_CAR" })}
                    >
                      1 · Next car →
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => act({ type: "CHOOSE_CAR" })}
                    >
                      2 · Choose this car
                    </button>
                  </div>
                </>
              ) : (
                <div className="toyo-empty">
                  <h3>No exact match in this catalog.</h3>
                  <p>
                    Adjust your body style or price band, or browse all ten
                    models.
                  </p>
                </div>
              )}
              <button
                className="toyo-text-button"
                disabled={busy}
                onClick={() => act({ type: "BROWSE_ALL" })}
              >
                {state.browseAll ? "Show my matches" : "Browse all inventory"}
              </button>
              <div className="toyo-inventory">
                {visibleCars.map((car) => (
                  <button
                    key={car.id}
                    disabled={busy}
                    aria-pressed={car.id === vehicle?.id}
                    onClick={() =>
                      act({ type: "INSPECT_CAR", vehicleId: car.id })
                    }
                  >
                    <CarPhoto vehicle={car} />
                    <span>
                      <b>{car.model}</b>
                      <small>
                        {car.bodyType} · {car.fuel}
                      </small>
                    </span>
                    <strong>{money(car.price)}</strong>
                  </button>
                ))}
              </div>
              <p className="toyo-footnote">
                Prices come from your supplied catalog, not live dealer
                inventory. MSRP excludes delivery, tax, title, registration and
                dealer charges. Photos are supplied illustrations; exact model
                year and trim may differ.
              </p>
              <button
                className="back-story"
                disabled={busy}
                onClick={() => act({ type: "BACK" })}
              >
                ← Change HQ preferences
              </button>
            </section>
          )}
          {state.stage === "finance" && (
            <section className="toyo-card">
              <span className="toyo-eyebrow">03 / FINANCIAL DISTRICT</span>
              <h2>Give the plan some room.</h2>
              <p className="toyo-muted">
                {vehicle?.name} · {money(vehicle?.price ?? 0)} starting MSRP
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act({
                    type: "FINANCE",
                    finance,
                    offerId,
                    eligibilityAcknowledged: offerEligibility,
                  });
                }}
              >
                <fieldset disabled={busy} className="toyo-finance">
                  <legend>Payment plan assumptions</legend>
                  <div className="toyo-two-buttons">
                    {(["loan", "cash"] as const).map((method) => (
                      <button
                        type="button"
                        key={method}
                        aria-pressed={finance.method === method}
                        onClick={() => {
                          setFinance((current) => ({ ...current, method }));
                          if (method === "cash") {
                            setOfferId(null);
                            setOfferEligibility(false);
                          }
                        }}
                      >
                        {method === "loan"
                          ? "Illustrative loan"
                          : "Pay in full"}
                      </button>
                    ))}
                  </div>
                  <div className="toyo-fields">
                    {financeFields
                      .filter(
                        ([key]) =>
                          finance.method === "loan" ||
                          !["downPayment", "apr"].includes(key),
                      )
                      .map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <div>
                            <span>{key === "apr" ? "%" : "$"}</span>
                            <input
                              type="number"
                              required
                              min="0"
                              max={key === "apr" ? 35 : 1000000}
                              step={key === "apr" ? 0.1 : 1}
                              value={finance[key]}
                              onChange={(event) =>
                                setFinance((current) => ({
                                  ...current,
                                  [key]:
                                    event.target.value === ""
                                      ? 0
                                      : event.target.valueAsNumber,
                                }))
                              }
                            />
                          </div>
                        </label>
                      ))}
                    {finance.method === "loan" && (
                      <label>
                        Loan term
                        <select
                          value={finance.months}
                          onChange={(event) =>
                            setFinance((current) => ({
                              ...current,
                              months: Number(event.target.value),
                            }))
                          }
                        >
                          {[36, 48, 60, 72].map((months) => (
                            <option key={months} value={months}>
                              {months} months
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="toyo-offers">
                    <h3>Your rebate offers</h3>
                    <p>
                      Choose one $500 rebate, assuming qualifying Toyota
                      Financial Services financing.
                    </p>
                    <label className="toyo-radio">
                      <input
                        type="radio"
                        name="rebate"
                        checked={offerId === null}
                        onChange={() => {
                          setOfferId(null);
                          setOfferEligibility(false);
                        }}
                      />
                      No rebate
                    </label>
                    {offers.map((offer) => (
                      <div className="rebate-option" key={offer.id}>
                        <label className="toyo-radio">
                          <input
                            type="radio"
                            name="rebate"
                            disabled={finance.method !== "loan"}
                            checked={offerId === offer.id}
                            onChange={() => {
                              setOfferId(offer.id);
                              setOfferEligibility(false);
                            }}
                          />
                          <span>
                            <b>
                              {offer.name} · {money(offer.rebate_usd)}
                            </b>
                            <small>{offer.eligibility}</small>
                          </span>
                        </label>
                        <a
                          href={offer.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Program details ↗
                        </a>
                      </div>
                    ))}
                    {finance.method === "cash" && (
                      <p>
                        These programs require financing; rebates are
                        unavailable for pay-in-full plans.
                      </p>
                    )}
                    {offerId && (
                      <label className="agreement-check">
                        <input
                          type="checkbox"
                          required
                          checked={offerEligibility}
                          onChange={(event) =>
                            setOfferEligibility(event.target.checked)
                          }
                        />
                        <span>
                          Assume I qualify for this rebate in the simulation.
                          Actual eligibility and local availability require
                          verification.
                        </span>
                      </label>
                    )}
                    <small>
                      College and Military rebates cannot be combined. The
                      selected rebate reduces the amount financed; it is not
                      cash paid to you.
                    </small>
                  </div>
                </fieldset>
                <p className="toyo-footnote">
                  The calculator adds $2,200 in assumed fees. Monthly budget
                  includes the payment and running costs. Insurance can be
                  included in running costs or added at checkout.
                </p>
                <button className="primary-button" disabled={busy}>
                  Calculate & visit payment + insurance →
                </button>
              </form>
              <button
                className="back-story"
                disabled={busy}
                onClick={() => act({ type: "BACK" })}
              >
                ← Back to the garage
              </button>
            </section>
          )}
          {state.stage === "checkout" && state.quote && (
            <section className="toyo-card">
              <span className="toyo-eyebrow">
                04 / PAYMENT + INSURANCE OFFICE
              </span>
              <h2>Review. Then make it yours.</h2>
              <p className="toyo-muted">{vehicle?.name}</p>
              <div className="story-panel">
                <QuoteDetails quote={state.quote} />
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act({
                    type: "INSURANCE",
                    insurance: {
                      mode: insuranceMode,
                      monthly:
                        insuranceMode === "included" ? 0 : insuranceMonthly,
                      accepted,
                    },
                  });
                }}
              >
                <fieldset
                  disabled={busy || state.reviewed}
                  className="toyo-finance"
                >
                  <legend>Insurance planning</legend>
                  <label className="toyo-radio">
                    <input
                      type="radio"
                      name="insurance"
                      checked={insuranceMode === "included"}
                      onChange={() => setInsuranceMode("included")}
                    />
                    Insurance is included in my running costs
                  </label>
                  <label className="toyo-radio">
                    <input
                      type="radio"
                      name="insurance"
                      checked={insuranceMode === "additional"}
                      onChange={() => setInsuranceMode("additional")}
                    />
                    Add a separate monthly insurance estimate
                  </label>
                  {insuranceMode === "additional" && (
                    <label className="toyo-insurance-cost">
                      Monthly insurance estimate ($)
                      <input
                        type="number"
                        min="0"
                        max="1000000"
                        step="1"
                        required
                        value={insuranceMonthly}
                        onChange={(event) =>
                          setInsuranceMonthly(event.target.valueAsNumber)
                        }
                      />
                    </label>
                  )}
                  <label className="agreement-check">
                    <input
                      required
                      type="checkbox"
                      checked={accepted}
                      onChange={(event) => setAccepted(event.target.checked)}
                    />
                    <span>
                      I reviewed these payment and insurance assumptions. This
                      is a simulation; no insurance policy or real payment is
                      created.
                    </span>
                  </label>
                </fieldset>
                {!state.reviewed && (
                  <button
                    className="primary-button"
                    disabled={busy || !accepted}
                  >
                    Review insurance & update total
                  </button>
                )}
              </form>
              {state.reviewed && (
                <>
                  <div
                    className={`toyo-result ${state.quote.eligible ? "fits" : "needs-work"}`}
                  >
                    {state.quote.eligible
                      ? "✓ Fits your entered assumptions"
                      : "A different plan is needed"}
                  </div>
                  {state.quote.reasons.length > 0 && (
                    <ul className="toyo-reasons">
                      {state.quote.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <div className="toyo-wand">
                    <span aria-hidden="true">✧</span>
                    <h3>The magic is your decision.</h3>
                    <p>
                      {state.quote.eligible
                        ? "Confirm a simulated purchase and collect your digital key."
                        : "Finish with a savings plan, or revise the numbers."}
                    </p>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => act({ type: "CONFIRM" })}
                    >
                      ✦ Wave the magic wand
                    </button>
                    <small>Or enable D2 and press once.</small>
                  </div>
                </>
              )}
              <button
                className="back-story"
                disabled={busy}
                onClick={() => act({ type: "BACK" })}
              >
                ← Revise financing and insurance
              </button>
            </section>
          )}
          {state.stage === "complete" && (
            <section className="toyo-card complete-story">
              <div className="success-seal">
                {state.outcome === "simulated_purchase" ? "🔑" : "✧"}
              </div>
              <span>
                {state.outcome === "simulated_purchase"
                  ? "YOUR DIGITAL KEY IS READY"
                  : "YOUR NEXT STEP IS READY"}
              </span>
              <h2>
                {state.outcome === "simulated_purchase"
                  ? "You found your Toyota."
                  : "A smarter plan starts here."}
              </h2>
              {vehicle && (
                <>
                  <CarPhoto vehicle={vehicle} />
                  <h3>{vehicle.name}</h3>
                </>
              )}
              <p className="toyo-muted">
                {state.outcome === "simulated_purchase"
                  ? "TOYO helped you compare, plan and confirm a simulated purchase."
                  : "This plan does not fit your entered assumptions yet. Keep your savings and revisit your options."}
              </p>
              <div className="confirmation">
                <b>
                  {state.confirmationSource === "hardware"
                    ? "Confirmed by your Arduino magic wand"
                    : state.confirmationSource === "browser_serial"
                      ? "Confirmed through browser USB serial"
                      : "Confirmed with the browser magic wand"}
                </b>
                <p>
                  No money moved. No loan application or insurance policy was
                  created.
                </p>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={start}
              >
                Start a new TOYO journey ↗
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
