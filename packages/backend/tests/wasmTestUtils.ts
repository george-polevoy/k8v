import { TextEncoder } from 'node:util';

const encoder = new TextEncoder();
let wabtPromise: Promise<any> | null = null;

function getWabt(): Promise<any> {
  if (!wabtPromise) {
    wabtPromise = import('wabt').then((module) => module.default());
  }
  return wabtPromise;
}

async function compileWatToBuffer(watSource: string): Promise<Buffer> {
  const wabt = await getWabt();
  const parsed = wabt.parseWat('inline-test-module.wat', watSource);
  try {
    const { buffer } = parsed.toBinary({});
    return Buffer.from(buffer);
  } finally {
    parsed.destroy();
  }
}

function allocAndPackPrelude(heapStart = 4096): string {
  return `
    (memory (export "memory") 1)
    (global $heap (mut i32) (i32.const ${heapStart}))
    (func (export "alloc") (param $len i32) (result i32)
      (local $ptr i32)
      global.get $heap
      local.set $ptr
      global.get $heap
      local.get $len
      i32.add
      global.set $heap
      local.get $ptr
    )
    (func $pack_ptr_len (param $ptr i32) (param $len i32) (result i64)
      local.get $len
      i64.extend_i32_u
      i64.const 32
      i64.shl
      local.get $ptr
      i64.extend_i32_u
      i64.or
    )
  `;
}

function dataSegment(offset: number, text: string): string {
  return `(data (i32.const ${offset}) ${JSON.stringify(text)})`;
}

export async function buildEchoAlgoWasmBuffer(): Promise<Buffer> {
  return await compileWatToBuffer(`
    (module
      ${allocAndPackPrelude()}
      (func (export "run") (param $ptr i32) (param $len i32) (result i64)
        local.get $ptr
        local.get $len
        call $pack_ptr_len
      )
    )
  `);
}

export async function buildGraphGetAlgoWasmBuffer(): Promise<Buffer> {
  return await compileWatToBuffer(`
    (module
      (import "k8v" "graph_get" (func $graph_get (result i64)))
      ${allocAndPackPrelude()}
      (func (export "run") (param $ptr i32) (param $len i32) (result i64)
        call $graph_get
      )
    )
  `);
}

export async function buildGraphQueryAlgoWasmBuffer(): Promise<Buffer> {
  const query = JSON.stringify({
    operation: 'overview',
    nodeFields: ['id', 'name'],
  });
  const queryLength = encoder.encode(query).length;
  return await compileWatToBuffer(`
    (module
      (import "k8v" "graph_query" (func $graph_query (param i32 i32) (result i64)))
      ${allocAndPackPrelude()}
      ${dataSegment(0, query)}
      (func (export "run") (param $ptr i32) (param $len i32) (result i64)
        i32.const 0
        i32.const ${queryLength}
        call $graph_query
      )
    )
  `);
}

export async function buildBulkEditAlgoWasmBuffer(nextName: string): Promise<Buffer> {
  const commandPayload = JSON.stringify([
    {
      kind: 'set_graph_name',
      name: nextName,
    },
  ]);
  const commandLength = encoder.encode(commandPayload).length;
  return await compileWatToBuffer(`
    (module
      (import "k8v" "bulk_edit" (func $bulk_edit (param i32 i32) (result i64)))
      ${allocAndPackPrelude()}
      ${dataSegment(0, commandPayload)}
      (func (export "run") (param $ptr i32) (param $len i32) (result i64)
        i32.const 0
        i32.const ${commandLength}
        call $bulk_edit
      )
    )
  `);
}

export async function buildComputeRejectAlgoWasmBuffer(): Promise<Buffer> {
  const commandPayload = JSON.stringify([{ kind: 'compute_graph' }]);
  const commandLength = encoder.encode(commandPayload).length;
  return await compileWatToBuffer(`
    (module
      (import "k8v" "bulk_edit" (func $bulk_edit (param i32 i32) (result i64)))
      ${allocAndPackPrelude()}
      ${dataSegment(0, commandPayload)}
      (func (export "run") (param $ptr i32) (param $len i32) (result i64)
        i32.const 0
        i32.const ${commandLength}
        call $bulk_edit
      )
    )
  `);
}

export async function buildTrapAlgoWasmBuffer(): Promise<Buffer> {
  return await compileWatToBuffer(`
    (module
      ${allocAndPackPrelude()}
      (func (export "run") (param $ptr i32) (param $len i32) (result i64)
        unreachable
      )
    )
  `);
}

export async function buildInfiniteLoopAlgoWasmBuffer(): Promise<Buffer> {
  return await compileWatToBuffer(`
    (module
      ${allocAndPackPrelude()}
      (func (export "run") (param $ptr i32) (param $len i32) (result i64)
        (loop $forever
          br $forever
        )
        i64.const 0
      )
    )
  `);
}

export async function buildMissingRunAlgoWasmBuffer(): Promise<Buffer> {
  return await compileWatToBuffer(`
    (module
      ${allocAndPackPrelude()}
    )
  `);
}
