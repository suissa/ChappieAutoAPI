import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadRoutes } from "./routes.js";
import { OpenAPIResolver } from "./openapi.js";
import { Router, extractParams } from "./router.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const routesDirectory = path.resolve(process.env.ROUTES_DIR || path.join(root, "../routes"));
const port = Number(process.env.PORT || 3000);
const openapiUrl = process.env.OPENAPI_URL;

if (!openapiUrl) {
  throw new Error("OPENAPI_URL is required");
}

const routes = await loadRoutes(routesDirectory);
const openapi = new OpenAPIResolver({
  url: openapiUrl,
  ttlMs: Number(process.env.OPENAPI_CACHE_TTL_MS || 60_000)
});
const router = new Router({ routes, openapi });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/__chappie/routes" && req.method === "GET") {
      return sendJson(res, 200, await Promise.all(routes.map((item) => router.describe(item))));
    }

    const route = router.match(req.method || "GET", url.pathname);

    if (!route) {
      return sendJson(res, 404, { error: "Route not found" });
    }

    const body = await readBody(req);
    const params = extractParams(route.route, url.pathname);

    const context = {
      request: {
        method: req.method,
        route: route.route,
        responseRoute: route.responseRoute,
        mode: route.mode,
        params,
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(Object.entries(req.headers)),
        body
      },
      schema: {
        input: await openapi.inputSchema(route.method, route.route),
        output: route.outputSchema?.path
          ? await importSchema(route.outputSchema.path)
          : await openapi.outputSchema(route.method, route.responseRoute)
      }
    };

    if (typeof route.handler !== "function") {
      return sendJson(res, route.mode === "async" ? 202 : 200, {
        status: route.mode === "async" ? "accepted" : "ok",
        route: route.responseRoute,
        schema: context.schema.output
      });
    }

    const result = await route.handler(context);

    if (route.mode === "async") {
      return sendJson(res, 202, result ?? { status: "accepted" });
    }

    return sendJson(res, result?.statusCode || 200, result?.body ?? result);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error: "Internal Server Error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, () => {
  console.log(`ChappieAutoAPI listening on http://localhost:${port}`);
  console.log(`Loaded ${routes.length} route(s)`);
});

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;

  const raw = Buffer.concat(chunks).toString("utf8");
  const contentType = String(req.headers["content-type"] || "");

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Invalid JSON request body");
    }
  }

  return raw;
}

async function importSchema(schemaPath) {
  const module = await import(new URL(schemaPath, import.meta.url).href);
  return module.default ?? module.schema ?? module;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
