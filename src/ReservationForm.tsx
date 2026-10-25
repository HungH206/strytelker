import {
  useEffect,
  useState,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import type { ShoppingState } from "./ShoppingPanel";
import { readApiJson } from "./api-json.mjs";

export default function ReservationForm({
  token,
  state,
  api,
  setState,
  contact,
  voicePending,
  onBusy,
  lock,
}: {
  token: string;
  state: ShoppingState;
  api: (path: string, body?: unknown) => Promise<any>;
  setState: Dispatch<SetStateAction<ShoppingState | null>>;
  contact: { id: string; name: string; phone: string } | null;
  voicePending: boolean;
  onBusy: (value: boolean) => void;
  lock: MutableRefObject<boolean>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const receipt = state.reservationId || "";
  useEffect(() => {
    if (contact && !state.reservationReady && !receipt) {
      setName(contact.name);
      setPhone(contact.phone);
      setConsent(false);
      setReviewed(false);
    }
  }, [contact?.id]);
  async function action(path: string, body: Record<string, unknown> = {}) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const latest = await api(path, { revision: state.revision, ...body });
      setState(latest);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Reservation request failed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (voicePending) return;
    await action(
      state.reservationReady ? "reservation" : "reservation/prepare",
      state.reservationReady
        ? {}
        : { contact: { name, phone, consent }, reviewed },
    );
  }
  async function download(format: "json" | "csv") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/toyo/reservation/export?format=${format}`,
        {
          headers: { "X-Journey-Token": token },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        await readApiJson(response, "reservation export");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `toyo-reservation-${receipt}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="reservation-form">
      <h3>Reserve your chosen Toyota</h3>
      <p>
        Save your contact details with your confirmed car, finance plan and
        insurance assumptions. This is a demo reservation; no dealer booking or
        text message is sent.
      </p>
      {!receipt ? (
        <form onSubmit={save}>
          <label>
            Customer name
            <input
              autoComplete="name"
              required
              maxLength={120}
              value={name}
              disabled={busy || !!state.reservationReady}
              onChange={(e) => {
                setName(e.target.value);
                setReviewed(false);
              }}
            />
          </label>
          <label>
            Phone number (include country code)
            <input
              type="tel"
              autoComplete="tel"
              placeholder="+1 555 123 4567"
              required
              maxLength={40}
              value={phone}
              disabled={busy || !!state.reservationReady}
              onChange={(e) => {
                setPhone(e.target.value);
                setReviewed(false);
              }}
            />
          </label>
          <label className="reservation-consent">
            <input
              type="checkbox"
              required
              checked={consent}
              disabled={busy || !!state.reservationReady}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            I agree to save my contact details and confirmed plan for this
            reservation.
          </label>
          <p>
            Review your name and phone number before saving. The phone number is
            not verified.
          </p>
          <label className="reservation-consent">
            <input
              type="checkbox"
              required
              checked={reviewed}
              disabled={busy || !!state.reservationReady}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I checked my name, every phone digit, and the displayed car and
            finance plan.
          </label>
          {state.reservationReady && (
            <p role="status">
              Ready to save: {name} · {phone}. Say “save my reservation” in
              Voice mode, press D2 once, or use Save demo reservation. D2
              controls must be enabled above.
            </p>
          )}
          <button className="primary-button" disabled={busy || voicePending}>
            {busy
              ? "Working…"
              : state.reservationReady
                ? "Save demo reservation"
                : "Review reservation for submission"}
          </button>
          {state.reservationReady && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action("reservation/cancel")}
            >
              Revise contact details
            </button>
          )}
        </form>
      ) : (
        <div role="status">
          <p>
            Reservation saved. Reference: <strong>{receipt}</strong>
          </p>
          <p>Download before starting a new journey or refreshing this page.</p>
          <button disabled={busy} onClick={() => void download("json")}>
            Download JSON
          </button>{" "}
          <button disabled={busy} onClick={() => void download("csv")}>
            Download CSV
          </button>
        </div>
      )}
      {(error || state.reservationError) && (
        <p role="alert">{error || state.reservationError}</p>
      )}
    </div>
  );
}
