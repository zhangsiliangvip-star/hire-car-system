import { z } from "zod";

export const driverBankSchema = z.object({
  bankName: z.string().trim().max(200).default(""),
  bankBranch: z.string().trim().max(200).default(""),
  bankAccountType: z.enum(["", "普通", "当座", "貯蓄"]).default(""),
  bankAccountNumber: z.string().trim().max(20).regex(/^[0-9]*$/).default(""),
  bankAccountHolder: z.string().trim().max(200).default(""),
});

export const emptyDriverBank = driverBankSchema.parse({});
export type DriverBank = z.infer<typeof driverBankSchema>;
