type ErrorPayload = { error?: string };

function isErrorPayload(payload: unknown): payload is ErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.length > 0
  );
}

export async function readJsonSafely(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function buildApiErrorMessage(
  response: Response,
  payload: unknown,
  fallback: string,
) {
  if (isErrorPayload(payload)) return payload.error;
  if (response.status === 401) return "登录状態已失效，请重新登录后重试。";
  if (response.status === 403) return "当前账号没有权限执行此操作。";
  return `${fallback}（HTTP ${response.status}）`;
}
