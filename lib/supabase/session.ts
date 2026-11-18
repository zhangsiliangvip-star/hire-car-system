export type AuthScope = "staff" | "driver";

export function sessionCookieName(url: string, scope: AuthScope) {
  const project = new URL(url).hostname.split(".")[0];
  const name = `sb-${project}-auth-token`;
  return scope === "driver" ? `${name}-driver` : name;
}
