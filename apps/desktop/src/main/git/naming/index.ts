export {
  BranchNamingError,
  MAX_BRANCH_NAME_LENGTH,
  NO_TICKET_PREFIX,
  SUB_BRANCH_PREFIX,
  findConflictingBranch,
  nameNoTicket,
  nameSubAgent,
  nameWorkItemTicket,
  type BranchAndWorktree,
} from './branch-names';
export {
  checkBranchName,
  validateBranchName,
  type BranchNameCheck,
  type BranchNameProblem,
  type CheckRefFormat,
  type ValidateBranchNameOptions,
} from './check-branch-name';
export { createGitCheckRefFormat, type GitCheckRefFormatOptions } from './git-check-ref-format';
export { slugWords } from './slug';
