import { useRef, useState, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextInput, type TextInputInstance } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { color, focusRing, glass, overlay, radius } from '@agent-lanes/tokens';
import { Button } from './Button';
import { Modal, type ModalProps } from './Modal';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

type HarnessProps = Omit<ModalProps, 'visible' | 'onClose' | 'blocking' | 'title'> & {
  title?: string;
  blocking?: boolean;
  onClose?: () => void;
  initiallyOpen?: boolean;
};

/**
 * A screen with an opener and a button behind the modal, holding `visible` the way a page would:
 * the modal's onClose hides it.
 */
function Harness({ title = 'Connections', blocking = false, onClose, initiallyOpen = false, children, ...props }: HarnessProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <Button label="Open connections" onPress={() => setOpen(true)} />
      <Button label="Behind the modal" />
      {blocking ? (
        <Modal {...props} title={title} visible={open} blocking onClose={close}>
          {children}
        </Modal>
      ) : (
        <Modal {...props} title={title} visible={open} onClose={close}>
          {children}
        </Modal>
      )}
    </>
  );
}

const footer = (
  <>
    <Button label="Cancel" />
    <Button variant="primary" label="Save connections" />
  </>
);

function body(): ReactNode {
  return <Button label="Test connection" />;
}

async function openWithKeyboard(ui: ReactNode) {
  const user = userEvent.setup();
  render(ui);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open connections' }));
  await user.keyboard('{Enter}');
  return user;
}

const dialog = () => screen.getByRole('dialog');

describe('Modal', () => {
  describe('layout (artboards 2 and 5)', () => {
    it('renders nothing while hidden', () => {
      render(<Modal visible={false} title="Connections" onClose={() => {}} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByText('Connections')).toBeNull();
    });

    it('is a modal dialog named by its title and described by its subtitle', () => {
      render(
        <Modal
          visible
          title="Connections"
          subtitle="Tokens are encrypted on this computer and never shown again after you save them."
          icon="link"
          iconTone="ado"
          onClose={() => {}}
        />,
      );
      const element = dialog();
      expect(element.getAttribute('aria-modal')).toBe('true');
      expect(screen.getByRole('dialog', { name: 'Connections' })).toBe(element);
      const describedBy = element.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(describedBy)?.textContent).toBe(
        'Tokens are encrypted on this computer and never shown again after you save them.',
      );
      expect(screen.getByRole('heading', { name: 'Connections', level: 2 })).toBeTruthy();
    });

    it('renders into a portal on the body, outside the app root', () => {
      const { container } = render(<Modal visible title="Connections" onClose={() => {}} />);
      expect(container.contains(dialog())).toBe(false);
      expect(document.body.contains(dialog())).toBe(true);
    });

    it('draws the panel as glass xl with the modal radius and a drop shadow', () => {
      render(<Modal visible title="Connections" onClose={() => {}} testID="connections" />);
      const panel = screen.getByTestId('connections-panel');
      const style = getComputedStyle(panel);
      expect(style.borderTopLeftRadius).toBe(`${radius.modal}px`);
      expect(style.backgroundColor).toBe(glass.fillMax.replace(/\s+/g, ' '));
      expect(panel.getAttribute('style') ?? '').toContain(`blur(${glass.blurXl}px)`);
      expect(style.boxShadow).toContain(glass.highlight);
      expect(style.boxShadow).toContain(overlay.shadow);
    });

    it('blurs and washes the app behind it with a backdrop', () => {
      render(<Modal visible title="Connections" onClose={() => {}} testID="connections" />);
      const backdrop = screen.getByTestId('connections-backdrop');
      expect(backdrop.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(backdrop).backgroundColor).toBe(overlay.scrim);
      expect(backdrop.getAttribute('style') ?? '').toContain(`blur(${overlay.scrimBlur}px)`);
      // A sibling of the panel, so the panel's own glass still blurs what lies behind both.
      expect(backdrop.contains(screen.getByTestId('connections-panel'))).toBe(false);
    });

    it('puts the icon in a tinted tile in the chosen tone', () => {
      const { rerender } = render(<Modal visible title="New agent ticket" icon="plus" onClose={() => {}} testID="m" />);
      const tile = () => getComputedStyle(screen.getByTestId('m-icon'));
      expect(tile().backgroundColor).toBe(rgb(color.claudeTint));
      expect(tile().width).toBe('40px');
      expect(screen.getByTestId('m-icon').querySelector('svg')?.getAttribute('stroke')).toBe(color.claude);

      rerender(<Modal visible title="Connections" icon="link" iconTone="ado" onClose={() => {}} testID="m" />);
      expect(tile().backgroundColor).toBe(rgb(color.adoTint));
      expect(screen.getByTestId('m-icon').querySelector('svg')?.getAttribute('stroke')).toBe(color.ado);
    });

    it('renders the title in the display face and the subtitle in muted text', () => {
      render(<Modal visible title="Connections" subtitle="Tokens are encrypted." onClose={() => {}} />);
      expect(getComputedStyle(screen.getByText('Connections')).fontWeight).toBe('800');
      expect(getComputedStyle(screen.getByText('Tokens are encrypted.')).color).toBe(rgb(color.muted));
    });

    it('shows the body and the footer slot under a divider', () => {
      render(
        <Modal visible title="Connections" onClose={() => {}} footer={footer}>
          {body()}
        </Modal>,
      );
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy();
      const save = screen.getByRole('button', { name: 'Save connections' });
      const footerRow = save.parentElement as HTMLElement;
      expect(getComputedStyle(footerRow).borderTopColor).toBe(rgb(color.line));
      expect(getComputedStyle(footerRow).borderTopWidth).toBe('1px');
      expect(getComputedStyle(footerRow).justifyContent).toBe('flex-end');
    });

    it('sizes the panel by width, never wider than the window', () => {
      render(<Modal visible title="New agent ticket" width={1040} onClose={() => {}} testID="m" />);
      const style = getComputedStyle(screen.getByTestId('m-panel'));
      expect(style.width).toBe('1040px');
      expect(style.maxWidth).toBe('100%');
      expect(style.maxHeight).toBe('100%');
    });
  });

  describe('closing', () => {
    it('has a close button that calls onClose', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<Harness initiallyOpen onClose={onClose} />);
      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on Esc', async () => {
      const onClose = vi.fn();
      const user = await openWithKeyboard(<Harness onClose={onClose}>{body()}</Harness>);
      expect(dialog()).toBeTruthy();

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not close when the backdrop is clicked', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<Harness initiallyOpen onClose={onClose} testID="m" />);
      await user.click(screen.getByTestId('m-backdrop'));
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog()).toBeTruthy();
    });

    it('takes a custom close label', () => {
      render(<Modal visible title="Connections" closeLabel="Close connections" onClose={() => {}} />);
      expect(screen.getByRole('button', { name: 'Close connections' })).toBeTruthy();
    });
  });

  describe('blocking (first-run Connections)', () => {
    it('has no close button', () => {
      render(<Modal visible blocking title="Connections" />);
      expect(dialog()).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });

    it('ignores Esc and backdrop clicks, and never calls onClose', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <Harness initiallyOpen blocking onClose={onClose} testID="m">
          {body()}
        </Harness>,
      );

      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: 'Test connection' }));
      await user.keyboard('{Escape}');
      await user.click(screen.getByTestId('m-backdrop'));
      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
      expect(dialog()).toBeTruthy();
    });

    it('closes on Esc once it stops blocking', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(<Modal visible blocking title="Connections" onClose={onClose} />);
      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();

      rerender(<Modal visible blocking={false} title="Connections" onClose={onClose} />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('accepts a boolean `blocking` when onClose is given (checked by tsc)', () => {
      const firstRun: boolean = true;
      const element = <Modal visible blocking={firstRun} title="Connections" onClose={() => {}} />;
      expect(element.props.blocking).toBe(true);
      // @ts-expect-error A modal that can be dismissed needs onClose.
      const missing = <Modal visible title="Connections" />;
      expect(missing.props.title).toBe('Connections');
    });
  });

  describe('focus', () => {
    it('moves focus into the modal when it opens', async () => {
      await openWithKeyboard(
        <Harness footer={footer}>{body()}</Harness>,
      );
      expect(dialog().contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    });

    it('keeps Tab and Shift+Tab inside the modal, wrapping at either end', async () => {
      const user = await openWithKeyboard(<Harness footer={footer}>{body()}</Harness>);
      const close = screen.getByRole('button', { name: 'Close' });
      const test = screen.getByRole('button', { name: 'Test connection' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      const save = screen.getByRole('button', { name: 'Save connections' });
      const behind = screen.getByRole('button', { name: 'Behind the modal' });

      const visited: Element[] = [];
      for (let i = 0; i < 9; i += 1) {
        await user.tab();
        visited.push(document.activeElement as Element);
      }
      expect(visited).toEqual([test, cancel, save, close, test, cancel, save, close, test]);

      const back: Element[] = [];
      for (let i = 0; i < 6; i += 1) {
        await user.tab({ shift: true });
        back.push(document.activeElement as Element);
      }
      expect(back).toEqual([close, save, cancel, test, close, save]);
      expect([...visited, ...back]).not.toContain(behind);
    });

    it('keeps focus inside a blocking modal too', async () => {
      const user = userEvent.setup();
      render(
        <Harness initiallyOpen blocking footer={footer}>
          {body()}
        </Harness>,
      );
      const inside = new Set([
        screen.getByRole('button', { name: 'Test connection' }),
        screen.getByRole('button', { name: 'Cancel' }),
        screen.getByRole('button', { name: 'Save connections' }),
      ]);
      expect(inside.has(document.activeElement as HTMLElement)).toBe(true);
      for (let i = 0; i < 7; i += 1) {
        await user.tab();
        expect(inside.has(document.activeElement as HTMLElement)).toBe(true);
      }
      for (let i = 0; i < 7; i += 1) {
        await user.tab({ shift: true });
        expect(inside.has(document.activeElement as HTMLElement)).toBe(true);
      }
    });

    it('pulls focus back if something outside tries to take it', async () => {
      await openWithKeyboard(<Harness footer={footer}>{body()}</Harness>);
      act(() => {
        screen.getByRole('button', { name: 'Behind the modal' }).focus();
      });
      expect(dialog().contains(document.activeElement)).toBe(true);
    });

    it('returns focus to the opener after Esc, with the focus ring', async () => {
      const user = await openWithKeyboard(<Harness footer={footer}>{body()}</Harness>);
      await user.tab();
      await user.keyboard('{Escape}');

      const opener = screen.getByRole('button', { name: 'Open connections' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(getComputedStyle(opener.firstElementChild as HTMLElement).outlineColor).toBe(rgb(focusRing.color));
    });

    it('returns focus to the opener after the close button is clicked', async () => {
      const user = userEvent.setup();
      render(<Harness>{body()}</Harness>);
      const opener = screen.getByRole('button', { name: 'Open connections' });
      await user.click(opener);
      expect(dialog()).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it('focuses initialFocusRef when it opens, and still returns focus to the opener', async () => {
      function WithField() {
        const [open, setOpen] = useState(false);
        const field = useRef<TextInputInstance>(null);
        return (
          <>
            <Button label="New agent ticket" onPress={() => setOpen(true)} />
            <Modal visible={open} title="New agent ticket" initialFocusRef={field} onClose={() => setOpen(false)}>
              <Button label="Sprint 42" />
              <TextInput ref={field} aria-label="Search by ID or title" />
            </Modal>
          </>
        );
      }
      const user = userEvent.setup();
      render(<WithField />);
      const opener = screen.getByRole('button', { name: 'New agent ticket' });
      await user.click(opener);
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search by ID or title' }));

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('stacked modals', () => {
    it('Esc closes only the top modal, then focus goes back into the one below', async () => {
      function Stack() {
        const [outer, setOuter] = useState(true);
        const [inner, setInner] = useState(false);
        return (
          <>
            <Modal visible={outer} title="Connections" onClose={() => setOuter(false)}>
              <Button label="Remove" variant="danger" onPress={() => setInner(true)} />
            </Modal>
            <Modal visible={inner} title="Remove CompanionSystems?" onClose={() => setInner(false)}>
              <Button label="Keep it" />
            </Modal>
          </>
        );
      }
      const user = userEvent.setup();
      render(<Stack />);
      const remove = screen.getByRole('button', { name: 'Remove' });
      await user.click(remove);
      expect(screen.getByRole('dialog', { name: 'Remove CompanionSystems?' })).toBeTruthy();

      await user.keyboard('{Escape}');

      expect(screen.queryByText('Remove CompanionSystems?')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Connections' })).toBeTruthy();
      expect(document.activeElement).toBe(remove);
    });
  });
});
