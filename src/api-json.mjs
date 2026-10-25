// Hosts and proxies can return text/HTML even when the client expects an API.
export async function readApiJson(response, endpoint) {
  const type = response.headers.get("content-type") || "";
  const location = `${endpoint} (HTTP ${response.status})`;
  if (!/application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(type)) {
    throw new Error(
      `The API returned a non-JSON response from ${location}. On Vercel, make sure /api/* routes to the Node backend. For local development, run npm run dev.`,
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The backend returned invalid JSON from ${location}. Check the backend logs.`,
    );
  }
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : `The API request failed at ${location}.`,
    );
  return data;
}
