import { buildDriverWagePrintHtml, type DriverWagePrintData } from "@/lib/driver-wage-print";

type DownloadDirectory = {
  getFileHandle(name: string, options?: { create: boolean }): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }>;
  }>;
};

export function driverWagePdfFilename(driver: string, month: string) {
  return `${driver.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "") || "司机"}${month}.pdf`;
}

export function wagePdfPageBreaks(height: number, pageHeight: number, blocks: readonly { top: number; bottom: number }[]) {
  const breaks = [0];
  while (breaks[breaks.length - 1] < height) {
    const offset = breaks[breaks.length - 1];
    let end = Math.min(offset + pageHeight, height);
    for (const block of blocks) {
      if (block.top > offset && block.top < end && block.bottom > end) end = block.top;
    }
    breaks.push(end);
  }
  return breaks;
}

export async function renderDriverWagePdf(data: DriverWagePrintData) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const frame = document.createElement("iframe");
  frame.title = "工资单PDF生成";
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1120px;border:0";
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("无法创建工资单PDF页面。");
    doc.open();
    doc.write(buildDriverWagePrintHtml(data));
    doc.close();
    await doc.fonts.ready;
    const content = doc.querySelector<HTMLElement>(".content");
    const sheet = doc.querySelector<HTMLElement>(".sheet");
    if (!content || !sheet) throw new Error("工资单PDF模板载入失败。");
    sheet.style.height = "auto";
    sheet.style.overflow = "visible";
    const canvas = await html2canvas(content, { scale: 2, backgroundColor: "#ffffff" });
    const ratio = canvas.width / content.getBoundingClientRect().width;
    const top = content.getBoundingClientRect().top;
    const blocks = [...content.querySelectorAll("tr, h1, h2, p, .summary, .notes, footer")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: Math.floor((rect.top - top) * ratio), bottom: Math.ceil((rect.bottom - top) * ratio) };
    });
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const breaks = wagePdfPageBreaks(canvas.height, Math.floor(canvas.width * 277 / 190), blocks);
    for (let index = 0; index < breaks.length - 1; index += 1) {
      if (index) pdf.addPage();
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = breaks[index + 1] - breaks[index];
      const context = slice.getContext("2d");
      if (!context) throw new Error("无法生成工资单PDF图像。");
      context.drawImage(canvas, 0, breaks[index], slice.width, slice.height, 0, 0, slice.width, slice.height);
      pdf.addImage(slice.toDataURL("image/jpeg", 0.95), "JPEG", 10, 10, 190, slice.height * 190 / slice.width);
    }
    return pdf.output("blob");
  } finally {
    frame.remove();
  }
}

export async function downloadDriverWageBatch(data: readonly DriverWagePrintData[]) {
  const pickerWindow = window as Window & {
    showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<DownloadDirectory>;
  };
  if (!pickerWindow.showDirectoryPicker) throw new Error("该浏览器不支持选择下载文件夹，请使用桌面版Chrome或Edge。");
  const names = data.map((item) => driverWagePdfFilename(item.driver, item.month));
  if (new Set(names).size !== names.length) throw new Error("司机姓名生成的文件名重复，请调整姓名后重试，避免覆盖工资单。");
  let directory: DownloadDirectory;
  try {
    directory = await pickerWindow.showDirectoryPicker({ mode: "readwrite" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  }
  const existing: string[] = [];
  for (const name of names) {
    try {
      await directory.getFileHandle(name);
      existing.push(name);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }
  if (existing.length && !confirm(`所选文件夹已有${existing.length}份同名工资单，是否覆盖？\n${existing.join("\n")}`)) return;
  let saved = 0;
  for (const [index, item] of data.entries()) {
    try {
      const blob = await renderDriverWagePdf(item);
      const file = await directory.getFileHandle(names[index], { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(blob);
        await writable.close();
      } catch (error) {
        await writable.abort();
        throw error;
      }
      saved += 1;
    } catch (error) {
      throw new Error(`已保存${saved}份；${item.driver}工资单下载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  alert(`已将${saved}份工资单保存到所选文件夹。`);
}
