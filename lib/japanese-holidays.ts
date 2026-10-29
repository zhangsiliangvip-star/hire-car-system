function toDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  const firstWeekday = new Date(year, month, 1).getDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
}

export function getJapaneseHolidays(year: number) {
  const vernalEquinox = Math.floor(
    20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
  );
  const autumnEquinox = Math.floor(
    23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
  );
  const holidays = new Set([
    `${year}-01-01`,
    toDateKey(new Date(year, 0, nthWeekdayOfMonth(year, 0, 1, 2))),
    `${year}-02-11`,
    `${year}-02-23`,
    toDateKey(new Date(year, 2, vernalEquinox)),
    `${year}-04-29`,
    `${year}-05-03`,
    `${year}-05-04`,
    `${year}-05-05`,
    toDateKey(new Date(year, 6, nthWeekdayOfMonth(year, 6, 1, 3))),
    `${year}-08-11`,
    toDateKey(new Date(year, 8, nthWeekdayOfMonth(year, 8, 1, 3))),
    toDateKey(new Date(year, 8, autumnEquinox)),
    toDateKey(new Date(year, 9, nthWeekdayOfMonth(year, 9, 1, 2))),
    `${year}-11-03`,
    `${year}-11-23`,
  ]);

  for (const holiday of [...holidays]) {
    const date = new Date(`${holiday}T00:00:00`);
    if (date.getDay() !== 0) continue;

    const substitute = new Date(date);
    do {
      substitute.setDate(substitute.getDate() + 1);
    } while (holidays.has(toDateKey(substitute)));
    holidays.add(toDateKey(substitute));
  }

  const daysInYear =
    (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime()) /
    86400000;
  for (let day = 2; day < daysInYear; day += 1) {
    const date = new Date(year, 0, day);
    const previousDate = new Date(year, 0, day - 1);
    const nextDate = new Date(year, 0, day + 1);
    if (
      date.getDay() !== 0 &&
      holidays.has(toDateKey(previousDate)) &&
      holidays.has(toDateKey(nextDate))
    ) {
      holidays.add(toDateKey(date));
    }
  }

  return holidays;
}
