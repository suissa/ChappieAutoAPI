const HTTP_METHODS = new Set(["get","post","put","patch","delete","head","options","trace"]);

export class OpenAPIResolver {
  constructor({ url, file, ttlMs = 60_000 } = {}) {
    if (!url && !file) throw new Error("OPENAPI_URL or SWAGGER_JSON is required");
    this.url = url ? new URL(url) : null;
    this.file = file;
    this.ttlMs = ttlMs;
    this.document = null;
    this.loadedAt = 0;
  }

  async getDocument() {
    const now = Date.now();
    if (this.document && now - this.loadedAt < this.ttlMs) return this.document;

    let document;
    if (this.file) {
      const { readFile } = await import("node:fs/promises");
      document = JSON.parse(await readFile(this.file, "utf8"));
    } else {
      const response = await fetch(this.url);
      if (!response.ok) throw new Error(`Unable to load API document: HTTP ${response.status}`);
      document = await response.json();
    }

    if (!document || typeof document !== "object" || !document.paths) {
      throw new Error("Invalid API document: paths is required");
    }

    this.document = document;
    this.loadedAt = now;
    return document;
  }

  async operation(method, route) {
    const document = await this.getDocument();
    const normalizedMethod = method.toLowerCase();
    if (!HTTP_METHODS.has(normalizedMethod)) throw new Error(`Unsupported HTTP method: ${method}`);

    const path = findOpenAPIPath(document.paths, route);
    if (!path) return null;
    const operation = document.paths[path]?.[normalizedMethod];
    if (!operation) return null;
    return { path, method: normalizedMethod, operation, document };
  }

  async inputSchema(method, route) {
    const match = await this.operation(method, route);
    if (!match) return null;

    const parameters = [
      ...(match.document.paths[match.path]?.parameters || []),
      ...(match.operation.parameters || [])
    ];

    const query = {}, pathParams = {}, headers = {};
    for (const parameter of parameters) {
      if (!parameter?.name || !parameter.in) continue;
      const target = parameter.in === "query" ? query
        : parameter.in === "path" ? pathParams
        : parameter.in === "header" ? headers : null;
      if (target) target[parameter.name] = resolveSchema(parameter.schema || {}, match.document);
    }

    const bodyParameter = parameters.find((parameter) => parameter?.in === "body");
    const requestBody = bodyParameter?.schema
      ? resolveSchema(bodyParameter.schema, match.document) : null;

    const openapi3Bodies = Object.fromEntries(
      Object.entries(match.operation.requestBody?.content || {})
        .map(([type, media]) => [type, resolveSchema(media?.schema || {}, match.document)])
    );

    return {
      type: "object",
      properties: {
        ...(Object.keys(pathParams).length ? { path: { type: "object", properties: pathParams } } : {}),
        ...(Object.keys(query).length ? { query: { type: "object", properties: query } } : {}),
        ...(Object.keys(headers).length ? { headers: { type: "object", properties: headers } } : {}),
        ...(requestBody ? { body: requestBody } : {}),
        ...(Object.keys(openapi3Bodies).length ? { body: { oneOf: Object.values(openapi3Bodies) } } : {})
      }
    };
  }

  async outputSchema(method, route, status = "200") {
    const match = await this.operation(method, route);
    if (!match) return null;

    const responses = match.operation.responses || {};
    const response = responses[status] || responses.default || firstResponse(responses);
    if (!response) return null;

    if (response.schema) return resolveSchema(response.schema, match.document);

    const content = response.content || {};
    const media = content["application/json"] || Object.values(content)[0];
    return media?.schema ? resolveSchema(media.schema, match.document) : null;
  }
}

export function inferSchema(value) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", items: value.length ? inferSchema(value[0]) : {} };
  if (typeof value === "object") {
    return {
      type: "object",
      properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inferSchema(item)]))
    };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  return { type: typeof value };
}

function resolveSchema(schema, document, seen = new Set()) {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return schema;
    const resolved = resolveRef(schema.$ref, document);
    if (!resolved) return schema;
    const nextSeen = new Set(seen);
    nextSeen.add(schema.$ref);
    return resolveSchema(resolved, document, nextSeen);
  }
  const result = Array.isArray(schema) ? [] : {};
  for (const [key, value] of Object.entries(schema)) result[key] = resolveSchema(value, document, seen);
  return result;
}

function resolveRef(ref, document) {
  if (!ref.startsWith("#/")) return null;
  return ref.slice(2).split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((node, key) => node?.[key], document);
}

function findOpenAPIPath(paths, route) {
  if (paths[route]) return route;
  const routeParts = route.split("/").filter(Boolean);
  for (const candidate of Object.keys(paths)) {
    const candidateParts = candidate.split("/").filter(Boolean);
    if (candidateParts.length !== routeParts.length) continue;
    if (candidateParts.every((expected, index) =>
      (expected.startsWith("{") && expected.endsWith("}")) || expected === routeParts[index]
    )) return candidate;
  }
  return null;
}

function firstResponse(responses) {
  for (const status of ["200","201","202","204"]) if (responses[status]) return responses[status];
  return Object.values(responses)[0];
}
