import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** One axe rule a page breaks, trimmed for a readable assertion message. */
export interface AxeProblem {
  id: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
}

/**
 * Runs axe-core on the page (AL-033) and returns the serious and critical violations. Legacy mode runs
 * everything inside the page: the default mode opens a second blank page, which Electron's context
 * can't do.
 */
export async function seriousAxeViolations(page: Page): Promise<AxeProblem[]> {
  const results = await new AxeBuilder({ page }).setLegacyMode(true).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      // The element and axe's reason (e.g. the measured contrast), first line of each.
      targets: violation.nodes.slice(0, 8).map((node) => `${node.html.slice(0, 120)} :: ${(node.failureSummary ?? '').split('\n')[1]?.trim() ?? ''}`),
    }));
}

/** An interactive element smaller than the 44 px target (design §11). */
export interface SmallTarget {
  role: string;
  name: string;
  width: number;
  height: number;
}

/** Design §11: targets are at least 44 × 44 px. */
export const MIN_TARGET_PX = 44;

/** What the target-size audit found: how many controls it measured and the ones under 44 px. */
export interface TargetAudit {
  checked: number;
  small: SmallTarget[];
}

/**
 * Target-size audit (AL-033): measures every visible control (buttons, tabs, switches, radios,
 * checkboxes, links and text fields). Text fields only need the height, since their width follows
 * the layout. Runs as a string so the e2e tsconfig needs no DOM types.
 */
export async function auditTargets(page: Page): Promise<TargetAudit> {
  return page.evaluate(`(() => {
    const min = ${MIN_TARGET_PX};
    const selector = 'button, a[href], input, textarea, select, [role=button], [role=tab], [role=switch], [role=radio], [role=checkbox], [role=link]';
    const small = [];
    let checked = 0;
    for (const element of document.querySelectorAll(selector)) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || element.closest('[aria-hidden=true]')) continue;
      checked += 1;
      const tag = element.tagName.toLowerCase();
      const field = tag === 'input' || tag === 'textarea' || tag === 'select';
      // Sub-pixel layout can put a 44 px target at 43.99.
      const tooSmall = Math.round(box.height) < min || (!field && Math.round(box.width) < min);
      if (tooSmall) {
        small.push({
          role: element.getAttribute('role') || tag,
          name: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 60),
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
      }
    }
    return { checked, small };
  })()`);
}
