import { z } from "zod";
import { DEPARTMENTS, DOC_TYPES } from "./api-types";

/** Same pattern as api/app/ingestion/header.py DOC_CODE_RE. */
export const DOC_CODE_PATTERN = /^[A-Z]{2,5}-[A-Z]{2,5}-\d{2,4}$/;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is limited to ${max} characters.`)
    .transform((v) => v || null)
    .nullable();

/** Mirrors api/app/schemas/documents.py DocumentPatch; FastAPI re-validates. */
export const metadataSchema = z.object({
  title: z.string().trim().min(1, "A title is required.").max(300, "Titles are limited to 300 characters."),
  doc_code: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || DOC_CODE_PATTERN.test(v), "Codes look like SIM-HR-101.")
    .transform((v) => v || null)
    .nullable(),
  legal_entity: optionalText(300, "Legal entity"),
  department: z.enum(DEPARTMENTS).nullable(),
  jurisdiction: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2}|GLOBAL)$/, "Use a 2-letter country code or GLOBAL.")
    .nullable(),
  doc_type: z.enum(DOC_TYPES).nullable(),
  version: optionalText(40, "Version"),
  effective_date: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a date like 2026-01-31.")
    .transform((v) => v || null)
    .nullable(),
  owner: optionalText(300, "Owner"),
  approved_by: optionalText(300, "Approved by"),
  review_cycle: optionalText(500, "Review cycle"),
  applies_to: optionalText(2000, "Applies to"),
  related_doc_codes: z
    .array(z.string().trim().toUpperCase().regex(DOC_CODE_PATTERN, "Codes look like SIM-HR-101."))
    .max(50, "Up to 50 related documents."),
});

export type MetadataInput = z.input<typeof metadataSchema>;
export type MetadataField = keyof MetadataInput;
