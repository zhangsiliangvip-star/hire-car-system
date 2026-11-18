export const japaneseEras = [
  { name: "令和", start: "2019-05-01", end: "9999-12-31", firstYear: 2019 },
  { name: "平成", start: "1989-01-08", end: "2019-04-30", firstYear: 1989 },
  { name: "昭和", start: "1926-12-25", end: "1989-01-07", firstYear: 1926 },
  { name: "大正", start: "1912-07-30", end: "1926-12-24", firstYear: 1912 },
  { name: "明治", start: "1868-01-25", end: "1912-07-29", firstYear: 1868 },
] as const;

export type JapaneseEraName = typeof japaneseEras[number]["name"];
export type JapaneseEraDate = { era: JapaneseEraName; year: string; month: string; day: string };

export function toGregorianDate(fields: JapaneseEraDate): string {
  const { year, month, day } = fields;
  if (!year && !month && !day) return "";
  if (![year, month, day].every(part => /^\d+$/.test(part))) {
    throw new RangeError("請完整填写和歴年、月、日。");
  }
  const era = japaneseEras.find(item => item.name === fields.era);
  const gregorianYear = (era?.firstYear ?? 0) + Number(year) - 1;
  if (!era || Number(year) < 1 || gregorianYear > 9999 ||
    Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    throw new RangeError("和歴日期无效，請检查年、月、日。");
  }
  const result = `${String(gregorianYear).padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result) {
    throw new RangeError("该日期不存在，請检查月份和天数。");
  }
  if (result < era.start || result > era.end) {
    throw new RangeError(`该日期不属于${era.name}，請检查年号。`);
  }
  return result;
}

export function toJapaneseEraDate(value: string): JapaneseEraDate {
  if (!value) return { era: "令和", year: "", month: "", day: "" };
  const era = japaneseEras.find(item => value >= item.start && value <= item.end);
  if (!era || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("有效期无法转换为和歴。");
  const [year, month, day] = value.split("-");
  const fields: JapaneseEraDate = {
    era: era.name, year: String(Number(year) - era.firstYear + 1),
    month: String(Number(month)), day: String(Number(day)),
  };
  if (toGregorianDate(fields) !== value) throw new RangeError("有效期日期无效。");
  return fields;
}
