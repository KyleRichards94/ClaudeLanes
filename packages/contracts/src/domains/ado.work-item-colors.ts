import { z } from 'zod';

/**
 * Azure DevOps' own colours for work item types and states, as its boards show them: each type's
 * colour (Bug red, User Story blue) and each state's (Active blue, Closed green). Read live from the
 * project's process (`ado:workItemColors`); the cards draw them as a bar and a dot beside words, never
 * as a text background, so contrast never depends on the process's choice.
 */

/** `#RRGGBB`. */
export const HexColorSchema = z.string().regex(/^#[0-9A-F]{6}$/, 'A #RRGGBB colour');

/** `ado:workItemColors`: type name → colour, and type name → state name → colour. Names as ADO spells them. */
export const WorkItemColorsSchema = z.object({
  types: z.record(z.string().min(1), HexColorSchema),
  states: z.record(z.string().min(1), z.record(z.string().min(1), HexColorSchema)),
});
export type WorkItemColors = z.infer<typeof WorkItemColorsSchema>;

function lookup<T>(record: Readonly<Record<string, T>> | undefined, name: string): T | null {
  if (!record) return null;
  if (Object.hasOwn(record, name)) return record[name]!;
  const lower = name.toLowerCase();
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === lower);
  return key === undefined ? null : record[key]!;
}

/** The type's colour, matched without regard to case; null when the colours aren't known or don't name it. */
export function workItemTypeColor(colors: WorkItemColors | null | undefined, type: string | null | undefined): string | null {
  return colors && type ? lookup(colors.types, type) : null;
}

/** The state's colour for that type, matched without regard to case; null when unknown. */
export function workItemStateColor(colors: WorkItemColors | null | undefined, type: string | null | undefined, state: string | null | undefined): string | null {
  return colors && type && state ? lookup(lookup(colors.states, type) ?? undefined, state) : null;
}
