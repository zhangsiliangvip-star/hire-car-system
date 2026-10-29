import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const testProjectRef = "zsipqwipauzgbqvppwjf";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedKeys = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export function createTestEnvironment(values, inherited = {}, envFileContents = []) {
  for (const key of Object.keys(values)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported test configuration variable: ${key}`);
    }
  }
  const expectedUrl = `https://${testProjectRef}.supabase.co`;
  if (values.NEXT_PUBLIC_SUPABASE_URL !== expectedUrl) {
    throw new Error(`Test startup refused: URL must be exactly ${expectedUrl}`);
  }
  const key = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key || key.includes("REPLACE_")) {
    throw new Error("Set the selected test project's publishable key in .env.driver-pwa.local.");
  }
  if (!key.startsWith("sb_publishable_")) {
    let payload;
    try {
      const parts = key.split(".");
      if (parts.length !== 3) throw new Error("Invalid JWT structure");
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("Expected a publishable key or legacy anon JWT, not a secret key.");
    }
    if (payload.role !== "anon" || payload.ref !== testProjectRef) {
      throw new Error("Legacy key must have role anon and match the selected test project.");
    }
  }
  const adminKey = values.SUPABASE_SERVICE_ROLE_KEY || "";
  if (adminKey && !adminKey.startsWith("sb_secret_")) {
    let payload;
    try { payload = JSON.parse(Buffer.from(adminKey.split(".")[1], "base64url").toString("utf8")); }
    catch { throw new Error("Optional admin key must be the isolated project's secret or service-role key."); }
    if (payload.role !== "service_role" || payload.ref !== testProjectRef)
      throw new Error("Admin key must have role service_role and match the isolated test project.");
  }
  const environment = { ...inherited };
  // Defined empty values prevent Next's dotenv loader from restoring production credentials.
  for (const contents of envFileContents) {
    for (const name of Object.keys(parseEnv(contents))) environment[name] = "";
  }
  for (const name of Object.keys(environment)) {
    if (/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|DATABASE_URL$|POSTGRES_|VERCEL_)/.test(name)) {
      environment[name] = "";
    }
  }
  return {
    ...environment,
    ...values,
    SUPABASE_SERVICE_ROLE_KEY: adminKey,
    DELETE_CONFIRMATION_PASSWORD: "",
    NODE_ENV: "development",
    DRIVER_PWA_TEST_MODE: testProjectRef,
  };
}

export async function verifyTestConnection(environment, fetcher = fetch) {
  const response = await fetcher(
    `https://${testProjectRef}.supabase.co/auth/v1/settings`,
    {
      headers: { apikey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
  );
  if (!response.ok) {
    throw new Error(`Selected test project rejected the publishable key (HTTP ${response.status}).`);
  }
  if (environment.SUPABASE_SERVICE_ROLE_KEY) {
    const adminResponse = await fetcher(`https://${testProjectRef}.supabase.co/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: environment.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${environment.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
    if (!adminResponse.ok) throw new Error(`Selected test project rejected the optional admin key (HTTP ${adminResponse.status}).`);
  }
}

function readOptionalEnv(filename) {
  try {
    return readFileSync(join(root, filename), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function main() {
  const [mode = "--check", ...extra] = process.argv.slice(2);
  if (!["--check", "--start"].includes(mode) || extra.length) {
    throw new Error("Usage: node scripts/driver-pwa-dev.mjs [--check|--start]");
  }
  const contents = readOptionalEnv(".env.driver-pwa.local");
  if (!contents) {
    throw new Error(
      "Missing .env.driver-pwa.local. Copy the configuration from docs/driver-pwa-plan.md; do not copy .env.local.",
    );
  }
  const environment = createTestEnvironment(
    parseEnv(contents),
    process.env,
    [".env", ".env.local", ".env.development", ".env.development.local"].map(readOptionalEnv),
  );
  console.log(`Test project validated: ${testProjectRef}`);
  console.log(`Production environment files unchanged; isolated account administration ${environment.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "disabled"}; separate Next build directory.`);
  if (mode === "--check") {
    console.log("Configuration check only: no server started, no network requests or database changes.");
    return;
  }
  await verifyTestConnection(environment);
  console.warn("Test schema readiness is NOT certified by this launcher. Do not use existing production accounts.");
  const child = spawn(
    process.execPath,
    [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", "3100", "--hostname", "0.0.0.0"],
    { cwd: root, env: environment, stdio: "inherit" },
  );
  child.on("error", (error) => {
    console.error(`Test server failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Test server stopped by signal: ${signal}`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
