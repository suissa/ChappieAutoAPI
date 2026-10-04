# ChappieAutoAPI

Dependency-free Node.js API runtime for testing communication between APIs.

Route files describe behavior. Swagger/OpenAPI is the external contract source.

## Swagger 2.0

The runtime accepts a local Swagger/OpenAPI JSON document through SWAGGER_JSON, or a remote document through OPENAPI_URL. These are alternative sources.

Swagger 2.0 is supported, including:

- paths/{route}/{method}/parameters[].schema for request bodies;
- responses/{status}.schema for response objects;
- local #/definitions/... references;
- OpenAPI 3 requestBody.content and responses.content when present.

For a remote URL, the document is read and only its `paths` data is used by the runtime. No remote document is written locally.

For a local JSON file such as `swagger.json`, if it contains keys besides `paths`, the original file is first copied to `swagger.full.json` and then the original `swagger.json` is overwritten with only `{ "paths": ... }`. The runtime continues resolving schemas from the `.full.json` copy, so definitions and `$ref`s are preserved.

No generated schema module/file is created.

## Lazy request schemas

Every receiving route starts with an empty learned schema.

The first request is the learning request. ChappieAutoAPI infers the request shape from the real payload and keeps that schema in memory for the running test process.

Validation starts only with the second request. The learned schema is intentionally not written to disk.

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

## Introspection

    GET /__chappie/routes
