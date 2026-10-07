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
  'design:listArtboards', // AL-195
  'design:getThread', // AL-196
  'design:sendThreadMessage', // AL-196
  'design:answerThreadApproval', // AL-196
] as const;
export const DESIGN_EVENT_CHANNELS = [
  'design:spec',
  'design:view', // AL-191
  'design:thread', // AL-196
] as const;
