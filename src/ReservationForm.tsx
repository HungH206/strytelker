import { useState, type FormEvent } from "react";
import { readApiJson } from "./api-json.mjs";

export default function ReservationForm({
  token,
  revision,
}: {
  token: string;
  revision: number;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/toyo/reservation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Journey-Token": token,
        },
        body: JSON.stringify({ revision, contact: { name, phone, consent } }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await readApiJson(response, "reservation");
      setReceipt(result.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save reservation.",
      );
    } finally {
      setBusy(false);
    }
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
              onChange={(e) => setName(e.target.value)}
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
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="reservation-consent">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            I agree to save my contact details and confirmed plan for this
            reservation.
          </label>
          <p>
            Review your name and phone number before saving. The phone number is
            not verified.
          </p>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Save demo reservation"}
          </button>
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
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
