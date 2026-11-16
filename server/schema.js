import { z } from "zod";

export const categories = [
  "Private Clinic / Residence",
  "Standalone",
  "Mall",
  "Wellness / Aesthetic Centre",
];
const text = z.string().trim().max(500);
const name = z.string().trim().min(1).max(160);
const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z.string().datetime({ offset: true });
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const image = z
  .string()
  .max(3_000_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
export const schemas = {
  hcps: z.object({
    name,
    email: z.union([z.string().email().max(200), z.literal("")]),
    phone: z.string().max(50),
    address: text,
    dispensing: z.enum(["Dispensing", "Non-dispensing"]),
    classification: name,
    institution: z.enum(categories),
    masterlist: z.boolean(),
    externalId: z.string().trim().max(120),
    medretailersId: z.string().trim().max(120),
    notes: text,
  }),
  skus: z.object({ code: name, name, active: z.boolean() }),
  plans: z.object({
    hcpId: id,
    date,
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    duration: z.number().int().min(5).max(480),
    status: z.enum(["Planned", "Cancelled"]),
    notes: text,
  }),
  engagements: z
    .object({
      hcpId: id,
      planId: z.union([id, z.literal("")]),
      actualAt: timestamp,
      endedAt: timestamp,
      durationSeconds: z.number().int().min(1).max(86400),
      patients: z.number().int().min(0).max(100000),
      notes: text,
      photos: z.array(image).min(1).max(3),
      signature: image,
      samples: z
        .array(
          z.object({
            skuId: id,
            quantity: z.number().int().min(1).max(100000),
          }),
        )
        .max(100),
      orderNumbers: z.array(z.string().trim().min(1).max(100)).max(50),
    })
    .superRefine((v, c) => {
      const seconds = Math.round(
        (Date.parse(v.endedAt) - Date.parse(v.actualAt)) / 1000,
      );
      if (seconds < 1 || Math.abs(seconds - v.durationSeconds) > 1)
        c.addIssue({
          code: "custom",
          message: "Duration must match start and end times.",
        });
      if (new Set(v.samples.map((s) => s.skuId)).size !== v.samples.length)
        c.addIssue({ code: "custom", message: "Use one row per sample SKU." });
      if (
        new Set(v.orderNumbers.map((s) => s.toLowerCase())).size !==
        v.orderNumbers.length
      )
        c.addIssue({ code: "custom", message: "Duplicate order numbers." });
    }),
};
export const mutationSchema = z.object({
  mutationId: z.string().uuid(),
  entity: z.enum(["hcps", "skus", "plans", "engagements"]),
  id,
  baseVersion: z.number().int().min(0),
  data: z.unknown(),
});
