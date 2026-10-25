import test from "node:test";
import assert from "node:assert/strict";
import {
  createMarketSearch,
  normalizeSearchResults,
  MarketSearchError,
} from "../server/market-search.mjs";
const vehicle = {
  id: "corolla-2026",
  name: "2026 Toyota Corolla",
  price: 23125,
};

const payload = {
  search_metadata: {
    status: "Success",
    json_endpoint: "https://serpapi.com/private?api_key=secret",
  },
  organic_results: [
    {
      title: "Corolla pricing",
      link: "https://www.toyota.com/corolla/",
      snippet: "Starting MSRP shown on the source website.",
      date: "Oct 2026",
    },
    {
      title: "Dealer offers",
      link: "https://dealer.example.test/corolla",
      snippet: "$500 offer, subject to terms.",
    },
    { title: "Unsafe", link: "javascript:alert(1)" },
    { title: "Duplicate", link: "https://www.toyota.com/corolla/#models" },
    { title: "Not Toyota", link: "https://toyota.com.evil.test/" },
  ],
};

test("SerpAPI uses catalog model and optional ZIP, keeps key on server, and normalizes safe research links", async () => {
  const service = createMarketSearch({
    apiKey: "secret",
    fetchImpl: async (url) => {
      assert.equal(url.origin, "https://serpapi.com");
      assert.equal(url.pathname, "/search.json");
      assert.equal(url.searchParams.get("engine"), "google");
      assert.equal(url.searchParams.get("api_key"), "secret");
      assert.match(
        url.searchParams.get("q"),
        /2026 Toyota Corolla.*price.*78701/,
      );
      return Response.json(payload);
    },
  });
  const result = await service.search(vehicle, {
    kind: "prices",
    zip: "78701",
  });
  assert.equal(result.vehicleId, vehicle.id);
  assert.equal(result.results.length, 3);
  assert.equal(result.results[0].official, true);
  assert.equal(result.results[2].official, false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal("price" in result, false);
  assert.equal(vehicle.price, 23125);
});

test("cache and in-flight deduplication avoid repeated provider calls, with distinct offer and ZIP queries", async () => {
  let calls = 0,
    time = 100000;
  const service = createMarketSearch({
    apiKey: "test",
    now: () => time,
    fetchImpl: async () => {
      calls++;
      return Response.json(payload);
    },
  });
  await Promise.all([
    service.search(vehicle, { kind: "offers" }),
    service.search(vehicle, { kind: "offers" }),
  ]);
  assert.equal(calls, 1);
  const cached = await service.search(vehicle, { kind: "offers" });
  assert.equal(cached.cached, true);
  await service.search(vehicle, { kind: "prices" });
  await service.search(vehicle, { kind: "offers", zip: "78701" });
  assert.equal(calls, 3);
  time += 10 * 60 * 1000 + 1;
  await service.search(vehicle, { kind: "offers" });
  assert.equal(calls, 4);
});

test("missing key and provider errors are actionable and never expose provider response bodies or credential URLs", async () => {
  await assert.rejects(
    () =>
      createMarketSearch({ apiKey: "" }).search(vehicle, { kind: "prices" }),
    (error) => error instanceof MarketSearchError && error.status === 503,
  );
  for (const fetchImpl of [
    async () => new Response("secret", { status: 401 }),
    async () => {
      throw new Error("https://serpapi.com/search?api_key=secret");
    },
    async () => Response.json({ error: "Bad secret key" }),
    async () => new Response("HTML secret page"),
  ]) {
    await assert.rejects(
      () =>
        createMarketSearch({ apiKey: "secret", fetchImpl }).search(vehicle, {
          kind: "offers",
        }),
      (error) =>
        error instanceof MarketSearchError && !error.message.includes("secret"),
    );
  }
});

test("empty searches are valid, bad fields are discarded, and result counts are bounded", async () => {
  const empty = await createMarketSearch({
    apiKey: "test",
    fetchImpl: async () =>
      Response.json({ search_metadata: { status: "Success" } }),
  }).search(vehicle, { kind: "prices" });
  assert.deepEqual(empty.results, []);
  assert.deepEqual(
    normalizeSearchResults({
      organic_results: [
        { link: "https://example.test" },
        { title: "Title", link: "https://user:pass@example.test" },
      ],
    }),
    [],
  );
  assert.equal(
    normalizeSearchResults({
      organic_results: Array.from({ length: 20 }, (_, i) => ({
        title: "Test",
        link: `https://example.test/${i}`,
      })),
    }).length,
    6,
  );
});
