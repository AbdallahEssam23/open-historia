/*! Open Historia — visual regression spec © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Interprets VISUAL_VIEWS and screenshots each one. A view that fails to reach
// its state fails its own test and the run moves on; the diff image is the
// artifact a human reads. Baselines are named `<view-id>.png` under
// visual/visual.spec.mjs-snapshots/ and are committed.
import { expect, test } from "@playwright/test";

import { VISUAL_VIEWS, visualPolicy } from "./views.mjs";

const policy = visualPolicy(process.env);

// The map broadcasts oh:map-idle from src/runtime/mapReadiness.js when the
// layers, labels and tiles have actually been drawn. Recorded at document start
// so an idle that fires before the listener exists is not missed.
const IDLE_INIT_SCRIPT = () => {
  window.__OH_VISUAL_IDLE__ = false;
  window.addEventListener("oh:map-idle", () => {
    window.__OH_VISUAL_IDLE__ = true;
  });
};

const clickAnyRole = async (page, names) => {
  for (const name of names) {
    const button = page.getByRole("button", { name, exact: true }).first();
    if (await button.count()) {
      await button.click({ timeout: 10_000 });
      return;
    }
  }
  throw new Error(`no button matched any of: ${names.join(", ")}`);
};

async function runStep(page, step) {
  if (step.dismissSetup) {
    const later = page.getByRole("button", { name: "Not now", exact: true }).first();
    if (await later.count()) await later.click({ timeout: 5_000 }).catch(() => {});
    return;
  }
  if (step.clickRole) {
    await page.getByRole("button", { name: step.clickRole, exact: true }).first()
      .click({ timeout: 10_000 });
    return;
  }
  if (step.clickAnyRole) {
    await clickAnyRole(page, step.clickAnyRole);
    return;
  }
  if (step.clickText) {
    const target = page.getByText(step.clickText, { exact: false }).first();
    await target.click({ timeout: 10_000 });
    return;
  }
  if (step.waitForRole) {
    await expect(
      page.getByRole("button", { name: step.waitForRole, exact: true }).first(),
    ).toBeVisible({ timeout: policy.timeoutMs });
    return;
  }
  if (step.waitForText) {
    await expect(page.getByText(step.waitForText, { exact: false }).first())
      .toBeVisible({ timeout: policy.timeoutMs });
    return;
  }
  if (step.waitForMapIdle) {
    await page.waitForFunction(
      () => window.__OH_VISUAL_IDLE__ === true,
      null,
      { timeout: policy.mapIdleTimeoutMs },
    );
    await page.waitForTimeout(policy.settleMs);
    return;
  }
  if (step.waitMs) {
    await page.waitForTimeout(step.waitMs);
    return;
  }
  if (step.pressEscape) {
    await page.keyboard.press("Escape");
    return;
  }
  throw new Error(`unknown visual step: ${JSON.stringify(step)}`);
}

for (const view of VISUAL_VIEWS) {
  test(`${view.id}: ${view.description}`, async ({ page }) => {
    await page.addInitScript(IDLE_INIT_SCRIPT);
    await page.goto("/");
    for (const step of view.steps) await runStep(page, step);
    await expect(page).toHaveScreenshot(`${view.id}.png`);
  });
}
