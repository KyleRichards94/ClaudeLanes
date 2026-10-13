import { expect, type Page } from '@playwright/test';

/**
 * Flight deck groups the output by turn (AL-279): a finished turn is one summary row until it is opened, and only
 * the live turn is always open. A spec that reads rows inside a finished turn (a user's message, a tool row) opens
 * the turns first.
 *
 * Opens every collapsed turn row that is drawn. The stream draws only the rows near the view, so this can leave
 * far-off turns closed; the specs' transcripts are short.
 */
export async function expandTurns(page: Page): Promise<void> {
  const collapsed = page.locator('[data-testid^="turn-row-"][aria-expanded="false"]');
  for (let attempt = 0; attempt < 20 && (await collapsed.count()) > 0; attempt += 1) {
    await collapsed.first().click();
  }
}

/**
 * Waits until the ticket's output holds `text`, opening collapsed turns as they appear (an agent's turn ends and
 * collapses while a spec is still reading it).
 */
export async function expectOutputToContain(page: Page, text: string, timeout = 30_000): Promise<void> {
  const output = page.getByTestId('ticket-tab-output');
  await expect
    .poll(
      async () => {
        await expandTurns(page);
        return output.innerText();
      },
      { timeout, message: `the output should contain "${text}"` },
    )
    .toContain(text);
}
