import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export async function loadRoutes(directory) {
  const files = await walk(directory);
  const routes = [];

  for (const file of files) {
    if (!/\.(js|mjs)$/i.test(file)) continue;
    const module = await import(pathToFileURL(file).href);
    const definitions = module.default ?? module.routes ?? module;

    for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
      if (!definition || typeof definition !== "object") continue;
      routes.push(normalizeRoute(definition, file));
    }
  }

  return routes;
}

function normalizeRoute(definition, source) {
  const method = String(definition.method || "GET").toUpperCase();
  const route = definition.route || definition.path;

  if (!METHODS.has(method)) throw new Error(`${source}: unsupported HTTP method "${method}"`);
  if (!route || !route.startsWith("/")) throw new Error(`${source}: route must be an absolute path`);

  const hasResponseRoute = definition.responseRoute !== undefined;
  const responseRoute = definition.responseRoute ?? route;

  const outputSchema = definition.outputSchema
    ? {
        name: definition.outputSchema.name,
        path: definition.outputSchema.path
          ? path.resolve(path.dirname(source), definition.outputSchema.path)
          : undefined
      }
    : null;

  return {
    ...definition,
    method,
    route,
    responseRoute,
    mode: hasResponseRoute ? "async" : "sync",
    source,
    outputSchema
  };
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }

  return files;
}
