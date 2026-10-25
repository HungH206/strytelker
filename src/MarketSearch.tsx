import { useEffect, useRef, useState } from "react";

type SearchResult = {
  title: string;
  url: string;
  source: string;
  official: boolean;
  snippet: string;
  published: string | null;
};
type SearchResponse = {
  vehicleId: string;
  kind: "prices" | "offers";
  zip: string | null;
  query: string;
  retrievedAt: string;
  cached: boolean;
  results: SearchResult[];
};
export default function MarketSearch({
  vehicleId,
  vehicleName,
  revision,
  connected,
  disabled,
  search,
}: {
  vehicleId: string;
  vehicleName: string;
  revision: number;
  connected: boolean;
  disabled: boolean;
  search: (
    body: {
      revision: number;
      vehicleId: string;
      kind: "prices" | "offers";
      zip?: string;
    },
    signal: AbortSignal,
  ) => Promise<SearchResponse>;
}) {
  const [kind, setKind] = useState<"prices" | "offers">("prices");
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  useEffect(() => {
    setResult(null);
    setError("");
    setLoading(false);
    return () => {
      request.current++;
      controller.current?.abort();
    };
  }, [vehicleId, revision]);
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (loading || disabled || !connected) return;
    const sequence = ++request.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await search(
        { revision, vehicleId, kind, ...(zip ? { zip } : {}) },
        pending.signal,
      );
      if (sequence === request.current && response.vehicleId === vehicleId)
        setResult(response);
    } catch (error) {
      if (sequence === request.current && !pending.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Search is temporarily unavailable.",
        );
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }
  return (
    <section className="market-search" aria-label="Current prices and offers">
      <h3>Explore current prices & offers</h3>
      <p>
        Search the web for {vehicleName}, then open the source to review the
        actual terms.
      </p>
      <form onSubmit={run}>
        <div className="market-search-fields">
          <label>
            Search for
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as "prices" | "offers")
              }
              disabled={loading}
            >
              <option value="prices">Prices & dealer listings</option>
              <option value="offers">Offers & rebates</option>
            </select>
          </label>
          <label>
            ZIP code (optional)
            <input
              aria-label="Search ZIP code"
              value={zip}
              onChange={(event) => setZip(event.target.value)}
              pattern="[0-9]{5}"
              maxLength={5}
              inputMode="numeric"
              placeholder="US ZIP"
              disabled={loading}
            />
          </label>
        </div>
        <button type="submit" disabled={!connected || disabled || loading}>
          {loading
            ? "Searching…"
            : kind === "prices"
              ? "Search current prices"
              : "Search current offers"}
        </button>
      </form>
      {!connected && (
        <small>
          Web search is not connected yet. Catalog prices and the saved rebate
          offers remain available.
        </small>
      )}
      {error && (
        <p role="alert" className="toyo-error">
          {error}
        </p>
      )}
      {result && (
        <div className="market-search-results" aria-live="polite">
          <small>
            {result.kind === "prices" ? "Price" : "Offer"} search ·{" "}
            {result.zip ? `ZIP ${result.zip}` : "United States"} · Retrieved{" "}
            {new Date(result.retrievedAt).toLocaleString()}
            {result.cached ? " · cached" : ""}
          </small>
          {result.results.length ? (
            result.results.map((item) => (
              <article key={item.url}>
                <span>{item.official ? "Toyota website" : item.source}</span>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title} ↗
                </a>
                <p>{item.snippet}</p>
                {item.published && <small>Source date: {item.published}</small>}
              </article>
            ))
          ) : (
            <p>
              No results were returned. Try another ZIP code or search type.
            </p>
          )}
        </div>
      )}
      <small>
        Search snippets may omit model, location, expiry or eligibility details.
        They are research links, not verified dealer quotes, and do not change
        your calculator price or applied rebate.
      </small>
    </section>
  );
}
