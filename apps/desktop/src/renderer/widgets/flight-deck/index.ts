// Flight deck (AL-279): the ticket page's default layout. Presentational: the ticket page owns the store and IPC
// wiring and hands the pieces in as props and slots (it also passes what widgets cannot import: page panels).
export { FlightDeck, DIFF_FRACTION, OUTPUT_FRACTION, RAIL_WIDTH, type FlightDeckProps } from './ui/FlightDeck';
export { WorkflowCard, type WorkflowCardProps } from './ui/WorkflowCard';
export { TurnStrip, type TurnStripProps } from './ui/TurnStrip';
export { GroupedOutput, type GroupedOutputProps } from './ui/GroupedOutput';
export { ChangeMap, type ChangeMapProps } from './ui/ChangeMap';
export { DiffColumn, type DiffColumnProps } from './ui/DiffColumn';
export { AgentDonut, activityLine, type AgentDonutProps, type AgentStatusPill } from './ui/AgentDonut';
export { reviewProgress, stageTurns, workflowStages, type ReviewProgress, type StageStepInput, type WorkflowInput, type WorkflowStage } from './model/stage-meta';
