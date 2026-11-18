import { driverWagePdfFilename, renderPaymentDocumentPdf, savePdfBatchToDirectory } from "@/lib/driver-wage-download";
import { buildDriverPaymentInvoiceHtml, validatePaymentInvoiceDownload, type DriverPaymentInvoice } from "@/lib/driver-payment";

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

export async function downloadDriverPaymentInvoices(invoices: readonly DriverPaymentInvoice[], batch: boolean,
  onProgress: (completed: number, total: number) => void = () => {}) {
  if (!invoices.length) throw new Error("所选月份及会社暂无可下载的請求書。");
  if (!batch && invoices.length !== 1) throw new Error("单份PDF下载只能选择一份請求書。");
  invoices.forEach(validatePaymentInvoiceDownload);
  const names = invoices.map(invoice => `${invoice.month}${driverWagePdfFilename(invoice.driver.name, "")}`);
  if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) throw new Error("請求書文件名重复，請分别选择司机下载。");
  if (batch) {
    return savePdfBatchToDirectory(invoices.map((invoice, index) => ({
      name: names[index], label: invoice.driver.name,
      render: () => renderPaymentDocumentPdf(buildDriverPaymentInvoiceHtml(invoice)),
    })), "請求書", onProgress);
  }
  for (const [index, invoice] of invoices.entries()) {
    const blob = await renderPaymentDocumentPdf(buildDriverPaymentInvoiceHtml(invoice));
    saveBlob(blob, names[index]);
    onProgress(index + 1, invoices.length);
  }
  return "saved";
}
