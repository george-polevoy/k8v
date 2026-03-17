import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { createEmptyGraph, fetchGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const DEFAULT_CAMERA_ID = 'default-camera';

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

interface FloatingWindowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GraphCameraResponse {
  id?: string;
  viewport?: {
    x?: unknown;
    y?: unknown;
    scale?: unknown;
  };
  floatingWindows?: Record<string, unknown>;
}

function approxEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

async function readViewportTransform(page: Page): Promise<ViewportTransform> {
  return page.evaluate(() => {
    const debugCounters = (window as Window & {
      __k8vCanvasDebug?: {
        viewportX?: unknown;
        viewportY?: unknown;
        viewportScale?: unknown;
      };
    }).__k8vCanvasDebug;

    return {
      x: typeof debugCounters?.viewportX === 'number' ? debugCounters.viewportX : Number.NaN,
      y: typeof debugCounters?.viewportY === 'number' ? debugCounters.viewportY : Number.NaN,
      scale: typeof debugCounters?.viewportScale === 'number' ? debugCounters.viewportScale : Number.NaN,
    };
  });
}

async function waitForViewportTransform(
  page: Page,
  predicate: (transform: ViewportTransform) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<ViewportTransform> {
  const startedAt = Date.now();
  let lastTransform = await readViewportTransform(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    lastTransform = await readViewportTransform(page);
    if (predicate(lastTransform)) {
      return lastTransform;
    }
    await page.waitForTimeout(60);
  }

  throw new Error(`Timed out waiting for viewport transform. Last value: ${JSON.stringify(lastTransform)}`);
}

async function dispatchCanvasWheel(
  page: Page,
  options: {
    x: number;
    y: number;
    deltaX?: number;
    deltaY: number;
    ctrlKey?: boolean;
  }
): Promise<void> {
  await page.evaluate((eventOptions) => {
    const mainCanvas = document.querySelector('canvas');
    if (!(mainCanvas instanceof HTMLCanvasElement)) {
      throw new Error('Main canvas not found');
    }
    mainCanvas.dispatchEvent(new WheelEvent('wheel', {
      deltaX: eventOptions.deltaX ?? 0,
      deltaY: eventOptions.deltaY,
      ctrlKey: eventOptions.ctrlKey ?? false,
      clientX: eventOptions.x,
      clientY: eventOptions.y,
      bubbles: true,
      cancelable: true,
    }));
  }, options);
}

async function dragFloatingWindow(
  page: Page,
  windowId: string,
  deltaX: number,
  deltaY: number
): Promise<FloatingWindowBox> {
  const handle = page.locator(`[data-testid="floating-window-drag-${windowId}"]`);
  const handleBox = await handle.boundingBox();
  assert.ok(handleBox, `Expected drag handle bounds for ${windowId}`);

  const startX = handleBox.x + (handleBox.width / 2);
  const startY = handleBox.y + (handleBox.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(220);

  const windowBox = await page.locator(`[data-testid="floating-window-${windowId}"]`).boundingBox();
  assert.ok(windowBox, `Expected floating window bounds for ${windowId}`);
  return windowBox;
}

async function waitForFloatingWindowBox(
  page: Page,
  windowId: string,
  predicate: (box: FloatingWindowBox) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<FloatingWindowBox> {
  const startedAt = Date.now();
  let lastBox: FloatingWindowBox | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastBox = await page.locator(`[data-testid="floating-window-${windowId}"]`).boundingBox() as FloatingWindowBox | null;
    if (lastBox && predicate(lastBox)) {
      return lastBox;
    }
    await page.waitForTimeout(60);
  }

  throw new Error(`Timed out waiting for floating window ${windowId}. Last value: ${JSON.stringify(lastBox)}`);
}

async function waitForCameraSelectValue(
  page: Page,
  expectedValue: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  await page.waitForFunction((cameraId: string) => {
    const select = document.querySelector('[data-testid="camera-select"]');
    return select instanceof HTMLSelectElement && select.value === cameraId;
  }, expectedValue, {
    timeout: timeoutMs,
  });
}

async function readCameraSelectOptions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const select = document.querySelector('[data-testid="camera-select"]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Camera select not found');
    }
    return Array.from(select.options).map((option) => option.value);
  });
}

async function fetchGraphCameras(graphId: string): Promise<GraphCameraResponse[]> {
  const graph = await fetchGraph(graphId) as { cameras?: GraphCameraResponse[] };
  return Array.isArray(graph.cameras) ? graph.cameras : [];
}

async function waitForGraphCamera(
  graphId: string,
  cameraId: string,
  predicate: (camera: GraphCameraResponse) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<GraphCameraResponse> {
  const startedAt = Date.now();
  let lastCamera: GraphCameraResponse | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    const cameras = await fetchGraphCameras(graphId);
    lastCamera = cameras.find((camera) => camera.id === cameraId) ?? null;
    if (lastCamera && predicate(lastCamera)) {
      return lastCamera;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(`Timed out waiting for graph camera ${cameraId}. Last value: ${JSON.stringify(lastCamera)}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'graph cameras can be created, switched, removed, and selected per browser window',
  { timeout: 120_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Graph Cameras');
    const browser = await launchBrowser();

    try {
      const firstContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const firstPage = await firstContext.newPage();
      await firstPage.addInitScript(() => {
        (window as Window & {
          __k8vCanvasDebug?: Record<string, unknown>;
        }).__k8vCanvasDebug = {};
      });
      await openCanvasForGraph(firstPage, graphId);
      await waitForCameraSelectValue(firstPage, DEFAULT_CAMERA_ID);

      const canvas = firstPage.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Expected canvas bounds for camera test');

      const initialViewport = await waitForViewportTransform(firstPage, (transform) =>
        Number.isFinite(transform.x) &&
        Number.isFinite(transform.y) &&
        Number.isFinite(transform.scale)
      );

      const defaultSidebarBox = await dragFloatingWindow(firstPage, 'right-sidebar', -180, 110);
      const defaultToolbarBox = await dragFloatingWindow(firstPage, 'toolbar', 130, 92);

      await firstPage.mouse.move(
        canvasBox.x + (canvasBox.width * 0.62),
        canvasBox.y + (canvasBox.height * 0.46)
      );
      await dispatchCanvasWheel(firstPage, {
        x: canvasBox.x + (canvasBox.width * 0.62),
        y: canvasBox.y + (canvasBox.height * 0.46),
        deltaY: -90,
      });
      const zoomedDefaultViewport = await waitForViewportTransform(firstPage, (transform) =>
        transform.scale > (initialViewport.scale + 0.05)
      );

      const defaultPanStart = {
        x: canvasBox.x + 320,
        y: canvasBox.y + 220,
      };
      const defaultPanDelta = {
        x: 150,
        y: 90,
      };
      await firstPage.keyboard.down('Space');
      await firstPage.mouse.move(defaultPanStart.x, defaultPanStart.y);
      await firstPage.mouse.down();
      await firstPage.mouse.move(
        defaultPanStart.x + defaultPanDelta.x,
        defaultPanStart.y + defaultPanDelta.y,
        { steps: 16 }
      );
      await firstPage.mouse.up();
      await firstPage.keyboard.up('Space');

      const defaultViewport = await waitForViewportTransform(firstPage, (transform) =>
        Math.abs(transform.x - zoomedDefaultViewport.x) > 3 ||
        Math.abs(transform.y - zoomedDefaultViewport.y) > 3
      );
      await firstPage.evaluate(() => {
        (window as Window & {
          __k8vFlushViewportCameraState?: () => void;
        }).__k8vFlushViewportCameraState?.();
      });

      await waitForGraphCamera(
        graphId,
        DEFAULT_CAMERA_ID,
        (camera) => (
          typeof camera.viewport?.x === 'number' &&
          typeof camera.viewport?.y === 'number' &&
          typeof camera.viewport?.scale === 'number' &&
          Boolean(camera.floatingWindows?.toolbar) &&
          Boolean(camera.floatingWindows?.['right-sidebar'])
        )
      );

      await firstPage.locator('[data-testid="camera-add"]').click();
      await firstPage.waitForFunction(() => {
        const select = document.querySelector('[data-testid="camera-select"]');
        return select instanceof HTMLSelectElement && select.options.length === 2;
      }, undefined, { timeout: E2E_ASSERT_TIMEOUT_MS });

      const cameraOptionsAfterAdd = await readCameraSelectOptions(firstPage);
      const customCameraId = cameraOptionsAfterAdd.find((cameraId) => cameraId !== DEFAULT_CAMERA_ID);
      assert.ok(customCameraId, 'Expected a newly added camera id');
      await waitForCameraSelectValue(firstPage, customCameraId);

      const customSidebarBox = await dragFloatingWindow(firstPage, 'right-sidebar', 120, -70);
      const customToolbarBox = await dragFloatingWindow(firstPage, 'toolbar', -110, 70);

      const customViewportBeforePan = await waitForViewportTransform(firstPage, () => true);
      const customPanStart = {
        x: canvasBox.x + 420,
        y: canvasBox.y + 240,
      };
      const customPanDelta = {
        x: -135,
        y: 118,
      };
      await firstPage.keyboard.down('Space');
      await firstPage.mouse.move(customPanStart.x, customPanStart.y);
      await firstPage.mouse.down();
      await firstPage.mouse.move(
        customPanStart.x + customPanDelta.x,
        customPanStart.y + customPanDelta.y,
        { steps: 16 }
      );
      await firstPage.mouse.up();
      await firstPage.keyboard.up('Space');

      const customViewport = await waitForViewportTransform(firstPage, (transform) =>
        Math.abs(transform.x - customViewportBeforePan.x) > 3 ||
        Math.abs(transform.y - customViewportBeforePan.y) > 3
      );
      await firstPage.evaluate(() => {
        (window as Window & {
          __k8vFlushViewportCameraState?: () => void;
        }).__k8vFlushViewportCameraState?.();
      });

      await waitForGraphCamera(
        graphId,
        customCameraId,
        (camera) => (
          typeof camera.viewport?.x === 'number' &&
          typeof camera.viewport?.y === 'number' &&
          typeof camera.viewport?.scale === 'number' &&
          Boolean(camera.floatingWindows?.toolbar) &&
          Boolean(camera.floatingWindows?.['right-sidebar'])
        )
      );

      await firstPage.locator('[data-testid="camera-select"]').selectOption(DEFAULT_CAMERA_ID);
      await waitForCameraSelectValue(firstPage, DEFAULT_CAMERA_ID);

      const restoredDefaultViewport = await waitForViewportTransform(firstPage, (transform) =>
        approxEqual(transform.x, defaultViewport.x, 2) &&
        approxEqual(transform.y, defaultViewport.y, 2) &&
        approxEqual(transform.scale, defaultViewport.scale, 0.02)
      );
      assert.ok(
        approxEqual(restoredDefaultViewport.x, defaultViewport.x, 2) &&
        approxEqual(restoredDefaultViewport.y, defaultViewport.y, 2) &&
        approxEqual(restoredDefaultViewport.scale, defaultViewport.scale, 0.02),
        'Expected switching back to the default camera to restore its viewport'
      );
      await waitForFloatingWindowBox(firstPage, 'right-sidebar', (box) =>
        approxEqual(box.x, defaultSidebarBox.x, 3) &&
        approxEqual(box.y, defaultSidebarBox.y, 3)
      );
      await waitForFloatingWindowBox(firstPage, 'toolbar', (box) =>
        approxEqual(box.x, defaultToolbarBox.x, 3) &&
        approxEqual(box.y, defaultToolbarBox.y, 3)
      );

      await firstPage.locator('[data-testid="camera-select"]').selectOption(customCameraId);
      await waitForCameraSelectValue(firstPage, customCameraId);

      const restoredCustomViewport = await waitForViewportTransform(firstPage, (transform) =>
        approxEqual(transform.x, customViewport.x, 2) &&
        approxEqual(transform.y, customViewport.y, 2) &&
        approxEqual(transform.scale, customViewport.scale, 0.02)
      );
      assert.ok(
        approxEqual(restoredCustomViewport.x, customViewport.x, 2) &&
        approxEqual(restoredCustomViewport.y, customViewport.y, 2) &&
        approxEqual(restoredCustomViewport.scale, customViewport.scale, 0.02),
        'Expected switching to the custom camera to restore its viewport'
      );
      await waitForFloatingWindowBox(firstPage, 'right-sidebar', (box) =>
        approxEqual(box.x, customSidebarBox.x, 3) &&
        approxEqual(box.y, customSidebarBox.y, 3)
      );
      await waitForFloatingWindowBox(firstPage, 'toolbar', (box) =>
        approxEqual(box.x, customToolbarBox.x, 3) &&
        approxEqual(box.y, customToolbarBox.y, 3)
      );

      const secondContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      try {
        const secondPage = await secondContext.newPage();
        await secondPage.addInitScript(() => {
          (window as Window & {
            __k8vCanvasDebug?: Record<string, unknown>;
          }).__k8vCanvasDebug = {};
        });
        await openCanvasForGraph(secondPage, graphId);
        await waitForCameraSelectValue(secondPage, DEFAULT_CAMERA_ID);

        const secondViewport = await waitForViewportTransform(secondPage, (transform) =>
          Number.isFinite(transform.x) &&
          Number.isFinite(transform.y) &&
          Number.isFinite(transform.scale)
        );
        assert.ok(
          approxEqual(secondViewport.x, defaultViewport.x, 2) &&
          approxEqual(secondViewport.y, defaultViewport.y, 2) &&
          approxEqual(secondViewport.scale, defaultViewport.scale, 0.02),
          'Expected a new browser window to keep its own current-camera selection and open on the default camera'
        );

        const secondSidebarBox = await waitForFloatingWindowBox(secondPage, 'right-sidebar', () => true);
        const secondToolbarBox = await waitForFloatingWindowBox(secondPage, 'toolbar', () => true);
        assert.ok(
          approxEqual(secondSidebarBox.x, defaultSidebarBox.x, 3) &&
          approxEqual(secondSidebarBox.y, defaultSidebarBox.y, 3),
          'Expected a new browser window to restore the default camera sidebar layout'
        );
        assert.ok(
          approxEqual(secondToolbarBox.x, defaultToolbarBox.x, 3) &&
          approxEqual(secondToolbarBox.y, defaultToolbarBox.y, 3),
          'Expected a new browser window to restore the default camera toolbar layout'
        );
      } finally {
        await secondContext.close();
      }

      await firstPage.locator('[data-testid="camera-remove"]').click();
      await firstPage.waitForFunction(() => {
        const select = document.querySelector('[data-testid="camera-select"]');
        return select instanceof HTMLSelectElement && select.options.length === 1;
      }, undefined, { timeout: E2E_ASSERT_TIMEOUT_MS });
      await waitForCameraSelectValue(firstPage, DEFAULT_CAMERA_ID);

      const removeButtonDisabled = await firstPage.locator('[data-testid="camera-remove"]').isDisabled();
      assert.equal(removeButtonDisabled, true, 'Expected removing the custom camera to leave only the default camera');

      const remainingCameras = await fetchGraphCameras(graphId);
      assert.deepEqual(
        remainingCameras.map((camera) => camera.id),
        [DEFAULT_CAMERA_ID],
        'Expected deleting the custom camera to persist only the default camera on the graph'
      );

      await firstContext.close();
    } finally {
      await browser.close();
    }
  }
);
