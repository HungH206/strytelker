import { useState } from "react";
import { readApiJson } from "./api-json.mjs";
import "./reservation-monitor.css";
type Receipt = {
  id: string;
  createdAt: string;
  workflowStatus: string;
  customer: { name: string; phone: string };
  vehicle: { name: string };
  finance: Record<string, unknown>;
  quote: Record<string, unknown>;
  insurance: Record<string, unknown>;
  offerId: string | null;
  events?: Array<{ status: string; createdAt: string }>;
};
const statuses = ["new", "contacted", "confirmed", "cancelled"];
export default function ReservationMonitor() {
  const [key, setKey] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [rows, setRows] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [provider, setProvider] = useState("");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function request(path: string, body?: unknown) {
    const response = await fetch(`/api/monitor/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    return readApiJson(response, "reservation monitor");
  }
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const result = await request("reservations");
    setRows(result.reservations);
    setProvider(result.provider);
    setSignedIn(true);
  }
  function signOut() {
    setKey("");
    setRows([]);
    setSelected(null);
    setSignedIn(false);
    setSearch("");
    setError("");
  }
  async function download(format: "json" | "csv") {
    if (!selected) return;
    const response = await fetch(
      `/api/monitor/reservations/${selected.id}?format=${format}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) {
      await readApiJson(response, "reservation export");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `reservation-${selected.id}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const visible = rows.filter(
    (row) =>
      (!filter || row.workflowStatus === filter) &&
      `${row.id} ${row.customer.name} ${row.customer.phone} ${row.vehicle.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <main className="monitor">
      <header>
        <span>TOYO · STAFF WORKSPACE</span>
        <h1>Reservation monitor</h1>
        <p>Demo reservations · customer follow-up and finance summaries</p>
      </header>
      {error && (
        <p role="alert" className="monitor-error">
          {error}
        </p>
      )}
      {!signedIn ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void work(refresh);
          }}
        >
          <label>
            Staff access key
            <input
              type="password"
              autoComplete="off"
              required
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <button disabled={busy}>Sign in</button>
          <p>
            The access key is kept in this tab's memory. Closing or refreshing
            clears it.
          </p>
        </form>
      ) : (
        <>
          <div className="monitor-toolbar">
            <b>
              {provider === "tiger" ? "Tiger Data" : "Local SQLite"} ·{" "}
              {rows.length} recent reservations
            </b>
            <button disabled={busy} onClick={() => void work(refresh)}>
              Refresh
            </button>
            <button disabled={busy} onClick={signOut}>
              Sign out
            </button>
          </div>
          <div className="monitor-stats">
            {statuses.map((status) => (
              <div key={status}>
                <strong>
                  {rows.filter((row) => row.workflowStatus === status).length}
                </strong>{" "}
                {status}
              </div>
            ))}
          </div>
          <div className="monitor-toolbar">
            <label>
              Search
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Customer, phone, car or reference"
              />
            </label>
            <label>
              Status
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="">All statuses</option>
                {statuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>
          <p>
            Showing the latest 200 reservations. Refresh to see new entries.
          </p>
          <div className="monitor-table">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Car</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.customer.name}</td>
                    <td>{row.customer.phone}</td>
                    <td>{row.vehicle.name}</td>
                    <td>{row.workflowStatus}</td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void work(async () =>
                            setSelected(
                              await request(`reservations/${row.id}`),
                            ),
                          )
                        }
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <p>No matching reservations.</p>}
          </div>
          {selected && (
            <section className="monitor-detail">
              <button onClick={() => setSelected(null)}>Close details</button>
              <h2>{selected.vehicle.name}</h2>
              <p>
                {selected.customer.name} · {selected.customer.phone}
              </p>
              <p>Reference: {selected.id}</p>
              <label>
                Follow-up status
                <select
                  disabled={busy}
                  value={selected.workflowStatus}
                  onChange={(event) => {
                    const status = event.target.value;
                    void work(async () => {
                      setSelected(
                        await request(`reservations/${selected.id}/status`, {
                          status,
                        }),
                      );
                      await refresh();
                    });
                  }}
                >
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <p>
                “Confirmed” tracks staff follow-up only. It does not issue a
                dealer booking.
              </p>
              {[
                ["Finance assumptions", selected.finance],
                ["Calculated quote", selected.quote],
                ["Insurance assumptions", selected.insurance],
              ].map(([title, value]) => (
                <section key={String(title)}>
                  <h3>{String(title)}</h3>
                  <dl>
                    {Object.entries(value || {}).map(([field, item]) => (
                      <div key={field}>
                        <dt>{field}</dt>
                        <dd>
                          {typeof item === "object"
                            ? JSON.stringify(item)
                            : String(item ?? "—")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
              <p>Rebate: {selected.offerId || "None"}</p>
              <h3>Status history</h3>
              <ul>
                {selected.events?.map((event, index) => (
                  <li key={index}>
                    {event.status} ·{" "}
                    {new Date(event.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
              <button
                disabled={busy}
                onClick={() => void work(() => download("json"))}
              >
                Download JSON
              </button>{" "}
              <button
                disabled={busy}
                onClick={() => void work(() => download("csv"))}
              >
                Download CSV
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
