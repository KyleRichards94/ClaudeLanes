import {
  AgentDefaultsSchema,
  RepoSettingsSchema,
  SettingsSchema,
  defaultDropDefaults,
  defaultSettings,
  type RepoCommands,
  type RepoSettings,
  type Settings,
} from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, getToasts } from '@/shared/model';
import { installFakeSettings, type FakeSettings } from '@/shared/testing';
import { SettingsPanel, type SettingsPanelProps } from './SettingsPanel';

vi.setConfig({ testTimeout: 15_000 });

const osc: RepoSettings = {
  path: 'C:\\src\\onsite-companion',
  name: 'onsite-companion',
  baseBranch: 'main',
  worktreeRoot: 'C:\\src\\.agent-lanes',
  buildCommand: null,
  runCommand: null,
  maxConcurrentAgents: 3,
};
const lanes: RepoSettings = { ...osc, path: 'C:\\src\\agent-lanes', name: 'agent-lanes', buildCommand: 'pnpm build' };

const commands: RepoCommands = {
  repoPath: osc.path,
  detected: {
    toolchain: 'dotnet',
    manifest: 'OnSite.sln',
    packageManager: null,
    build: 'dotnet build OnSite.sln -c Debug',
    run: 'dotnet run --project OnSite/OnSite.csproj',
    runTarget: 'OnSite/OnSite.csproj',
    runKind: 'desktop',
  },
  build: { command: 'dotnet build OnSite.sln -c Debug', origin: 'detected' },
  run: { command: 'dotnet run --project OnSite/OnSite.csproj', origin: 'detected' },
};

function initial(): Settings {
  return { ...defaultSettings(), repos: [osc, lanes] };
}

let fake: FakeSettings;

function renderPanel(props: Partial<SettingsPanelProps> = {}) {
  fake = installFakeSettings(initial(), { 'build:commands': { ok: true, data: commands } });
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPanel visible onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const save = () => screen.getByRole('button', { name: 'Save settings' });
const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement;
const type = (testId: string, value: string) => fireEvent.change(input(testId), { target: { value } });

afterEach(() => clearToasts());

describe('SettingsPanel', () => {
  it('edits the agent defaults, the build queue and ADO state changes, and saves only what changed', async () => {
    const { onClose } = renderPanel();
    await screen.findByRole('radio', { name: 'Opus' });
    expect(save().getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Sonnet' }));
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    fireEvent.click(screen.getByRole('switch', { name: 'QA Auto' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Create PR Needs approval' }));
    type('settings-skills', '/code-review /cs-qa-wip');
    type('settings-build-queue-size', '3');
    fireEvent.click(screen.getByRole('switch', { name: /^Move work items/ }));

    expect(save().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.updates).toEqual([
      {
        defaults: {
          model: 'sonnet',
          effort: 'high',
          stageGates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'approval', 'create-pr': 'auto' },
          skills: ['code-review', 'cs-qa-wip'],
        },
        buildQueueSize: 3,
        adoStateTransitions: true,
      },
    ]);
    expect(getToasts().map((entry) => entry.title)).toEqual(['Settings saved']);
  });

  it('blocks Save while a field is invalid and says why', async () => {
    renderPanel();
    await screen.findByTestId('settings-build-queue-size');
    type('settings-build-queue-size', '12');

    expect(screen.getByText('Enter a whole number from 1 to 8.')).toBeTruthy();
    expect(input('settings-build-queue-size').getAttribute('aria-invalid')).toBe('true');
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Fix the highlighted fields to save.')).toBeTruthy();
    fireEvent.click(save());
    expect(fake.updates).toEqual([]);
  });

  it('edits a repo: base branch, worktree folder, commands over the detected ones, agents and ADO write-back', async () => {
    renderPanel({ repoPath: osc.path });
    expect(await screen.findByText('Leave empty to use the detected command: dotnet build OnSite.sln -c Debug')).toBeTruthy();
    expect(input('settings-repo-build-command').placeholder).toBe('dotnet build OnSite.sln -c Debug');
    expect(screen.getByText(osc.path)).toBeTruthy();

    type('settings-repo-base-branch', 'develop');
    type('settings-repo-worktree-root', 'worktrees');
    expect(screen.getByText('Enter a full folder path, such as C:\\src\\.agent-lanes.')).toBeTruthy();
    expect(save().getAttribute('aria-disabled')).toBe('true');
    type('settings-repo-worktree-root', 'D:\\worktrees');
    type('settings-repo-run-command', 'dotnet run --project OnSite.Web');
    type('settings-repo-max-agents', '2');
    fireEvent.click(screen.getByRole('switch', { name: 'Post a comment to the work item on each stage change Off' }));

    fireEvent.click(save());
    await waitFor(() => expect(fake.updates).toHaveLength(1));
    expect(fake.settings.repos).toEqual([
      { ...osc, baseBranch: 'develop', worktreeRoot: 'D:\\worktrees', runCommand: 'dotnet run --project OnSite.Web', maxConcurrentAgents: 2, adoWriteBack: true },
      lanes,
    ]);
  });

  it('switches between repos and keeps each repo’s edits until Save', async () => {
    renderPanel({ section: 'repos' });
    await screen.findByTestId('settings-repo-name');
    expect(input('settings-repo-name').value).toBe('onsite-companion');
    type('settings-repo-name', 'OSC');

    fireEvent.click(screen.getByRole('radio', { name: /^agent-lanes/ }));
    expect(input('settings-repo-name').value).toBe('agent-lanes');
    expect(input('settings-repo-build-command').value).toBe('pnpm build');

    fireEvent.click(screen.getByRole('radio', { name: /^OSC|^onsite-companion/ }));
    expect(input('settings-repo-name').value).toBe('OSC');

    fireEvent.click(screen.getByRole('tab', { name: 'Agent defaults' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Repos' }));
    expect(input('settings-repo-name').value).toBe('OSC');
  });

  it('forgets nothing on Cancel', async () => {
    const { onClose } = renderPanel();
    await screen.findByTestId('settings-build-queue-size');
    type('settings-build-queue-size', '4');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    await act(async () => undefined);
    expect(fake.updates).toEqual([]);
  });

  it('runs agents in Auto permission mode by default, and saves Accept edits or Ask', async () => {
    renderPanel();
    const auto = await screen.findByRole('radio', { name: 'Auto' });
    expect(auto.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('settings-permission-mode-help').textContent).toContain("Claude Code's auto mode");

    fireEvent.click(screen.getByRole('radio', { name: 'Ask' }));
    expect(screen.getByTestId('settings-permission-mode-help').textContent).toContain('Every edit asks');
    fireEvent.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(fake.updates).toHaveLength(1));
    expect(fake.updates[0]).toEqual({ agentPermissions: { mode: 'ask', edits: 'ask', gitRead: true, buildAndTest: true, bashAllow: [] } });
  });

  it('has a control for every setting the app uses (tokens are in Connections)', async () => {
    // Each stored setting and the label of its control. A new setting fails here until the panel edits it.
    const controls: Record<string, string | null> = {
      version: null,
      ui: null, // UI prefs (last repo and sprint, collapsed lanes, embed mode) change where they are used.
      'defaults.model': 'Default model',
      'defaults.effort': 'Default effort',
      'defaults.stageGates': 'Default stage gates',
      'defaults.skills': 'Default skills',
      buildQueueSize: 'Builds at once',
      adoStateTransitions: 'Move work items to the next state in Azure DevOps',
      agentPermissions: 'Agent permissions', // AL-109
      dropDefaults: null, // The Drops tab (AL-240) has its own tests below.
      repos: 'Repo',
      'repo.path': null, // Picked with the native folder dialog: Add repo….
      'repo.name': 'Name',
      'repo.baseBranch': 'Base branch',
      'repo.worktreeRoot': 'Worktree folder',
      'repo.buildCommand': 'Build command',
      'repo.runCommand': 'Run command',
      'repo.maxConcurrentAgents': 'Agents at once',
      'repo.adoWriteBack': 'Post a comment to the work item on each stage change',
    };
    const stored = [
      ...Object.keys(SettingsSchema.shape).filter((key) => key !== 'defaults'),
      ...Object.keys(AgentDefaultsSchema.shape).map((key) => `defaults.${key}`),
      ...Object.keys(RepoSettingsSchema.shape).map((key) => `repo.${key}`),
    ];
    expect(Object.keys(controls).sort()).toEqual(stored.sort());

    renderPanel();
    await screen.findByRole('radio', { name: 'Opus' });
    const shown = () => document.body.textContent ?? '';
    for (const [key, label] of Object.entries(controls)) {
      if (!label || key.startsWith('repo') || key === 'repos') continue;
      expect(shown(), key).toContain(label);
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Repos' }));
    await screen.findByTestId('settings-repo');
    for (const [key, label] of Object.entries(controls)) {
      if (!label || !(key.startsWith('repo') || key === 'repos')) continue;
      expect(shown(), key).toContain(label);
    }
    expect(screen.getByRole('button', { name: 'Add repo…' })).toBeTruthy();
  });
});

describe('Settings › Drops (AL-240)', () => {
  it("edits each kind of drop's skills, model and effort, seeded from TB§3, and saves them whole", async () => {
    const { onClose } = renderPanel({ section: 'drops' });
    await screen.findByTestId('settings-drops');
    expect(input('settings-drop-code-review-skills').value).toBe('/code-review /pr-comment-actioner');
    expect(input('settings-drop-planning-skills').value).toBe('');
    const qa = within(screen.getByTestId('settings-drop-qa'));
    expect(qa.getByRole('radio', { name: 'Sonnet' }).getAttribute('aria-checked')).toBe('true');
    expect(qa.getByRole('radio', { name: 'Med' }).getAttribute('aria-checked')).toBe('true');

    type('settings-drop-qa-skills', '/cs-qa-wip, cs-smoke');
    fireEvent.click(qa.getByRole('radio', { name: 'Haiku' }));
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.updates).toEqual([{ dropDefaults: { ...defaultDropDefaults(), qa: { skills: ['cs-qa-wip', 'cs-smoke'], model: 'haiku', effort: 'medium' } } }]);
  });

  it('blocks Save on a skill name that is not one', async () => {
    renderPanel({ section: 'drops' });
    await screen.findByTestId('settings-drops');
    type('settings-drop-planning-skills', '/plan it!');
    expect(screen.getByText('"it!" is not a skill name. Use names like /code-review.')).toBeTruthy();
    expect(save().getAttribute('aria-disabled')).toBe('true');
  });
});
