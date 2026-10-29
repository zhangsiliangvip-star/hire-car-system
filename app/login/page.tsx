import LoginForm from "@/app/login/login-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSafeNextPath(value: string | string[] | undefined) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  const origin = "http://localhost";
  const destination = new URL(value, origin);
  return destination.origin === origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const errorMessage =
    params.error === "auth_callback_failed"
      ? "邮箱验证链接已失效或无法验证，請联系管理员重新邀請。"
      : "";

  return (
    <LoginForm
      initialErrorMessage={errorMessage}
      nextPath={getSafeNextPath(params.next)}
    />
  );
}
