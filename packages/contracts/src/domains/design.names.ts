/** Claude Design view, design thread and shipped design specs (AL-190–AL-200). Zod-free: imported by the sandboxed preload. */
export const DESIGN_INVOKE_CHANNELS = [
  'design:open', // AL-191
  'design:setBounds', // AL-191
  'design:hide', // AL-191
  'design:close', // AL-191
  'design:getView', // AL-191
  'design:reload', // AL-192
  'design:linkCanvas', // AL-193
  'design:unlinkCanvas', // AL-193
  'design:openCanvas', // AL-193
] as const;
export const DESIGN_EVENT_CHANNELS = [
  'design:spec',
  'design:view', // AL-191
] as const;
