import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadRoutes } from "./routes.js";
import { OpenAPIResolver, inferSchema } from "./openapi.js";
import { Router, extractParams } from "./router.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const routesDirectory = path.resolve(process.env.ROUTES_DIR || path.join(root, "../routes"));
const port = Number(process.env.PORT || 3000);
const swaggerFile = path.resolve(process.env.SWAGGER_JSON || path.join(root, "../swagger.json"));
const outputRoutesFile = path.resolve(process.env.OUTPUT_ROUTES_CONFIG || path.join(root, "../configs/output.routes.json"));

const openapi = new OpenAPIResolver({
  file: swaggerFile,
  url: process.env.OPENAPI_URL,
  ttlMs: Number(process.env.OPENAPI_CACHE_TTL_MS || 60_000)
});

await mkdir(path.dirname(outputRoutesFile), { recursive: true });
await exportPathsConfig();

const routes = await loadRoutes(routesDirectory);
const learnedSchemas = new Map();
const router = new Router({ routes, openapi });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/__chappie/routes" && req.method === "GET") {
      return sendJson(res, 200, await Promise.all(routes.map((item) => router.describe(item))));
    }

    const route = router.match(req.method || "GET", url.pathname);
    if (!route) return sendJson(res, 404, { error: "Route not found" });

    const body = await readBody(req);
    const params = extractParams(route.route, url.pathname);
    const key = `${route.method} ${route.route}`;
    const requestValue = {
      path: params,
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(Object.entries(req.headers)),
      body
    };

    const learned = learnedSchemas.get(key);

    // First request initializes the schema. It is deliberately not validated.
    if (!learned) {
      const schema = inferSchema(requestValue);
      learnedSchemas.set(key, schema);
      await persistLearnedSchema(key, schema);
      return sendJson(res, 202, { status: "schema_initialized", route: route.route, schema });
    }

    const validation = validate(requestValue, learned);
    if (!validation.ok) {
      return sendJson(res, 400, {
        error: "Request schema validation failed",
        details: validation.errors
      });
    }

    const outputSchema = await openapi.outputSchema(route.method, route.responseRoute);
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
      schema: { input: learned, output: outputSchema }
    };

    if (typeof route.handler !== "function") {
      return sendJson(res, route.mode === "async" ? 202 : 200, {
        status: route.mode === "async" ? "accepted" : "ok",
        route: route.responseRoute,
        schema: outputSchema
      });
    }

    const result = await route.handler(context);
    if (route.mode === "async") return sendJson(res, 202, result ?? { status: "accepted" });
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

async function exportPathsConfig() {
  const document = await openapi.getDocument();
  await writeFile(outputRoutesFile, JSON.stringify({ paths: document.paths }, null, 2) + "\n", "utf8");
}

async function persistLearnedSchema(key, schema) {
  const current = await readFile(outputRoutesFile, "utf8").catch(() => JSON.stringify({ paths: {} }));
  const config = JSON.parse(current);
  config.schemas ||= {};
  config.schemas[key] = schema;
  await writeFile(outputRoutesFile, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (String(req.headers["content-type"] || "").includes("application/json")) {
    try { return JSON.parse(raw); } catch { throw new Error("Invalid JSON request body"); }
  }
  return raw;
}

function validate(value, schema, path = "$") {
  const errors = [];
  if (!schema || !schema.type) return { ok: true, errors };

  const type = Array.isArray(value) ? "array"
    : value === null ? "null"
    : typeof value === "number" && Number.isInteger(value) ? "integer"
    : typeof value;

  if (type !== schema.type && !(schema.type === "number" && type === "integer")) {
    errors.push(`${path}: expected ${schema.type}, got ${type}`);
  }

  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties || {})) {
      errors.push(...validate(value[key], child, `${path}.${key}`).errors);
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...validate(item, schema.items || {}, `${path}[${index}]`).errors);
    });
  }

  return { ok: errors.length === 0, errors };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
