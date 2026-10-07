import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { color, fontSize, fontWeight, radius } from '@agent-lanes/tokens';
import { Text } from './Text';
import { TextField, type SecureTextFieldHandle, type TextFieldHandle } from './TextField';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Types into a react-native-web TextInput the way the browser reports it. */
function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function pressEnter(input: HTMLElement) {
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** The bordered box around the input (and the search icon). */
function boxOf(input: HTMLElement): HTMLElement {
  const box = input.parentElement;
  if (!box) throw new Error('input has no box');
  return box;
}

/** The text of the elements an input's aria-describedby points at, in order. */
function describedBy(input: HTMLElement): string[] {
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`aria-describedby points at a missing id: ${id}`);
    return element.textContent ?? '';
  });
}

interface Fiber {
  child: Fiber | null;
  sibling: Fiber | null;
  memoizedProps: unknown;
  memoizedState: unknown;
  stateNode: { current?: Fiber } | null;
}

/**
 * Whether React's committed tree under `container` holds `needle` anywhere: any component's props
 * or hook state (useState, useRef, useMemo, effect deps). It reads React internals, so every test
 * that expects `false` first expects `true` while the secret is typed, proving the walk still sees
 * hook state on this React version.
 */
function heldByReact(container: HTMLElement, needle: string): boolean {
  const key = Object.keys(container).find((name) => name.startsWith('__reactContainer$'));
  if (!key) throw new Error('container is not a React root');
  const rootFiber = (container as unknown as Record<string, Fiber>)[key];
  const committed = rootFiber?.stateNode?.current;
  if (!committed) throw new Error('no committed React tree');

  const seen = new Set<unknown>();
  const isFiber = (value: object) => 'memoizedProps' in value && 'return' in value;
  const holds = (value: unknown, depth: number): boolean => {
    if (typeof value === 'string') return value.includes(needle);
    if (value === null || typeof value !== 'object' || depth > 40 || seen.has(value)) return false;
    seen.add(value);
    // DOM nodes are checked on their own; fibers are walked below, one at a time.
    if (value instanceof Node || isFiber(value)) return false;
    const children = value instanceof Map || value instanceof Set ? [...value.values()] : Object.values(value);
    return children.some((child) => holds(child, depth + 1));
  };

  const stack: Fiber[] = [committed];
  while (stack.length > 0) {
    const fiber = stack.pop() as Fiber;
    if (holds(fiber.memoizedProps, 0) || holds(fiber.memoizedState, 0)) return true;
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return false;
}

const SECRET = 'pat-7Fq2-do-not-echo-0b1c';

/** The PAT part of the "Add an organisation" form on artboard 5. */
function PatForm({ onSave, onTest }: { onSave: (pat: string) => void; onTest?: (pat: string) => void }) {
  const pat = useRef<SecureTextFieldHandle>(null);
  const save = () => onSave(pat.current?.take() ?? '');
  return (
    <View>
      <TextField
        variant="secure"
        label="Personal access token"
        ref={pat}
        onSubmitEditing={save}
        accessory={
          <Pressable role="button" onPress={() => onTest?.(pat.current?.read() ?? '')}>
            <Text>Test connection</Text>
          </Pressable>
        }
      />
      <Pressable role="button" onPress={save}>
        <Text>Save connections</Text>
      </Pressable>
    </View>
  );
}

describe('TextField', () => {
  it('is named by its visible label, set in the title type', () => {
    render(<TextField label="Organisation URL" defaultValue="https://dev.azure.com/Hicora" />);
    const input = screen.getByRole('textbox', { name: 'Organisation URL' });
    expect(input).toHaveProperty('value', 'https://dev.azure.com/Hicora');

    const label = screen.getByText('Organisation URL');
    expect(getComputedStyle(label).fontWeight).toBe(fontWeight.heading);
    expect(getComputedStyle(label).fontSize).toBe(`${fontSize.md}px`);
  });

  it('draws the 46 px control box from artboards 2 and 5: white, line border, radius 12', () => {
    render(<TextField label="Organisation URL" />);
    const input = screen.getByRole('textbox', { name: 'Organisation URL' });
    const box = getComputedStyle(boxOf(input));
    expect(box.backgroundColor).toBe(rgb(color.surface));
    expect(box.borderTopColor).toBe(rgb(color.line));
    expect(box.borderTopWidth).toBe('1px');
    expect(box.borderTopLeftRadius).toBe(`${radius.control}px`);
    expect(box.minHeight).toBe('46px');
    // The value is set in body type.
    expect(getComputedStyle(input).fontSize).toBe(`${fontSize.md}px`);
    expect(getComputedStyle(input).color).toBe(rgb(color.ink));
  });

  it('passes value and edits through for single-line fields', () => {
    const onChangeText = vi.fn();
    render(<TextField label="Organisation URL" value="" onChangeText={onChangeText} placeholder="https://dev.azure.com/…" />);
    const input = screen.getByRole('textbox', { name: 'Organisation URL' });
    expect(input.getAttribute('placeholder')).toBe('https://dev.azure.com/…');
    type(input, 'https://dev.azure.com/Hicora');
    expect(onChangeText).toHaveBeenCalledWith('https://dev.azure.com/Hicora');
  });

  it('calls onSubmitEditing on Enter and keeps focus in the field', () => {
    vi.useFakeTimers();
    try {
      const onSubmitEditing = vi.fn();
      render(<TextField label="Organisation URL" onSubmitEditing={onSubmitEditing} />);
      const input = screen.getByRole('textbox', { name: 'Organisation URL' });
      input.focus();
      pressEnter(input);
      vi.runAllTimers();
      expect(onSubmitEditing).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);
    } finally {
      vi.useRealTimers();
    }
  });

  it('focuses through its ref', () => {
    const ref = createRef<TextFieldHandle>();
    render(<TextField label="Organisation URL" ref={ref} />);
    ref.current?.focus();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Organisation URL' }));
    ref.current?.blur();
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Organisation URL' }));
  });

  it('shows the violet focus ring around the whole box while focused', () => {
    render(<TextField variant="search" aria-label="Search work items" />);
    const input = screen.getByRole('searchbox', { name: 'Search work items' });
    const box = boxOf(input);
    expect(getComputedStyle(box).outlineStyle).not.toBe('solid');

    fireEvent.focus(input);
    expect(getComputedStyle(box).outlineStyle).toBe('solid');
    expect(getComputedStyle(box).outlineColor).toBe(rgb(color.claude));
    expect(getComputedStyle(box).outlineWidth).toBe('2px');
    // The input's own outline would sit inside the box, between the icon and the text.
    expect(input.style.outlineWidth).toBe('0px');

    fireEvent.blur(input);
    expect(getComputedStyle(box).outlineStyle).not.toBe('solid');
  });

  describe('search variant', () => {
    it('has a leading search icon, the searchbox role and a name without a visible label', () => {
      render(<TextField variant="search" aria-label="Search work items" placeholder="Search by ID or title" />);
      const input = screen.getByRole('searchbox', { name: 'Search work items' });
      expect(input.getAttribute('placeholder')).toBe('Search by ID or title');
      expect(input.getAttribute('enterkeyhint')).toBe('search');

      const icon = boxOf(input).querySelector('svg');
      expect(icon).not.toBeNull();
      // The icon comes before the input and is decorative.
      expect(icon?.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('multiline variant', () => {
    it('is a textarea for the job description that keeps Enter for new lines', () => {
      const onSubmitEditing = vi.fn();
      const onChangeText = vi.fn();
      render(
        <TextField
          variant="multiline"
          label="What should the agent do?"
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
        />,
      );
      const input = screen.getByRole('textbox', { name: 'What should the agent do?' });
      expect(input.tagName).toBe('TEXTAREA');
      expect(input.getAttribute('rows')).toBe('5');

      type(input, 'Cut frmJobControl over to Blazor.\nStop for my approval before the PR.');
      expect(onChangeText).toHaveBeenLastCalledWith('Cut frmJobControl over to Blazor.\nStop for my approval before the PR.');
      pressEnter(input);
      expect(onSubmitEditing).not.toHaveBeenCalled();
    });

    it('sizes to its rows: 20 px lines inside a 14 px inset', () => {
      render(<TextField variant="multiline" label="What should the agent do?" rows={3} />);
      const input = screen.getByRole('textbox', { name: 'What should the agent do?' });
      expect(getComputedStyle(input).minHeight).toBe(`${3 * 20 + 2 * 14}px`);
    });
  });

  it('greys out and stops editing when disabled', () => {
    render(<TextField label="Default project" placeholder="Loaded after the token is tested" disabled />);
    const input = screen.getByRole('textbox', { name: 'Default project' });
    expect(input).toHaveProperty('readOnly', true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(getComputedStyle(boxOf(input)).backgroundColor).toBe(rgb(color.bg));
  });

  it('puts an accessory beside the box (Test connection)', () => {
    render(
      <TextField
        label="Personal access token"
        accessory={
          <Pressable role="button">
            <Text>Test connection</Text>
          </Pressable>
        }
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Personal access token' });
    const button = screen.getByRole('button', { name: 'Test connection' });
    // Same row as the box, not under the label or the help text.
    expect(button.parentElement).toBe(boxOf(input).parentElement);
  });

  it('marks required fields', () => {
    render(<TextField label="Organisation URL" required />);
    expect(screen.getByRole('textbox', { name: 'Organisation URL' }).getAttribute('aria-required')).toBe('true');
  });
});

describe('TextField help and error text', () => {
  it('links the error text with aria-describedby and marks the field invalid', () => {
    render(<TextField label="Organisation URL" error="Enter an https://dev.azure.com/ URL." />);
    const input = screen.getByRole('textbox', {
      name: 'Organisation URL',
      description: 'Enter an https://dev.azure.com/ URL.',
    });
    expect(describedBy(input)).toEqual(['Enter an https://dev.azure.com/ URL.']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the error with an alert icon and a red outline, not colour alone', () => {
    render(<TextField label="Organisation URL" error="Enter an https://dev.azure.com/ URL." />);
    const input = screen.getByRole('textbox', { name: 'Organisation URL' });
    const message = screen.getByText('Enter an https://dev.azure.com/ URL.');
    expect(getComputedStyle(message).color).toBe(rgb(color.danger));
    expect(message.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(getComputedStyle(boxOf(input)).borderTopColor).toBe(rgb(color.danger));
  });

  it('links help text the same way, after the error', () => {
    const help = 'Needs Work Items (read & write), Code (read & write) and Build (read).';
    render(<TextField label="Personal access token" help={help} error="This token has expired." />);
    const input = screen.getByRole('textbox', { name: 'Personal access token' });
    expect(describedBy(input)).toEqual(['This token has expired.', help]);
    expect(getComputedStyle(screen.getByText(help)).color).toBe(rgb(color.muted));
    expect(getComputedStyle(screen.getByText(help)).fontSize).toBe(`${fontSize.sm}px`);
  });

  it('is valid with help text alone, and has no aria-describedby with neither', () => {
    const { rerender } = render(<TextField label="Organisation URL" help="Your organisation's address." />);
    const input = screen.getByRole('textbox', { name: 'Organisation URL', description: "Your organisation's address." });
    expect(input.hasAttribute('aria-invalid')).toBe(false);

    rerender(<TextField label="Organisation URL" />);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('updates the link as an error appears and clears', () => {
    const { rerender } = render(<TextField label="Organisation URL" error={null} />);
    const input = screen.getByRole('textbox', { name: 'Organisation URL' });
    expect(input.hasAttribute('aria-describedby')).toBe(false);

    rerender(<TextField label="Organisation URL" error="Organisation not found." />);
    expect(describedBy(input)).toEqual(['Organisation not found.']);

    rerender(<TextField label="Organisation URL" error="" />);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByText('Organisation not found.')).toBeNull();
  });

  it('keeps each field linked to its own text', () => {
    render(
      <View>
        <TextField label="Organisation URL" error="Organisation not found." />
        <TextField variant="secure" label="Personal access token" error="This token has expired." />
      </View>,
    );
    expect(describedBy(screen.getByRole('textbox', { name: 'Organisation URL' }))).toEqual(['Organisation not found.']);
    expect(describedBy(screen.getByLabelText('Personal access token'))).toEqual(['This token has expired.']);
  });
});

describe('TextField secure variant', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function patInput(): HTMLInputElement {
    return screen.getByLabelText('Personal access token') as HTMLInputElement;
  }

  it('is masked, with no autocomplete, autocorrect, capitalisation or spellcheck', () => {
    render(<PatForm onSave={() => {}} />);
    const input = patInput();
    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
  });

  it('never writes the secret into the markup', () => {
    const { container } = render(<PatForm onSave={() => {}} />);
    type(patInput(), SECRET);
    expect(patInput().value).toBe(SECRET);
    // A controlled input would mirror the value into the `value` attribute.
    expect(patInput().hasAttribute('value')).toBe(false);
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it('clears the secret from component state after submit', () => {
    const onSave = vi.fn();
    const { container } = render(<PatForm onSave={onSave} />);
    type(patInput(), SECRET);
    expect(heldByReact(container, SECRET)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Save connections' }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(SECRET);
    expect(patInput().value).toBe('');
    expect(heldByReact(container, SECRET)).toBe(false);
  });

  it('clears the secret after submitting with Enter too', () => {
    const onSave = vi.fn();
    const { container } = render(<PatForm onSave={onSave} />);
    type(patInput(), SECRET);
    expect(heldByReact(container, SECRET)).toBe(true);

    pressEnter(patInput());

    expect(onSave).toHaveBeenCalledExactlyOnceWith(SECRET);
    expect(patInput().value).toBe('');
    expect(heldByReact(container, SECRET)).toBe(false);
  });

  it('keeps the secret through Test connection for the Save that follows', () => {
    const onTest = vi.fn();
    const onSave = vi.fn();
    const { container } = render(<PatForm onSave={onSave} onTest={onTest} />);
    type(patInput(), SECRET);

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(onTest).toHaveBeenCalledExactlyOnceWith(SECRET);
    expect(patInput().value).toBe(SECRET);

    fireEvent.click(screen.getByRole('button', { name: 'Save connections' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith(SECRET);
    expect(heldByReact(container, SECRET)).toBe(false);
  });

  it('a second submit hands over nothing', () => {
    const onSave = vi.fn();
    render(<PatForm onSave={onSave} />);
    type(patInput(), SECRET);
    fireEvent.click(screen.getByRole('button', { name: 'Save connections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save connections' }));
    expect(onSave.mock.calls).toEqual([[SECRET], ['']]);
  });

  it('clear() empties the field without reading it (Cancel)', () => {
    const ref = createRef<SecureTextFieldHandle>();
    const { container } = render(<TextField variant="secure" label="API key" ref={ref} />);
    const input = screen.getByLabelText('API key') as HTMLInputElement;
    type(input, SECRET);
    expect(ref.current?.read()).toBe(SECRET);

    ref.current?.clear();

    expect(input.value).toBe('');
    expect(ref.current?.read()).toBe('');
    expect(heldByReact(container, SECRET)).toBe(false);
  });

  it('tells the form only whether the field is filled, never the secret', () => {
    const onSecretChange = vi.fn();
    const ref = createRef<SecureTextFieldHandle>();
    render(<TextField variant="secure" label="API key" ref={ref} onSecretChange={onSecretChange} />);
    const input = screen.getByLabelText('API key');

    type(input, 's');
    type(input, SECRET);
    type(input, '');
    type(input, SECRET);
    ref.current?.take();

    expect(onSecretChange.mock.calls).toEqual([[true], [true], [false], [true], [false]]);
  });

  it('never logs the secret', () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    render(<PatForm onSave={() => {}} onTest={() => {}} />);
    type(patInput(), SECRET);
    pressEnter(patInput());
    type(patInput(), SECRET);
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save connections' }));

    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).map((arg) => String(arg));
    expect(logged.filter((line) => line.includes(SECRET))).toEqual([]);
  });

  it('takes no value or onChangeText, so a parent cannot hold the secret', () => {
    // Compile-time only: the build fails if these become allowed.
    const typeChecks = () => (
      <View>
        {/* @ts-expect-error a secure field has no value prop */}
        <TextField variant="secure" label="API key" value="sk-ant-…" />
        {/* @ts-expect-error a secure field reports no text */}
        <TextField variant="secure" label="API key" onChangeText={() => {}} />
        {/* @ts-expect-error a field needs a label or an aria-label */}
        <TextField variant="search" />
      </View>
    );
    expect(typeChecks).toBeTypeOf('function');
  });
});
