import { z } from "zod";

const flightNumberSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/);
const serviceDateSchema = z.iso.date();
const arrivalAirportSchema = z.enum(["HND", "NRT", "KIX", "CTS", "ITM"]);
const delaySchema = z.union([z.number(), z.string()]).nullish();
const flightIdentitySchema = z.object({
  iata: z.string().nullish(),
  iataNumber: z.string().nullish(),
  number: z.string().nullish(),
  codeshared: z.object({
    flight_iata: z.string().nullish(),
    flight_number: z.string().nullish(),
    airline_iata: z.string().nullish(),
  }).passthrough().nullish(),
}).passthrough().nullish();
const airlineSchema = z.object({
  iata: z.string().nullish(),
  iataCode: z.string().nullish(),
}).passthrough().nullish();
const arrivalSchema = z.object({
  iata: z.string().nullish(),
  iataCode: z.string().nullish(),
  actual: z.string().nullish(),
  estimated: z.string().nullish(),
  scheduled: z.string().nullish(),
  terminal: z.string().nullish(),
  delay: delaySchema,
  timezone: z.string().nullish(),
}).passthrough();
const flightSchema = z.object({
  flight_date: z.string().nullish(),
  flight_status: z.string().nullish(),
  flight: flightIdentitySchema,
  airline: airlineSchema,
  arrival: arrivalSchema.nullish(),
  departure: z.object({ delay: delaySchema }).passthrough().nullish(),
}).passthrough();
const providerErrorSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  message: z.string().optional(),
}).passthrough();
const responseSchema = z.object({
  data: z.array(flightSchema).optional(),
  error: providerErrorSchema.optional(),
}).passthrough();
export type FlightStatus = "tracking_pending" | "scheduled" | "delayed" | "en_route" | "landed" | "cancelled" | "diverted" | "unknown" | "not_found";
export type AviationstackFlightStatus = {
  flightNumber: string;
  status: FlightStatus;
  terminal: string | null;
  arrivalTime: string | null;
  updatedAt: string;
};

export class AviationstackError extends Error {
  constructor(readonly code: "not_configured" | "request_failed" | "bad_response") {
    super(code);
  }
}

const cache = new Map<string, { expiresAt: number; value: AviationstackFlightStatus }>();
const CACHE_TTL_MS = 5 * 60_000;

const pickupAirportAliases: Record<z.infer<typeof arrivalAirportSchema>, readonly string[]> = {
  HND: ["羽田", "haneda"],
  NRT: ["成田", "narita"],
  KIX: ["関西国際空港", "関西空港", "関西机场", "kansai international airport", "kansai airport"],
  CTS: ["新千歳", "新千岁", "new chitose"],
  ITM: ["伊丹", "大阪国際空港", "大阪国际机场", "itami", "osaka international airport"],
};

export function inferArrivalAirportFromPickup(pickup: string): z.infer<typeof arrivalAirportSchema> | null {
  const normalized = pickup.normalize("NFKC").toLowerCase();
  const matches = (Object.entries(pickupAirportAliases) as [z.infer<typeof arrivalAirportSchema>, readonly string[]][])
    .filter(([code, aliases]) =>
      new RegExp(`(^|[^a-z0-9])${code.toLowerCase()}([^a-z0-9]|$)`).test(normalized) ||
      aliases.some((alias) => normalized.includes(alias.toLowerCase())),
    )
    .map(([code]) => code);
  return matches.length === 1 ? matches[0] : null;
}

function cacheStatus(key: string, value: AviationstackFlightStatus, ttl: number) {
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= Date.now()) cache.delete(cachedKey);
  }
  if (cache.size >= 500) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + ttl, value });
}

function isoDateTime(value: string | null | undefined, timezone: string | null | undefined) {
  const dateTime = value?.trim();
  if (!dateTime) return null;

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(dateTime)) {
    const instant = new Date(dateTime);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  }

  const match = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!match || !timezone?.trim()) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fractionText = "0"] = match;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const milliseconds = Number(fractionText.padEnd(3, "0"));
  const localTime = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const parsedLocalTime = new Date(localTime);
  if (parsedLocalTime.getUTCFullYear() !== year ||
      parsedLocalTime.getUTCMonth() !== month - 1 ||
      parsedLocalTime.getUTCDate() !== day ||
      parsedLocalTime.getUTCHours() !== hour ||
      parsedLocalTime.getUTCMinutes() !== minute ||
      parsedLocalTime.getUTCSeconds() !== second ||
      parsedLocalTime.getUTCMilliseconds() !== milliseconds) return null;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone.trim(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }

  let utcTime = localTime;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = formatter.formatToParts(new Date(utcTime));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    const representedLocalTime = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
      milliseconds,
    );
    utcTime += localTime - representedLocalTime;
  }
  return new Date(utcTime).toISOString();
}

function flightStatus(flight: z.infer<typeof flightSchema>): FlightStatus {
  const status = (flight.flight_status ?? "").trim().toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (status === "diverted") return "diverted";
  if (status === "landed" || flight.arrival?.actual?.trim()) return "landed";
  if (status === "active") return "en_route";
  const delay = Number(flight.arrival?.delay ?? flight.departure?.delay);
  if (status === "delayed" || (status === "scheduled" && Number.isFinite(delay) && delay > 0)) return "delayed";
  if (status === "scheduled") return "scheduled";
  return "unknown";
}

function flightIdentifiers(flight: {
  flight?: {
    iata?: string | null;
    iataNumber?: string | null;
    number?: string | null;
    codeshared?: { flight_iata?: string | null; flight_number?: string | null; airline_iata?: string | null } | null;
  } | null;
  airline?: { iata?: string | null; iataCode?: string | null } | null;
}) {
  const airline = (flight.airline?.iata ?? flight.airline?.iataCode)?.replace(/\s+/g, "").toUpperCase();
  const codeshare = flight.flight?.codeshared;
  return [
    flight.flight?.iata,
    flight.flight?.iataNumber,
    flight.flight?.number && airline ? `${airline}${flight.flight.number}` : null,
    codeshare?.flight_iata,
    codeshare?.flight_number && codeshare.airline_iata ? `${codeshare.airline_iata}${codeshare.flight_number}` : null,
  ]
    .filter((identifier): identifier is string => Boolean(identifier))
    .map((identifier) => identifier.replace(/\s+/g, "").toUpperCase());
}

function japanDate(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function statusValue(
  flightNumber: string,
  status: FlightStatus,
  terminal: string | null,
  arrivalTime: string | null,
): AviationstackFlightStatus {
  return { flightNumber, status, terminal, arrivalTime, updatedAt: new Date().toISOString() };
}

function notFoundValue(flightNumber: string): AviationstackFlightStatus {
  return statusValue(flightNumber, "not_found", null, null);
}

async function fetchJson(url: URL, request: typeof fetch) {
  let response: Response;
  try {
    response = await request(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AviationstackError("request_failed");
  }
  if (!response.ok) throw new AviationstackError("request_failed");

  try {
    return await response.json() as unknown;
  } catch {
    throw new AviationstackError("bad_response");
  }
}

export async function getAviationstackFlightStatus(
  inputFlightNumber: string,
  inputServiceDate: string,
  inputArrivalAirport: z.infer<typeof arrivalAirportSchema>,
  apiKey = process.env.AVIATIONSTACK_API_KEY,
  request: typeof fetch = fetch,
): Promise<AviationstackFlightStatus> {
  const flightNumber = flightNumberSchema.parse(inputFlightNumber.replace(/\s+/g, ""));
  const serviceDate = serviceDateSchema.parse(inputServiceDate);
  const arrivalAirport = arrivalAirportSchema.parse(inputArrivalAirport);

  const cacheKey = `${flightNumber}:${arrivalAirport}:${serviceDate}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const today = japanDate(new Date());
  if (serviceDate > today) {
    const value = statusValue(flightNumber, "tracking_pending", null, null);
    cacheStatus(cacheKey, value, CACHE_TTL_MS);
    return value;
  }

  if (!apiKey?.trim()) throw new AviationstackError("not_configured");

  const url = new URL("https://api.aviationstack.com/v1/flights");
  url.searchParams.set("access_key", apiKey);
  url.searchParams.set("flight_iata", flightNumber);
  url.searchParams.set("arr_iata", arrivalAirport);
  url.searchParams.set("arr_scheduled_time_arr", serviceDate);

  const parsed = responseSchema.safeParse(await fetchJson(url, request));
  if (!parsed.success) throw new AviationstackError("bad_response");
  if (parsed.data.error) throw new AviationstackError("request_failed");
  if (!parsed.data.data) throw new AviationstackError("bad_response");

  const flight = parsed.data.data.find((item) => {
    if (!flightIdentifiers(item).includes(flightNumber)) return false;
    const airportCode = item.arrival?.iata ?? item.arrival?.iataCode;
    if (airportCode && airportCode.toUpperCase() !== arrivalAirport) return false;
    const arrivalTime = item.arrival?.actual ?? item.arrival?.estimated ?? item.arrival?.scheduled;
    if (!arrivalTime) return true;
    const instant = isoDateTime(arrivalTime, item.arrival?.timezone ?? "Asia/Tokyo");
    return instant !== null && japanDate(new Date(instant)) === serviceDate;
  });
  const value = flight
    ? statusValue(
        flightNumber,
        flightStatus(flight),
        flight.arrival?.terminal?.trim().slice(0, 80) || null,
        isoDateTime(
          flight.arrival?.actual ?? flight.arrival?.estimated ?? flight.arrival?.scheduled,
          flight.arrival?.timezone ?? "Asia/Tokyo",
        ),
      )
    : notFoundValue(flightNumber);

  cacheStatus(cacheKey, value, flight ? CACHE_TTL_MS : 60_000);
  return value;
}
