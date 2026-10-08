import { ok, type Result, type WorkItemColors } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoCallOptions, AdoClient } from './client';
import { adoPath } from './path';
import { guarded, isName, missing } from './team-board';

/**
 * The project's work item type and state colours, as Azure DevOps' own boards show them (Bug red,
 * Active blue). `GET {project}/_apis/wit/workitemtypes` gives each type's `color` and, on most
 * servers, its `states` with theirs; a type sent without states has them read from
 * `GET {project}/_apis/wit/workitemtypes/{type}/states`. Through the client, so Azure DevOps Server
 * gets the api-version it speaks. Never throws.
 */

export type WorkItemColorsOptions = Pick<AdoCallOptions, 'signal' | 'timeoutMs'> & { project: string };

const stateSchema = z.object({ name: z.string().min(1), color: z.string().nullish() });
const typesSchema = z.object({
  value: z.array(
    z.object({
      name: z.string().min(1),
      color: z.string().nullish(),
      isDisabled: z.boolean().nullish(),
      states: z.array(stateSchema).nullish(),
    }),
  ),
});
const statesSchema = z.object({ value: z.array(stateSchema) });

/**
 * ADO sends colours as hex without `#`: `CC293D`, or with an alpha byte first (`FFCC293D`). Returns
 * `#RRGGBB` upper-cased, or null for anything else.
 */
export function adoColor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const hex = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`;
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2).toUpperCase()}`;
  return null;
}

function stateColors(states: ReadonlyArray<z.infer<typeof stateSchema>>): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const state of states) {
    const value = adoColor(state.color);
    if (value) colors[state.name] = value;
  }
  return colors;
}

/** Every enabled type's colour and its states' colours. A type whose states can't be read keeps its own colour. */
export function getWorkItemColors(client: AdoClient, options: WorkItemColorsOptions): Promise<Result<WorkItemColors>> {
  return guarded('read the work item colours', async () => {
    const { project } = options;
    if (!isName(project)) return missing('project', 'read its work item colours');
    const call = { ...(options.signal ? { signal: options.signal } : {}), ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) };

    const types = await client.get(adoPath`/${project.trim()}/_apis/wit/workitemtypes`, typesSchema, call);
    if (!types.ok) return types;

    const colors: WorkItemColors = { types: {}, states: {} };
    const enabled = types.data.value.filter((type) => type.isDisabled !== true);
    await Promise.all(
      enabled.map(async (type) => {
        const typeColor = adoColor(type.color);
        if (typeColor) colors.types[type.name] = typeColor;
        let states = type.states ?? null;
        if (states === null) {
          const read = await client.get(adoPath`/${project.trim()}/_apis/wit/workitemtypes/${type.name}/states`, statesSchema, call);
          states = read.ok ? read.data.value : [];
        }
        const byState = stateColors(states);
        if (Object.keys(byState).length > 0) colors.states[type.name] = byState;
      }),
    );
    return ok(colors);
  });
}
