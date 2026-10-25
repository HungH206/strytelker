import { z } from "zod";

export class MarketSearchError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export const marketSearchSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    vehicleId: z.string().min(1),
    kind: z.enum(["prices", "offers"]),
    zip: z
      .string()
      .regex(/^\d{5}$/)
      .optional(),
  })
  .strict();

export function normalizeSearchResults(payload) {
  const seen = new Set();
  return (Array.isArray(payload.organic_results) ? payload.organic_results : [])
    .flatMap((result) => {
      if (typeof result.title !== "string" || typeof result.link !== "string")
        return [];
      let url;
      try {
        url = new URL(result.link);
      } catch {
        return [];
      }
      if (url.protocol !== "https:" || url.username || url.password) return [];
      url.hash = "";
      if (seen.has(url.href)) return [];
      seen.add(url.href);
      const official =
        url.hostname === "toyota.com" || url.hostname.endsWith(".toyota.com");
      return [
        {
          title: result.title.slice(0, 240),
          url: url.href,
          source: url.hostname,
          official,
          snippet:
            typeof result.snippet === "string"
              ? result.snippet.slice(0, 1200)
              : "",
          published:
            typeof result.date === "string" ? result.date.slice(0, 80) : null,
        },
      ];
    })
    .slice(0, 6);
}

export function createMarketSearch({
  apiKey = process.env.SERPAPI_API_KEY,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const ttl = 10 * 60 * 1000;
  return {
    configured: !!apiKey,
    async search(vehicle, { kind, zip }) {
      if (!apiKey)
        throw new MarketSearchError(
          "Current-price search is not connected yet. Catalog prices remain available.",
          503,
        );
      const query = `${vehicle.name} ${kind === "prices" ? "price MSRP dealer inventory" : "special offers incentives college military rebate financing"}${zip ? ` ${zip}` : ""}`;
      const key = JSON.stringify([vehicle.id, kind, zip || ""]);
      for (const [id, entry] of cache)
        if (entry.expires <= now()) cache.delete(id);
      const saved = cache.get(key);
      if (saved) return { ...saved.result, cached: true };
      if (inFlight.has(key)) return inFlight.get(key);
      const pending = (async () => {
        const url = new URL("https://serpapi.com/search.json");
        url.search = new URLSearchParams({
          engine: "google",
          q: query,
          gl: "us",
          hl: "en",
          google_domain: "google.com",
          api_key: apiKey,
        }).toString();
        let response;
        try {
          response = await fetchImpl(url, {
            signal: AbortSignal.timeout(20000),
            redirect: "error",
          });
        } catch (error) {
          const timeout =
            error?.name === "TimeoutError" || error?.name === "AbortError";
          throw new MarketSearchError(
            timeout
              ? "The search timed out. Try again in a moment."
              : "Search is temporarily unavailable. Your catalog and payment plan are still available.",
            timeout ? 504 : 502,
          );
        }
        if (!response.ok)
          throw new MarketSearchError(
            response.status === 429
              ? "The search provider quota is unavailable. Try again later."
              : "The search provider could not complete the request. Check the backend search configuration.",
            response.status === 429 ? 429 : 502,
          );
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new MarketSearchError(
            "The search provider returned an unreadable response. Try again later.",
          );
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          payload.error ||
          (payload.search_metadata?.status !== "Success" &&
            !Array.isArray(payload.organic_results))
        )
          throw new MarketSearchError(
            "The search provider could not return results. Try again later.",
          );
        const result = {
          vehicleId: vehicle.id,
          kind,
          zip: zip || null,
          query,
          retrievedAt: new Date(now()).toISOString(),
          cached: false,
          results: normalizeSearchResults(payload),
        };
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { result, expires: now() + ttl });
        return result;
      })();
      inFlight.set(key, pending);
      try {
        return await pending;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
