import { z } from "zod";

/**
 * A trivia question bank (phase O8 › Policy Trivia): generated offline from an org's policy PDFs,
 * every answer checkable on the cited page. Client-safe; the bank itself is a lazy JSON chunk.
 */
export const triviaQuestionSchema = z
  .object({
    id: z.string().min(1).max(80),
    question: z.string().min(10).max(300),
    choices: z.array(z.string().min(1).max(120)).length(4),
    /** Index into `choices`. */
    answer: z.number().int().min(0).max(3),
    explanation: z.string().min(10).max(400),
    /** The document the answer is checked against (`documents.doc_code`). */
    doc_code: z.string().min(1).max(40),
    /** 1-based page of that document. */
    page: z.number().int().min(1),
    department: z.string().min(1).max(40),
    /** A country code, or `GLOBAL`. */
    jurisdiction: z.string().regex(/^([A-Z]{2}|GLOBAL)$/),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict()
  .refine((q) => new Set(q.choices.map((c) => c.trim().toLowerCase())).size === 4, { message: "choices must be unique", path: ["choices"] });

export const triviaBankSchema = z
  .array(triviaQuestionSchema)
  // A round is ten questions, so a bank needs at least that many.
  .min(10)
  .refine((bank) => new Set(bank.map((q) => q.id)).size === bank.length, { message: "question ids must be unique" });

export type TriviaQuestion = z.infer<typeof triviaQuestionSchema>;
export type TriviaBank = TriviaQuestion[];

/** Parses a bank file's contents; throws a readable error for a malformed one. */
export function parseBank(data: unknown): TriviaBank {
  return triviaBankSchema.parse(data);
}
