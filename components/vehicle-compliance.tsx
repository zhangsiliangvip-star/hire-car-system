import { getVehicleExpiryState, splitVehicleOwner } from "@/lib/vehicle-compliance";

export function VehicleOwnerLabel({ owner }: { owner: string }) {
  const { company, office } = splitVehicleOwner(owner);
  return <span className="vehicle-owner-label">
    <span className="vehicle-owner-company">{company || "-"}</span>
    {office && <span className="vehicle-owner-office">{office}</span>}
  </span>;
}

function ExpiryDate({ expiry, today, expiredLabel }: { expiry: string; today: string; expiredLabel: string }) {
  const state = getVehicleExpiryState(expiry, today);
  const description = state === "expired" ? expiredLabel : state === "warning" ? "1か月以内に期限到来" : "";
  return <span className={`vehicle-expiry vehicle-expiry--${state}`} data-expiry-state={state}
    title={description || undefined}>
    {expiry ? <time dateTime={expiry}>{expiry}</time> : "-"}
    {description && <span className="sr-only">（{description}）</span>}
  </span>;
}

export function VehicleExpiryDate({ expiry, today }: { expiry: string; today: string }) {
  return <ExpiryDate expiry={expiry} today={today} expiredLabel="期限切れ・停运中" />;
}

export function DriverLicenseDate({ expiry, today }: { expiry: string; today: string }) {
  return <ExpiryDate expiry={expiry} today={today} expiredLabel="免許期限切れ・運転士不可用" />;
}
