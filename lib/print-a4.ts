export async function printA4Html(html: string, title: string) {
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0";
  document.body.appendChild(frame);
  try {
    const printDocument = frame.contentDocument;
    const printWindow = frame.contentWindow;
    if (!printDocument || !printWindow) throw new Error("无法创建打印页面。");
    printDocument.open();
    printDocument.write(html);
    printDocument.close();
    await printDocument.fonts.ready;
    await Promise.all(Array.from(printDocument.images, async (image) => {
      try {
        await image.decode();
      } catch {
        throw new Error("打印图片载入失败，请检查会社印章后重试。");
      }
    }));
    const content = printDocument.querySelector<HTMLElement>(".content");
    const sheet = printDocument.querySelector<HTMLElement>(".sheet");
    if (!content || !sheet) throw new Error("打印版型载入失败。");
    if (content.classList.contains("fit-page-width")) {
      const maxWidth = sheet.clientWidth * 8;
      const fitsPageAspect = () =>
        content.scrollHeight / content.scrollWidth <= sheet.clientHeight / sheet.clientWidth;
      let low = content.scrollWidth;
      let high = low;
      while (!fitsPageAspect() && high < maxWidth) {
        low = high;
        high = Math.min(high * 1.5, maxWidth);
        content.style.width = `${high}px`;
      }
      if (fitsPageAspect()) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const middle = (low + high) / 2;
          content.style.width = `${middle}px`;
          if (fitsPageAspect()) high = middle;
          else low = middle;
        }
        content.style.width = `${high}px`;
      } else {
        content.style.width = `${sheet.clientWidth}px`;
      }
    }
    const scale = Math.min(1, sheet.clientHeight / content.scrollHeight, sheet.clientWidth / content.scrollWidth);
    content.style.transform = `scale(${scale})`;
    printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}
