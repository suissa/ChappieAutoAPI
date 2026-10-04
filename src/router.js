export class Router {
  constructor({ routes, openapi }) {
    this.routes = routes;
    this.openapi = openapi;
  }

  match(method, pathname) {
    return this.routes.find((route) => {
      if (route.method !== method.toUpperCase()) return false;
      return matchPath(route.route, pathname);
    }) || null;
  }

  async describe(route) {
    const inputSchema = await this.openapi.inputSchema(route.method, route.route);
    let outputSchema = null;

    if (route.outputSchema?.path) {
      outputSchema = await importSchema(route.outputSchema.path);
    } else {
      outputSchema = await this.openapi.outputSchema(route.method, route.responseRoute);
    }

    return {
      method: route.method,
      route: route.route,
      responseRoute: route.responseRoute,
      mode: route.mode,
      outputSchemaName: route.outputSchema?.name || null,
      inputSchema,
      outputSchema
    };
  }
}

export function matchPath(pattern, pathname) {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return false;

  return expected.every((part, index) =>
    part.startsWith(":") ||
    (part.startsWith("{") && part.endsWith("}")) ||
    part === actual[index]
  );
}

export function extractParams(pattern, pathname) {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  const params = {};

  expected.forEach((part, index) => {
    if (part.startsWith(":")) params[part.slice(1)] = actual[index];
    if (part.startsWith("{") && part.endsWith("}")) {
      params[part.slice(1, -1)] = actual[index];
    }
  });

  return params;
}

async function importSchema(schemaPath) {
  const module = await import(new URL(schemaPath, import.meta.url).href);
  return module.default ?? module.schema ?? module;
}
