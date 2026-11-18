import type { Driver } from "@/lib/domain";
import { getJapanDate, getVehicleExpiryState } from "@/lib/vehicle-compliance";

export function isDriverLicenseExpired(driver: Pick<Driver, "licenseExpiry">, today = getJapanDate()) {
  return getVehicleExpiryState(driver.licenseExpiry || "", today) === "expired";
}

export function findExpiredDriver(
  drivers: Driver[], name: string, regionId: string | undefined, today = getJapanDate(),
) {
  return drivers.find(driver => driver.regionId === regionId && driver.name === name.trim() &&
    isDriverLicenseExpired(driver, today));
}

export function findDepartedDriver(drivers: Driver[], name: string, regionId: string | undefined) {
  return drivers.find(driver => driver.regionId === regionId && driver.name === name.trim() &&
    driver.employmentStatus === "離職");
}
