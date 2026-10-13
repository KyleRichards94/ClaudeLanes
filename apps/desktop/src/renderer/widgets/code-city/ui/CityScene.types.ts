import type { ChangedFile, ReviewStatus } from '@agent-lanes/contracts';
import type { CityLayout } from '../model/layoutCity';
import type { CityAgent } from '../model/types';

export interface CitySceneProps {
  layout: CityLayout;
  /** Every changed file: the scene looks up authors, review status and the files beyond the 40-building cap. */
  files: readonly ChangedFile[];
  agents: readonly CityAgent[];
  reviewStatus: Readonly<Record<string, ReviewStatus>>;
  selectedFilePath: string | null;
  onSelectFile(path: string | null): void;
  base: string;
  loading: boolean;
  error: { message: string } | null;
  onRetry(): void;
  testID?: string;
}
