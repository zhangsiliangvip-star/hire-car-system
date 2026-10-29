export function isDriverPwaTestMode(
  environment: Record<string, string | undefined> = process.env,
) {
  const project = environment.DRIVER_PWA_TEST_MODE;
  if (!project) return false;
  if (
    project !== "zsipqwipauzgbqvppwjf" ||
    environment.NEXT_PUBLIC_SUPABASE_URL !==
      "https://zsipqwipauzgbqvppwjf.supabase.co"
  ) {
    throw new Error("Driver test mode requires the selected isolated Supabase project.");
  }
  return true;
}

export function isDriverPwaEnabled(
  environment: Record<string, string | undefined> = process.env,
) {
  const test = isDriverPwaTestMode(environment);
  const production = environment.DRIVER_PWA_PRODUCTION_PROJECT;
  if (!production) return test;
  if (
    test ||
    production !== "acuhvzpsitnevfztbbtv" ||
    environment.NEXT_PUBLIC_SUPABASE_URL !==
      "https://acuhvzpsitnevfztbbtv.supabase.co"
  ) {
    throw new Error("Driver production mode requires the selected production Supabase project.");
  }
  return true;
}

export function isDriverPath(pathname: string) {
  return (
    pathname === "/driver" ||
    pathname.startsWith("/driver/") ||
    pathname === "/api/driver" ||
    pathname.startsWith("/api/driver/")
  );
}
