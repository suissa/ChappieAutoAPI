# ChappieAutoAPI

Dependency-free Node.js API runtime for testing communication between APIs.

Route files describe behavior. Swagger/OpenAPI is the external contract source.

## Swagger 2.0

The runtime accepts a local Swagger/OpenAPI JSON document through SWAGGER_JSON.

Swagger 2.0 is supported, including:

- paths/{route}/{method}/parameters[].schema for request bodies;
- responses/{status}.schema for response objects;
- local #/definitions/... references;
- OpenAPI 3 requestBody.content and responses.content when present.

At startup, only the document's paths property is persisted to configs/output.routes.json.

No generated schema module/file is created.

## Lazy request schemas

Every receiving route starts with an empty learned schema.

The first request is the learning request. ChappieAutoAPI infers the request shape from the real payload and stores it in configs/output.routes.json.

Validation starts only with the second request.

The expected response schema is resolved dynamically from Swagger/OpenAPI when the route is actually used.

## Configuration

    PORT=3000
    ROUTES_DIR=./routes
    SWAGGER_JSON=./swagger.json
    OUTPUT_ROUTES_CONFIG=./configs/output.routes.json
    OPENAPI_URL=http://localhost:4000/openapi.json
    OPENAPI_CACHE_TTL_MS=60000

## Route file

    export default {
      method: "POST",
      route: "/chat/archive",
      handler: async ({ request, schema }) => ({
        received: request.body,
        responseSchema: schema.output
      })
    };

No request or response schema needs to be duplicated in the route file.

## Generated config

The paths section is copied directly from Swagger.

The schemas section is populated lazily:

    {
      "paths": { "...": "Swagger paths" },
      "schemas": {
        "POST /chat/archive": { "...": "inferred from first request" }
      }
    }

## Introspection

    GET /__chappie/routes
