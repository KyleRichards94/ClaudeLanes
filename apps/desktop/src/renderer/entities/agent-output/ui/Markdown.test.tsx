import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextProps } from '@agent-lanes/ui';
import type * as HighlightModule from '../model/highlight';
import type { Token } from '../model/highlight';
import { Markdown } from './Markdown';

const seen = vi.hoisted(() => ({ results: [] as Token[][][], lineRenders: 0 }));

vi.mock('../model/highlight', async (importOriginal) => {
  const actual = await importOriginal<typeof HighlightModule>();
  return {
    ...actual,
    createHighlighter: () => {
      const live = actual.createHighlighter();
      return (code: string, language: Parameters<typeof live>[1]) => {
        const result = live(code, language);
        seen.results.push(result);
        return result;
      };
    },
  };
});

vi.mock('@agent-lanes/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { Text: React.ComponentType<TextProps> }>();
  return {
    ...actual,
    Text: (props: TextProps) => {
      if (props.variant === 'mono' && props.size === 'sm' && props.selectable) seen.lineRenders += 1;
      return <actual.Text {...props} />;
    },
  };
});

const code = (lines: string[]) => `Here:\n\`\`\`vb\n${lines.join('\n')}`;
const lineNodes = () => Array.from(screen.getByTestId('md-code').children[1]!.children);

beforeEach(() => {
  seen.results = [];
  seen.lineRenders = 0;
});

describe('Markdown code block while it streams', () => {
  const body = ['Public Sub Run()', '  Dim x As Integer = 1', '  x += 1', 'End Sub'];

  it('re-tokenises and re-renders only the tail when the block grows by a line', () => {
    const { rerender } = render(<Markdown text={code(body.slice(0, 3))} streaming />);
    expect(seen.lineRenders).toBe(3);
    const before = seen.results.at(-1)!;

    seen.lineRenders = 0;
    rerender(<Markdown text={code(body)} streaming />);
    const after = seen.results.at(-1)!;
    const retokenised = after.filter((tokens, index) => tokens !== before[index]);
    expect(retokenised).toHaveLength(1);
    expect(after.slice(0, 3)).toEqual(before);
    // The old last line loses its caret and the new line is drawn; lines 1 and 2 are skipped.
    expect(seen.lineRenders).toBe(2);
  });

  it('re-renders only the last line when the tail grows by a character', () => {
    const { rerender } = render(<Markdown text={code(body)} streaming />);
    const before = seen.results.at(-1)!;

    seen.lineRenders = 0;
    rerender(<Markdown text={code([...body.slice(0, 3), 'End Sub '])} streaming />);
    const after = seen.results.at(-1)!;
    expect(after.filter((tokens, index) => tokens !== before[index])).toHaveLength(1);
    expect(seen.lineRenders).toBe(1);
  });

  it('draws a growing block as it would a finished one', () => {
    const { rerender } = render(<Markdown text={code(body.slice(0, 2))} streaming />);
    const first = lineNodes();
    rerender(<Markdown text={code(body)} streaming />);
    expect(lineNodes().slice(0, 2)).toEqual(first);
    const live = screen.getByTestId('md-code').textContent;
    rerender(<Markdown text={code(body)} />);
    expect(screen.getByTestId('md-code').textContent).toBe(live!.replace('▍', ''));
  });
});
