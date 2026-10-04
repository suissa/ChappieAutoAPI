# ChappieAutoAPI

A dependency-free Node.js HTTP API runtime where API-specific declarations live in route files and request/response schemas are discovered dynamically from an OpenAPI document.

The core rule is: define the route, do not duplicate the schema.

## Route files

A route file may define:

- method: HTTP method.
- route: generated HTTP route.
- responseRoute: optional response/callback route.
- outputSchema: optional explicit output schema name and file path.
- handler: optional runtime implementation.

Example:

    export default {
      method: "POST",
      route: "/orders",

      handler: async ({ request, schema }) => ({
        received: request.body,
        inputSchema: schema.input,
        outputSchema: schema.output
      })
    };

No input or output schema is declared in the route.

## Synchronous and asynchronous routes

If responseRoute is omitted, ChappieAutoAPI treats it as the same route and marks the operation as synchronous.

    {
      method: "POST",
      route: "/orders"
    }

If responseRoute is explicitly defined, the operation is marked asynchronous.

    {
      method: "POST",
      route: "/orders",
      responseRoute: "/orders/{id}"
    }

The response route becomes the OpenAPI lookup route for the generated output schema.

## Dynamic input schemas

For each request, ChappieAutoAPI locates the OpenAPI operation matching the route method and path.

The generated input schema is assembled from:

- path parameters;
- query parameters;
- header parameters;
- request body content.

OpenAPI local $ref references are resolved against the loaded document. Therefore route files do not need to copy schemas from components.schemas.

## Dynamic output schemas

When outputSchema.path is not defined, the runtime derives the output schema from the OpenAPI response of responseRoute.

For example:

    GET /orders/{id}
      -> responses
      -> 200
      -> application/json
      -> schema

If the route has no responseRoute, its own route is used.

## Explicit output schemas

An explicit output schema is supported for endpoints that intentionally have a local response contract:

    export default {
      method: "GET",
      route: "/orders/{id}",
      outputSchema: {
        name: "OrderView",
        path: "../schemas/order-view.js"
      }
    };

The schema path is resolved relative to the route file.

## Configuration

    PORT=3000
    ROUTES_DIR=./routes
    OPENAPI_URL=http://localhost:4000/openapi.json
    OPENAPI_CACHE_TTL_MS=60000

Node.js 20+ is required. The runtime uses Node's native HTTP server and fetch API; there is no Express, Fastify, Ajv, Zod or other runtime dependency.

## Introspection

The generated route contract is exposed through:

    GET /__chappie/routes

It returns the loaded route definitions plus their resolved input and output schemas.

## Architecture

    route file
        |
        +--> HTTP method + route
        |
        +--> optional response route
        |
        +--> optional explicit output schema
        |
        v
    ChappieAutoAPI
        |
        v
    OpenAPI.json
        |
        +--> input schema
        +--> output schema

OpenAPI is the schema authority. Route files describe routing and behavior instead of maintaining duplicated request and response models.
