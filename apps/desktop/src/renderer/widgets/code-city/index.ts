// Code City (AL-280..AL-283): a presentational widget. The ticket page owns the store and IPC wiring and passes
// everything in as props; `LayoutSwitch` lazy-loads this module and reads `CodeCity` (or `default`).
export { CodeCity, CodeCity as default } from './ui/CodeCity';
export type { CityAgent, CityAgentKind, CityStage, CodeCityProps } from './model/types';
export { layoutCity, type CityBuilding, type CityDistrict, type CityLayout } from './model/layoutCity';
