export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Vary", "Cookie");

  return Response.json(body, { ...init, headers });
}
