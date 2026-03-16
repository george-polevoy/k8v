import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { useGraphStore } from '../src/store/graphStore.ts';
import {
  clearCurrentCameraId,
  readCurrentCameraId,
  saveCurrentCameraId,
} from '../src/store/graphCameraSessionStorage.ts';
import {
  DEFAULT_GRAPH_CAMERA_ID,
  normalizeGraphCameraState,
  resolveFloatingWindowCameraLayout,
  resolveFloatingWindowPositionFromCamera,
} from '../src/utils/cameras.ts';
import {
  MemoryLocalStorage,
  makeGraph,
  resetGraphStoreState,
} from './graphStoreTestUtils.ts';

function assertApproxEqual(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test.beforeEach(() => {
  (globalThis as any).localStorage = new MemoryLocalStorage();
  (globalThis as any).sessionStorage = new MemoryLocalStorage();
  resetGraphStoreState();
});

test('normalizeGraphCameraState injects the default camera and clamps floating window layout ratios', () => {
  const normalized = normalizeGraphCameraState([
    {
      id: ' custom-camera ',
      name: '   ',
      viewport: {
        x: 120,
        y: 240,
        scale: 1.5,
      },
      floatingWindows: {
        toolbar: {
          horizontal: {
            edge: 'left',
            ratio: -0.25,
          },
          vertical: {
            edge: 'bottom',
            ratio: 1.75,
          },
        },
        invalid: {
          horizontal: {
            edge: 'middle',
            ratio: 0.2,
          },
          vertical: {
            edge: 'top',
            ratio: 0.8,
          },
        } as any,
      },
    },
    {
      id: 'custom-camera',
      name: 'Duplicate',
      floatingWindows: {},
    },
  ]);

  assert.equal(normalized[0]?.id, DEFAULT_GRAPH_CAMERA_ID);
  const customCamera = normalized.find((camera) => camera.id === 'custom-camera');
  assert.ok(customCamera, 'Expected custom camera to be preserved');
  assert.equal(customCamera.name, 'custom-camera');
  assert.deepEqual(customCamera.viewport, {
    x: 120,
    y: 240,
    scale: 1.5,
  });
  assert.deepEqual(customCamera.floatingWindows?.toolbar, {
    horizontal: {
      edge: 'left',
      ratio: 0,
    },
    vertical: {
      edge: 'bottom',
      ratio: 1,
    },
  });
  assert.equal(customCamera.floatingWindows?.invalid, undefined);
  assert.equal(
    normalized.filter((camera) => camera.id === 'custom-camera').length,
    1,
    'Expected duplicate camera ids to be deduplicated'
  );
});

test('floating window camera layouts round-trip across viewport sizes without edge hysteresis', () => {
  const windowSize = { width: 320, height: 240 };
  const sourceViewport = { width: 1440, height: 900 };
  const resizedViewport = { width: 1024, height: 720 };
  const sourcePosition = { x: 1040, y: 520 };

  const layout = resolveFloatingWindowCameraLayout(
    sourcePosition,
    windowSize,
    sourceViewport
  );
  const restoredPosition = resolveFloatingWindowPositionFromCamera(
    layout,
    windowSize,
    resizedViewport,
    { x: 8, y: 8 }
  );
  const restoredLayout = resolveFloatingWindowCameraLayout(
    restoredPosition,
    windowSize,
    resizedViewport
  );

  assert.equal(layout.horizontal.edge, 'right');
  assert.equal(layout.vertical.edge, 'bottom');
  assert.equal(restoredLayout.horizontal.edge, layout.horizontal.edge);
  assert.equal(restoredLayout.vertical.edge, layout.vertical.edge);
  assertApproxEqual(restoredLayout.horizontal.ratio, layout.horizontal.ratio);
  assertApproxEqual(restoredLayout.vertical.ratio, layout.vertical.ratio);
});

test('graph camera session storage helpers persist camera selection per graph', () => {
  saveCurrentCameraId('graph-a', 'camera-a');
  saveCurrentCameraId('graph-b', 'camera-b');

  assert.equal(readCurrentCameraId('graph-a'), 'camera-a');
  assert.equal(readCurrentCameraId('graph-b'), 'camera-b');

  clearCurrentCameraId('graph-a');

  assert.equal(readCurrentCameraId('graph-a'), null);
  assert.equal(readCurrentCameraId('graph-b'), 'camera-b');
});

test('graph store restores and saves the current camera selection per window', async () => {
  const originalGet = axios.get;
  const graph = {
    ...makeGraph('g-cameras'),
    cameras: [
      {
        id: DEFAULT_GRAPH_CAMERA_ID,
        name: 'Default Camera',
        floatingWindows: {},
      },
      {
        id: 'camera-2',
        name: 'Camera 2',
        floatingWindows: {},
      },
    ],
  };

  (globalThis as any).sessionStorage.setItem('k8v-current-camera-id:g-cameras', 'camera-2');

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-cameras') {
      return { data: graph };
    }
    if (url === '/api/graphs/g-cameras/runtime-state') {
      return {
        data: {
          graphId: 'g-cameras',
          revision: graph.revision ?? 0,
          statusVersion: 1,
          queueLength: 0,
          workerConcurrency: 1,
          nodeStates: {},
          results: {},
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  try {
    await useGraphStore.getState().loadGraph('g-cameras');

    assert.equal(useGraphStore.getState().selectedCameraId, 'camera-2');

    useGraphStore.getState().selectCamera('missing-camera');

    assert.equal(useGraphStore.getState().selectedCameraId, DEFAULT_GRAPH_CAMERA_ID);
    assert.equal(
      (globalThis as any).sessionStorage.getItem('k8v-current-camera-id:g-cameras'),
      DEFAULT_GRAPH_CAMERA_ID
    );
  } finally {
    (axios as any).get = originalGet;
  }
});
