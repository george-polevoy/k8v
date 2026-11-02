import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright';
import { createInlineCodeGraph, fetchGraph, submitGraphCommands } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

test.before(ensureE2EEnvironment);
test.after(shutdownE2EEnvironment);

async function selectNode(page: Page, nodeId: string) {
  await page.evaluate((id) => (window as any).__k8vGraphStore.getState().selectNode(id), nodeId);
  await openSidebarSection(page, 'node');
}

async function waitForInput(page: Page, nodeId: string, index: number, expected: Record<string, unknown>) {
  await page.waitForFunction(({ id, idx, value }) => {
    const input = (window as any).__k8vGraphStore.getState().graph.nodes.find((node: any) => node.id === id).metadata.inputs[idx];
    return Object.entries(value).every(([key, entry]) => JSON.stringify(input[key]) === JSON.stringify(entry));
  }, { id: nodeId, idx: index, value: expected }, { timeout: E2E_ASSERT_TIMEOUT_MS });
  const graphId = await page.evaluate(() => (window as any).__k8vGraphStore.getState().graph.id);
  const deadline = Date.now() + E2E_ASSERT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const graph = await fetchGraph(graphId);
    const input = (graph.nodes.find((node) => node.id === nodeId) as any)?.metadata.inputs[index];
    if (input && Object.entries(expected).every(([key, value]) => JSON.stringify(input[key]) === JSON.stringify(value))) return;
    await delay(50);
  }
  assert.fail(`Input ${index} was not persisted: ${JSON.stringify(expected)}`);
}

test('inline input controls save numeric, text, boolean and local date-time, with unset and type changes', { timeout: 120_000 }, async () => {
  const { graphId, nodeId } = await createInlineCodeGraph({ inputNames: ['amount', 'text', 'flag', 'when'] });
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Riyadh' });
    const page = await context.newPage();
    await openCanvasForGraph(page, graphId);
    await selectNode(page, nodeId);
    const field = (name: string) => page.getByTestId(name);
    await field('input-type-0').selectOption('number');
    await field('input-value-0').fill('0');
    await field('input-value-0').press('Enter');
    await waitForInput(page, nodeId, 0, { defaultValue: 0 });
    await field('input-max-0').fill('10');
    await field('input-max-0').press('Enter');
    await waitForInput(page, nodeId, 0, { editor: { min: 0, max: 10, step: 1 } });
    const slider = field('input-slider-0');
    await slider.focus();
    await slider.press('ArrowRight');
    await waitForInput(page, nodeId, 0, { defaultValue: 1 });
    const rect = await slider.boundingBox();
    assert.ok(rect);
    await page.mouse.move(rect.x + rect.width * 0.25, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.75, rect.y + rect.height / 2);
    const duringDrag = await fetchGraph(graphId);
    assert.equal((duringDrag.nodes.find((node) => node.id === nodeId) as any).metadata.inputs[0].defaultValue, 1);
    await page.mouse.up();
    await page.waitForFunction((id) => (window as any).__k8vGraphStore.getState().graph.nodes.find((node: any) => node.id === id).metadata.inputs[0].defaultValue >= 7, nodeId);
    await field('input-value-0').fill('99');
    await field('input-value-0').press('Enter');
    await page.getByRole('alert').filter({ hasText: 'within' }).waitFor();
    await field('input-value-0').press('Escape');
    await field('input-type-1').selectOption('string');
    await field('input-value-1').fill('hello');
    await page.evaluate(async () => (window as any).__k8vGraphStore.getState().submitGraphCommands([{ kind: 'set_graph_name', name: 'autotests_typed_inputs_draft_update' }]));
    assert.equal(await field('input-value-1').inputValue(), 'hello');
    await field('input-value-1').press('Enter');
    await waitForInput(page, nodeId, 1, { defaultValue: 'hello' });
    await field('input-value-1').fill('');
    await field('input-value-1').press('Enter');
    await waitForInput(page, nodeId, 1, { defaultValue: '' });
    await field('input-type-2').selectOption('boolean');
    assert.equal(await field('input-value-2').evaluate((element: HTMLInputElement) => element.indeterminate), true);
    await field('input-value-2').check();
    await waitForInput(page, nodeId, 2, { defaultValue: true });
    await field('input-value-2').uncheck();
    await waitForInput(page, nodeId, 2, { defaultValue: false });
    await field('input-type-3').selectOption('date-time');
    await field('input-value-3').fill('2026-11-02T15:30');
    await field('input-value-3').press('Enter');
    await waitForInput(page, nodeId, 3, { defaultValue: '2026-11-02T12:30:00.000Z' });
    // waitForInput verifies backend persistence before reloading.
    await page.reload();
    await page.locator('canvas').first().waitFor();
    await page.waitForFunction((id) => (window as any).__k8vGraphStore?.getState().graph?.id === id, graphId);
    await selectNode(page, nodeId);
    assert.equal(await field('input-value-2').isChecked(), false);
    assert.equal(await field('input-value-3').inputValue(), '2026-11-02T15:30');
    await field('input-type-2').selectOption('number');
    await field('input-confirm-type-2').waitFor();
    assert.equal(await field('input-type-2').inputValue(), 'boolean');
    await field('input-confirm-type-2').click();
    await waitForInput(page, nodeId, 2, { schema: { type: 'number' } });
    await field('input-type-2').selectOption('any');
    await waitForInput(page, nodeId, 2, { schema: { type: 'any' } });
    assert.equal(await field('input-value-2').count(), 0);
    await field('input-clear-1').click();
    await waitForInput(page, nodeId, 1, { defaultValue: undefined });
    await field('add-input-button').click();
    await field('input-type-4').selectOption('boolean');
    await field('input-value-4').check();
    await field('input-value-4').uncheck();
    await waitForInput(page, nodeId, 4, { defaultValue: false });
    await field('input-name-4').fill('extra');
    await field('input-name-4').press('Enter');
    await waitForInput(page, nodeId, 4, { name: 'extra', defaultValue: false });
    await field('input-move-up-4').click();
    await waitForInput(page, nodeId, 3, { name: 'extra', defaultValue: false });
    await field('input-delete-3').click();
    await waitForInput(page, nodeId, 3, { name: 'when', defaultValue: '2026-11-02T12:30:00.000Z' });
    await context.close();
  } finally { await browser.close(); }
});

test('connection disables local control and disconnect restores the saved boolean', { timeout: 90_000 }, async () => {
  const { graphId, nodeId } = await createInlineCodeGraph({ inputNames: ['flag'], code: 'outputs.output = inputs.flag;' });
  const graph = await fetchGraph(graphId);
  await submitGraphCommands(graphId, graph.revision, [
    { kind: 'node_update_input', nodeId, inputName: 'flag', schema: { type: 'boolean' }, defaultValue: false },
    { kind: 'node_add_inline', nodeId: 'source', name: 'Source', x: 0, y: 0, code: 'outputs.value = true;' },
    { kind: 'connection_add', connectionId: 'typed-edge', sourceNodeId: 'source', sourcePort: 'value', targetNodeId: nodeId, targetPort: 'flag' },
  ], 'Seed connected boolean');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openCanvasForGraph(page, graphId);
    await selectNode(page, nodeId);
    assert.equal(await page.getByTestId('input-value-0').isDisabled(), true);
    assert.match(await page.getByTestId('input-source-0').innerText(), /Source.value/);
    await page.evaluate(async () => (window as any).__k8vGraphStore.getState().submitGraphCommands([{ kind: 'connection_delete', connectionId: 'typed-edge' }]));
    await page.waitForFunction(() => !document.querySelector('[data-testid="input-value-0"]')?.matches(':disabled'));
    assert.equal(await page.getByTestId('input-value-0').isEnabled(), true);
    assert.equal(await page.getByTestId('input-value-0').isChecked(), false);
  } finally { await browser.close(); }
});
