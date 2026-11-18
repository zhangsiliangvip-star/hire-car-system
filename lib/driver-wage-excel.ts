import { prepareCompanyWageExport, prepareDriverWageExport, wageVehicleNumber, type CompanyWagePrintData, type DriverWagePrintData } from "@/lib/driver-wage-print";
import type { Cell, Workbook, Worksheet } from "exceljs";
import { companyExportLines } from "@/lib/company-export";

const moneyFormat = '#,##0;[Red]-#,##0;0';
const borderColor = "CBD5E1";

function styleRow(sheet: Worksheet, rowNumber: number, fill?: string, bold = false, columns = 10) {
  const row = sheet.getRow(rowNumber);
  row.height = 21;
  for (let column = 1; column <= columns; column += 1) {
    const cell = row.getCell(column);
    cell.font = { name: "Yu Gothic", size: 10, bold, color: { argb: "FF172033" } };
    cell.alignment = { vertical: "middle", horizontal: column >= 4 ? "right" : "center" };
    cell.border = {
      top: { style: "thin", color: { argb: `FF${borderColor}` } },
      bottom: { style: "thin", color: { argb: `FF${borderColor}` } },
      left: { style: "thin", color: { argb: `FF${borderColor}` } },
      right: { style: "thin", color: { argb: `FF${borderColor}` } },
    };
    if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } };
    if (column >= 4) cell.numFmt = column === 5 ? "0.##" : moneyFormat;
  }
}

function formula(cell: Cell, expression: string, result: number) {
  cell.value = { formula: expression, result };
}

export async function buildDriverWageWorkbook(data: DriverWagePrintData) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hire Car System";
  workbook.title = `${data.month}月給与明細`;
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("給与明細", {
    views: [{ state: "normal", showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, printTitlesRow: "7:7",
      margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    },
    headerFooter: { oddFooter: "&C&P / &N" },
  });
  sheet.columns = [9, 24, 7, 10, 6, 10, 8, 10, 10, 12].map(width => ({ width }));
  const { rows, totals, manualWageTotal, days } = prepareDriverWageExport(data);
  sheet.mergeCells("A1:J1");
  sheet.getCell("A1").value = workbook.title;
  sheet.getCell("A1").font = { name: "Yu Gothic", size: 18, bold: true, color: { argb: "FF172033" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 32;
  sheet.mergeCells("A2:G2");
  const driverLines = companyExportLines(data.driver);
  sheet.getCell("A2").value = driverLines.join("\n");
  sheet.mergeCells("H2:J2");
  sheet.getCell("H2").value = `有記録日数：${days} 日`;
  for (const address of ["A2", "H2"]) {
    sheet.getCell(address).font = { name: "Yu Gothic", size: 10, bold: true };
    sheet.getCell(address).alignment = { vertical: "middle", horizontal: address === "A2" ? "left" : "right", wrapText: address === "A2" };
  }
  sheet.getRow(2).height = driverLines.length > 1 ? 34 : 23;
  sheet.getRow(3).height = 6;
  sheet.getRow(6).height = 8;
  for (const [first, last, label] of [[1, 2, "立替"], [3, 5, "工資総额"], [6, 7, "追加項目"], [8, 10, "支付総额"]] as const) {
    for (const row of [4, 5]) {
      sheet.mergeCells(row, first, row, last);
      const cell = sheet.getCell(row, first);
      cell.font = { name: "Yu Gothic", size: row === 5 ? 16 : 10, bold: row === 5, color: { argb: "FF172033" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: first === 8 ? "FFDBEAFE" : "FFF1F5F9" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.numFmt = moneyFormat;
    }
    sheet.getCell(4, first).value = label;
  }
  sheet.getRow(4).height = 19;
  sheet.getRow(5).height = 27;
  sheet.getRow(7).values = ["服务日期", "訂単名称", "車番", "立替", "超時 h", "超時工資", "奖励", "比例工資", "固定工資", "支付総额"];
  styleRow(sheet, 7, "DBEAFE", true);
  sheet.getRow(7).height = 30;
  sheet.getRow(7).eachCell(cell => { cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
  rows.forEach((row, index) => {
    const rowNumber = index + 8;
    sheet.getRow(rowNumber).values = [
      new Date(`${row.serviceDate}T00:00:00Z`), row.customer,
      row.isOutsourcedVehicle ? "" : wageVehicleNumber(row.vehicleNumber),
      row.driverAdvances, row.overtimeHours, row.overtimeFee, row.bonusWage,
      row.percentageWage, row.fixedWage,
    ];
    styleRow(sheet, rowNumber, index % 2 ? "F8FAFC" : undefined);
    sheet.getCell(rowNumber, 1).numFmt = "mm-dd";
    sheet.getCell(rowNumber, 2).alignment = { horizontal: "left", vertical: "middle", wrapText: false };
    sheet.getCell(rowNumber, 3).numFmt = "@";
    formula(sheet.getCell(rowNumber, 10), `D${rowNumber}+SUM(F${rowNumber}:I${rowNumber})`, row.driverAdvances + row.totalWage);
  });
  const totalRow = rows.length + 8;
  styleRow(sheet, totalRow, "E2E8F0", true);
  sheet.mergeCells(totalRow, 1, totalRow, 3);
  sheet.getCell(totalRow, 1).value = "月度合计";
  const values = [totals.driverAdvances, totals.overtimeHours, totals.overtimeFee, totals.bonusWage,
    totals.percentageWage, totals.fixedWage, totals.driverAdvances + totals.totalWage];
  for (let column = 4; column <= 10; column += 1) {
    const cell = sheet.getCell(totalRow, column);
    formula(cell, rows.length ? `SUM(${cell.address.replace(/\d+$/, "")}8:${cell.address.replace(/\d+$/, "")}${totalRow - 1})` : "0", values[column - 4]);
  }
  let finalRow = totalRow;
  if (data.manualItems.length) {
    const headingRow = totalRow + 2;
    sheet.mergeCells(headingRow, 1, headingRow, 10);
    sheet.getCell(headingRow, 1).value = "追加項目";
    sheet.getCell(headingRow, 1).font = { name: "Yu Gothic", size: 11, bold: true };
    sheet.getRow(headingRow).height = 25;
    data.manualItems.forEach((item, index) => {
      const rowNumber = headingRow + index + 1;
      styleRow(sheet, rowNumber);
      sheet.mergeCells(rowNumber, 1, rowNumber, 8);
      sheet.mergeCells(rowNumber, 9, rowNumber, 10);
      sheet.getCell(rowNumber, 1).value = item.name;
      sheet.getCell(rowNumber, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      sheet.getRow(rowNumber).height = Math.max(21, Math.ceil([...item.name].length / 42) * 16);
      sheet.getCell(rowNumber, 9).value = item.amount;
    });
    finalRow = headingRow + data.manualItems.length + 1;
    styleRow(sheet, finalRow, "E2E8F0", true);
    sheet.mergeCells(finalRow, 1, finalRow, 8);
    sheet.mergeCells(finalRow, 9, finalRow, 10);
    sheet.getCell(finalRow, 1).value = "追加項目合计";
    formula(sheet.getCell(finalRow, 9), `SUM(I${headingRow + 1}:I${finalRow - 1})`, manualWageTotal);
  }
  formula(sheet.getCell("A5"), `D${totalRow}`, totals.driverAdvances);
  formula(sheet.getCell("C5"), `SUM(F${totalRow}:I${totalRow})`, totals.totalWage);
  formula(sheet.getCell("F5"), data.manualItems.length ? `I${finalRow}` : "0", manualWageTotal);
  formula(sheet.getCell("H5"), "A5+C5+F5", totals.driverAdvances + totals.totalWage + manualWageTotal);
  sheet.pageSetup.printArea = `A1:J${finalRow}`;
  return workbook;
}

export async function buildCompanyWageWorkbook(data: CompanyWagePrintData) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hire Car System";
  workbook.title = "所属会社全员工資総表";
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("全员工資総表", {
    views: [{ state: "normal", showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, printTitlesRow: "7:7",
      margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    },
    headerFooter: { oddFooter: "&C&P / &N" },
  });
  sheet.columns = [6, 19, 8, 12, 12, 10, 12, 12, 14].map(width => ({ width }));
  const { rows, manualWageTotal } = prepareCompanyWageExport(data);
  sheet.mergeCells("A1:I1");
  sheet.getCell("A1").value = workbook.title;
  sheet.getCell("A1").font = { name: "Yu Gothic", size: 18, bold: true, color: { argb: "FF172033" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 32;
  sheet.mergeCells("A2:E2");
  const companyLines = companyExportLines(data.company);
  sheet.getCell("A2").value = companyLines.join("\n");
  sheet.mergeCells("F2:I2");
  sheet.getCell("F2").value = `月份：${data.month}　運転士人数：${rows.length} 人`;
  for (const address of ["A2", "F2"]) {
    sheet.getCell(address).font = { name: "Yu Gothic", size: 10, bold: true };
    sheet.getCell(address).alignment = { horizontal: address === "A2" ? "left" : "right", vertical: "middle", wrapText: true };
  }
  sheet.getRow(2).height = companyLines.length > 1 ? 34 : 23;
  sheet.getRow(3).height = 6;
  sheet.getRow(6).height = 8;
  for (const [first, last, label] of [[1, 2, "立替"], [3, 4, "工資総额"], [5, 6, "追加項目"], [7, 9, "支付総额"]] as const) {
    for (const row of [4, 5]) {
      sheet.mergeCells(row, first, row, last);
      const cell = sheet.getCell(row, first);
      cell.font = { name: "Yu Gothic", size: row === 5 ? 16 : 10, bold: row === 5, color: { argb: "FF172033" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: first === 7 ? "FFDBEAFE" : "FFF1F5F9" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.numFmt = moneyFormat;
    }
    sheet.getCell(4, first).value = label;
  }
  sheet.getRow(4).height = 19;
  sheet.getRow(5).height = 27;
  sheet.getRow(7).values = ["序号", "運転士", "記録日数", "立替", "超時工資", "奖励", "比例工資", "固定工資", "支付総额"];
  styleRow(sheet, 7, "DBEAFE", true, 9);
  sheet.getRow(7).height = 30;
  sheet.getRow(7).eachCell(cell => { cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
  rows.forEach((row, index) => {
    const rowNumber = index + 8;
    sheet.getRow(rowNumber).values = [index + 1, row.driver, row.dates.size, row.advances,
      row.overtime, row.bonus, row.percentage, row.fixed];
    styleRow(sheet, rowNumber, index % 2 ? "F8FAFC" : undefined, false, 9);
    sheet.getCell(rowNumber, 2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.getRow(rowNumber).height = Math.max(21, Math.ceil([...row.driver].length / 9) * 16);
    sheet.getCell(rowNumber, 5).numFmt = moneyFormat;
    formula(sheet.getCell(rowNumber, 9), `SUM(D${rowNumber}:H${rowNumber})`, row.advances + row.wages);
  });
  const totalRow = rows.length + 8;
  styleRow(sheet, totalRow, "E2E8F0", true, 9);
  sheet.mergeCells(totalRow, 1, totalRow, 3);
  sheet.getCell(totalRow, 1).value = "合计";
  const sum = (key: "advances" | "overtime" | "bonus" | "percentage" | "fixed" | "wages") =>
    rows.reduce((total, row) => total + row[key], 0);
  const totals = [sum("advances"), sum("overtime"), sum("bonus"), sum("percentage"), sum("fixed"), sum("advances") + sum("wages")];
  for (let column = 4; column <= 9; column += 1) {
    const cell = sheet.getCell(totalRow, column);
    const letter = cell.address.replace(/\d+$/, "");
    cell.numFmt = moneyFormat;
    formula(cell, rows.length ? `SUM(${letter}8:${letter}${totalRow - 1})` : "0", totals[column - 4]);
  }
  let finalRow = totalRow;
  if (data.manualItems.length) {
    const headingRow = totalRow + 2;
    sheet.mergeCells(headingRow, 1, headingRow, 9);
    sheet.getCell(headingRow, 1).value = "追加項目";
    sheet.getCell(headingRow, 1).font = { name: "Yu Gothic", size: 11, bold: true };
    sheet.getRow(headingRow).height = 25;
    const headerRow = headingRow + 1;
    const writeManualRow = (rowNumber: number, values: (string | number)[], header = false) => {
      styleRow(sheet, rowNumber, header ? "DBEAFE" : undefined, header, 9);
      for (const [index, [first, last]] of [[1, 2], [3, 5], [6, 7], [8, 9]].entries()) {
        sheet.mergeCells(rowNumber, first, rowNumber, last);
        sheet.getCell(rowNumber, first).value = values[index];
        sheet.getCell(rowNumber, first).alignment = { horizontal: index === 3 && !header ? "right" : "center", vertical: "middle", wrapText: true };
        if (index === 3) sheet.getCell(rowNumber, first).numFmt = moneyFormat;
      }
    };
    writeManualRow(headerRow, ["運転士", "所属会社", "项目", "金額（JPY）"], true);
    data.manualItems.forEach((item, index) => {
      const rowNumber = headerRow + index + 1;
      const company = companyExportLines(item.companyName || "未设置");
      writeManualRow(rowNumber, [item.driver, company.join("\n"), item.name, item.amount]);
      const lines = Math.max(Math.ceil([...item.driver].length / 12), company.reduce((count, line) => count + Math.ceil([...line].length / 17), 0), Math.ceil([...item.name].length / 12));
      sheet.getRow(rowNumber).height = Math.max(21, lines * 16);
    });
    finalRow = headerRow + data.manualItems.length + 1;
    styleRow(sheet, finalRow, "E2E8F0", true, 9);
    sheet.mergeCells(finalRow, 1, finalRow, 7);
    sheet.mergeCells(finalRow, 8, finalRow, 9);
    sheet.getCell(finalRow, 1).value = "追加項目合计";
    formula(sheet.getCell(finalRow, 8), `SUM(H${headerRow + 1}:H${finalRow - 1})`, manualWageTotal);
  }
  formula(sheet.getCell("A5"), `D${totalRow}`, sum("advances"));
  formula(sheet.getCell("C5"), `SUM(E${totalRow}:H${totalRow})`, sum("wages"));
  formula(sheet.getCell("E5"), data.manualItems.length ? `H${finalRow}` : "0", manualWageTotal);
  formula(sheet.getCell("G5"), "A5+C5+E5", sum("advances") + sum("wages") + manualWageTotal);
  sheet.pageSetup.printArea = `A1:I${finalRow}`;
  return workbook;
}

async function downloadWageWorkbook(workbook: Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(new Uint8Array(buffer));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "") || "工资表"}.xlsx`;
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

export async function downloadDriverWageExcel(data: DriverWagePrintData) {
  await downloadWageWorkbook(await buildDriverWageWorkbook(data), `${data.month}月給与明細-${data.driver}`);
}

export async function downloadCompanyWageExcel(data: CompanyWagePrintData) {
  await downloadWageWorkbook(await buildCompanyWageWorkbook(data), `${data.month}会社全员工資総表-${data.company}`);
}
