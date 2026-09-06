// ══════════════════════════════════════════════════════════════════
// SpiceToSynapse API Proxy — Railway deployment
// ══════════════════════════════════════════════════════════════════
const https  = require("https");
const http   = require("http");

const PORT    = process.env.PORT || 3001;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

if (!API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY environment variable not set");
  process.exit(1);
}

const ALLOWED_ORIGINS = [
  "https://neuromatrixbiosystems.com",
  "https://www.neuromatrixbiosystems.com",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "86400",
    "Content-Type":                 "application/json",
  };
}

const server = http.createServer((req, res) => {
  const origin  = req.headers["origin"] || "null";
  const headers = corsHeaders(origin);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers); res.end(); return;
  }

  // Health check — Railway uses this to confirm app is running
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ status: "ok", service: "SpiceToSynapse proxy", ts: new Date().toISOString() }));
    return;
  }

  // Only accept POST /api/claude
  if (req.method !== "POST" || req.url !== "/api/claude") {
    res.writeHead(404, headers);
    res.end(JSON.stringify({ error: "Not found. POST to /api/claude" }));
    return;
  }

  let body = "";
  req.on("data", chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
  req.on("end", () => {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch(e) { res.writeHead(400, headers); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

    if (!parsed.messages || !Array.isArray(parsed.messages)) {
      res.writeHead(400, headers); res.end(JSON.stringify({ error: "messages array required" })); return;
    }

    const anthropicBody = JSON.stringify({
      model:      parsed.model      || "claude-sonnet-4-6",
      max_tokens: parsed.max_tokens || 2000,
      system:     parsed.system     || "",
      messages:   parsed.messages,
    });

    const options = {
      hostname: "api.anthropic.com",
      port: 443, path: "/v1/messages", method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key":         API_KEY,
        "Content-Length":    Buffer.byteLength(anthropicBody),
      },
    };

    const proxyReq = https.request(options, proxyRes => {
      let data = "";
      proxyRes.on("data", chunk => { data += chunk; });
      proxyRes.on("end", () => { res.writeHead(proxyRes.statusCode, headers); res.end(data); });
    });

    proxyReq.on("error", err => {
      console.error("Proxy error:", err.message);
      res.writeHead(502, headers);
      res.end(JSON.stringify({ error: "Upstream error", detail: err.message }));
    });

    proxyReq.setTimeout(60000, () => {
      proxyReq.destroy();
      res.writeHead(504, headers);
      res.end(JSON.stringify({ error: "Upstream timeout after 60s" }));
    });

    proxyReq.write(anthropicBody);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`SpiceToSynapse proxy running on port ${PORT}`);
  console.log(`Key loaded: ${API_KEY.slice(0,16)}...`);
});
