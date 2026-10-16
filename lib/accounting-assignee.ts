export function getAccountingAssigneeName(
  value: string,
  accounts: readonly { email: string; fullName: string }[],
) {
  if (!value) return "";
  const account = accounts.find((item) => item.email.toLowerCase() === value.toLowerCase());
  if (account) return account.fullName.trim() || "未填写姓名";
  return value.includes("@") ? "历史账号（姓名不可用）" : value;
}
