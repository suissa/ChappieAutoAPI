const HTTP_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "head", "options", "trace"
]);

export class OpenAPIResolver {
  constructor({ url, ttlMs = 60_000 } = {}) {
    if (!url) throw new Error("OPENAPI_URL is required");
    this.url = new URL(url);
    this.ttlMs = ttlMs;
    this.document = null;
    this.loadedAt = 0;
  }

  async getDocument() {
    const now = Date.now();
    if (this.document && now - this.loadedAt < this.ttlMs) {
      return this.document;
    }

    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`Unable to load OpenAPI document: HTTP ${response.status}`);
    }

    const document = await response.json();
    if (!document || typeof document !== "object" || !document.paths) {
      throw new Error("Invalid OpenAPI document: paths is required");
    }

    this.document = document;
    this.loadedAt = now;
    return document;
  }

  async operation(method, route) {
    const document = await this.getDocument();
    const normalizedMethod = method.toLowerCase();

    if (!HTTP_METHODS.has(normalizedMethod)) {
      throw new Error(`Unsupported HTTP method: ${method}`);
    }

    const path = findOpenAPIPath(document.paths, route);
    if (!path) {
      return null;
    }

    const operation = document.paths[path]?.[normalizedMethod];
    if (!operation) return null;

    return {
      path,
      method: normalizedMethod,
      operation,
      document
    };
  }

  async inputSchema(method, route) {
    const match = await this.operation(method, route);
    if (!match) return null;

    const operation = match.operation;
    const parameters = [
      ...(match.document.paths[match.path]?.parameters || []),
      ...(operation.parameters || [])
    ];

    const query = {};
    const pathParams = {};
    const headers = {};

    for (const parameter of parameters) {
      if (!parameter || !parameter.name || !parameter.in) continue;
      const target =
        parameter.in === "query" ? query :
        parameter.in === "path" ? pathParams :
        parameter.in === "header" ? headers :
        null;

      if (target) {
        target[parameter.name] = clone(parameter.schema || {});
      }
    }

    const requestBody = {};
    for (const [contentType, media] of Object.entries(operation.requestBody?.content || {})) {
      requestBody[contentType] = clone(media?.schema || {});
    }

    return {
      type: "object",
      properties: {
        ...(Object.keys(pathParams).length ? { path: { type: "object", properties: pathParams } } : {}),
        ...(Object.keys(query).length ? { query: { type: "object", properties: query } } : {}),
        ...(Object.keys(headers).length ? { headers: { type: "object", properties: headers } } : {}),
        ...(Object.keys(requestBody).length ? { body: {
          oneOf: Object.values(requestBody)
        } } : {})
      },
      required: []
    };
  }

  async outputSchema(method, route, status = "200") {
    const match = await this.operation(method, route);
    if (!match) return null;

    const responses = match.operation.responses || {};
    const response = responses[status] || responses.default || firstResponse(responses);
    if (!response) return null;

    const content = response.content || {};
    const media = content["application/json"] || Object.values(content)[0];

    return media?.schema ? clone(media.schema) : null;
  }
}

export function resolveLocalSchema(schema, document) {
  if (!schema || typeof schema !== "object") return schema;
  if (!schema.$ref) return clone(schema);

  const prefix = "#/";
  if (!schema.$ref.startsWith(prefix)) {
    return clone(schema);
  }

  const value = schema.$ref
    .slice(prefix.length)
    .split("/")
    .map(decodeURIComponent)
    .reduce((node, key) => node?.[key], document);

  return value ? clone(value) : clone(schema);
}

function findOpenAPIPath(paths, route) {
  if (paths[route]) return route;

  const candidates = Object.keys(paths);
  const routeParts = route.split("/").filter(Boolean);

  for (const candidate of candidates) {
    const candidateParts = candidate.split("/").filter(Boolean);
    if (candidateParts.length !== routeParts.length) continue;

    let matches = true;
    for (let i = 0; i < candidateParts.length; i++) {
      const expected = candidateParts[i];
      const actual = routeParts[i];
      if (!(expected.startsWith("{") && expected.endsWith("}")) && expected !== actual) {
        matches = false;
        break;
      }
    }

    if (matches) return candidate;
  }

  return null;
}

function firstResponse(responses) {
  const preferred = ["200", "201", "202", "204"];
  for (const status of preferred) {
    if (responses[status]) return responses[status];
  }
  return Object.values(responses)[0];
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
