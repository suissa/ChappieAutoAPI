// A route file is the only API-specific declaration required.
// Schemas are intentionally omitted: they are discovered from OPENAPI_URL.

export default {
  method: "POST",
  route: "/orders",

  // Omit responseRoute for synchronous behavior.
  // responseRoute: "/orders/{id}",

  handler: async ({ request, schema }) => ({
    received: request.body,
    inputSchema: schema.input,
    outputSchema: schema.output
  })
};
