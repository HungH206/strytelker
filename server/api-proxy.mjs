// Stateless Vercel gateway. Session state stays in the long-running Node backend.
function json(res, status, error) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ error }));
}

export function createApiProxy({ backendUrl, fetchImpl = fetch } = {}) {
  return async function proxy(req, res) {
    const configuredUrl = backendUrl ?? process.env.TOYO_BACKEND_URL;
    if (!configuredUrl)
      return json(
        res,
        503,
        "The backend is not connected yet. Set TOYO_BACKEND_URL in Vercel to the deployed Node service URL, then redeploy.",
      );
    let origin;
    try {
      origin = new URL(configuredUrl);
      if (
        origin.protocol !== "https:" ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      )
        throw new Error("Invalid origin");
    } catch {
      return json(
        res,
        503,
        "TOYO_BACKEND_URL must be an HTTPS origin, such as https://your-service.onrender.com.",
      );
    }
    const incoming = new URL(req.url, "https://frontend.invalid");
    const path = req.query?.path ?? incoming.searchParams.get("path");
    if (
      typeof path !== "string" ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)
    )
      return json(res, 400, "Invalid API route.");
    const upstream = new URL(`/api/${path}`, origin);
    for (const [key, value] of incoming.searchParams)
      if (key !== "path") upstream.searchParams.append(key, value);
    const headers = { Accept: req.headers.accept || "application/json" };
    if (req.headers["content-type"])
      headers["Content-Type"] = req.headers["content-type"];
    if (req.headers["x-journey-token"])
      headers["X-Journey-Token"] = req.headers["x-journey-token"];
    if (path.startsWith("monitor/") && req.headers.authorization)
      headers.Authorization = req.headers.authorization;
    let body;
    try {
      if (!["GET", "HEAD"].includes(req.method)) {
        const parsedBody = req.body;
        if (parsedBody !== undefined)
          body =
            typeof parsedBody === "string" || Buffer.isBuffer(parsedBody)
              ? parsedBody
              : JSON.stringify(parsedBody);
        else {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > 24 * 1024)
              return json(res, 413, "The request is too large.");
            chunks.push(buffer);
          }
          body = Buffer.concat(chunks);
        }
        if (Buffer.byteLength(body) > 24 * 1024)
          return json(res, 413, "The request is too large.");
      }
    } catch {
      return json(res, 400, "The API request body could not be read.");
    }

    try {
      const response = await fetchImpl(upstream, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(32000),
        redirect: "error",
      });
      const contentType = response.headers.get("content-type") || "";
      // Preserve binary narration, but never pass a host's error page as API JSON.
      if (
        !/application\/(?:[\w.-]+\+)?json|text\/csv|audio\//i.test(contentType)
      )
        return json(
          res,
          502,
          `The Node backend returned a non-API response (HTTP ${response.status}). Check the backend URL and service logs.`,
        );
      const data = Buffer.from(await response.arrayBuffer());
      res.statusCode = response.status;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      const timeout =
        error?.name === "TimeoutError" || error?.name === "AbortError";
      return json(
        res,
        timeout ? 504 : 502,
        timeout
          ? "The Node backend took too long to respond. A sleeping demo service may be starting; wait a moment and try again."
          : "Cannot reach the Node backend. Check that the service is running and TOYO_BACKEND_URL is correct.",
      );
    }
  };
}
