import "server-only";

import { timingSafeEqual } from "node:crypto";

export function verifyDeletePassword(password: string) {
  const configuredPassword = process.env.DELETE_CONFIRMATION_PASSWORD;
  if (!configuredPassword) {
    return { configured: false, valid: false };
  }

  const provided = Buffer.from(password);
  const configured = Buffer.from(configuredPassword);
  const valid =
    provided.length === configured.length && timingSafeEqual(provided, configured);

  return { configured: true, valid };
}
