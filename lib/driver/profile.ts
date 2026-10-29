import { z } from "zod";

export const driverContactSchema = z.object({
  phone: z.string().trim().max(100),
  wechat: z.string().trim().max(200),
  whatsapp: z.string().trim().max(200),
  licenseExpiry: z.union([z.iso.date(), z.literal("")]),
}).strict();
export const driverProfileSchema = z.object({
  phone: z.string().max(100), wechat: z.string().max(200), whatsapp: z.string().max(200),
  licenseExpiry: z.union([z.iso.date(), z.literal("")]),
  prompted: z.boolean(), version: z.number().int().nonnegative(),
}).strict();
export const driverProfileCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedVersion: z.number().int().nonnegative(),
    ...driverContactSchema.shape }).strict(),
  z.object({ action: z.literal("skip"), expectedVersion: z.number().int().nonnegative() }).strict(),
]);
export const driverLoginSchema = z.object({
  driverId: z.uuid(), userId: z.uuid(), email: z.email(),
  status: z.enum(["active", "suspended", "revoked"]), version: z.number().int().positive(),
}).strict();
export const driverLoginDataSchema = z.object({
  enabled: z.boolean(), canManage: z.boolean(), isAdmin: z.boolean(),
  manageableRegionId: z.uuid().nullable(), accounts: z.array(driverLoginSchema),
}).strict();
export const driverAccountCreateSchema = z.object({
  driverId: z.uuid(), email: z.email().max(320).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128),
}).strict();
export const driverPasswordSchema = z.object({
  driverId: z.uuid(), userId: z.uuid(), expectedVersion: z.number().int().positive(),
  password: z.string().min(8).max(128),
}).strict();
