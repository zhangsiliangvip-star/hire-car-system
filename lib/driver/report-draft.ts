import { z } from "zod";

const prefix = "driver-report-draft:";
export const reportDraftSchema = z.object({
  reportId: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
  serviceDate: z.iso.date(),
  starting: z.boolean(),
  assignment: z.string().max(100),
  fields: z.record(z.string().max(150), z.string().max(400)),
  stopIds: z.array(z.uuid()).max(100).optional(),
}).strict();
export type ReportDraft = z.infer<typeof reportDraftSchema>;

export const reportCloudDraftSchema = z.object({
  reportId: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
  serviceDate: z.iso.date(),
  assignment: z.string().max(100),
  fields: z.record(z.string().max(150), z.string().max(400))
    .refine(fields => Object.keys(fields).length <= 800),
  stopIds: z.array(z.uuid()).max(100),
}).strict();
export type ReportCloudDraft = z.infer<typeof reportCloudDraftSchema>;

export function readReportDraft(storage: Storage, userId: string): ReportDraft | null {
  const raw = storage.getItem(`${prefix}${userId}`);
  return raw === null ? null : reportDraftSchema.parse(JSON.parse(raw));
}

export function writeReportDraft(storage: Storage, userId: string, draft: ReportDraft | null) {
  if (draft) storage.setItem(`${prefix}${userId}`, JSON.stringify(reportDraftSchema.parse(draft)));
  else storage.removeItem(`${prefix}${userId}`);
}

export function clearReportDrafts(storage: Storage) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) storage.removeItem(key);
  }
}

export function captureReportFields(...roots: (ParentNode | null)[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const root of roots) {
    root?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]").forEach(input => {
      if (input.form?.id) fields[`${input.form.id}/${input.name}`] = input.value;
    });
  }
  return fields;
}
