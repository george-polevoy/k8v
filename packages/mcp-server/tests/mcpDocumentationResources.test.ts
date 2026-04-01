import assert from 'node:assert/strict';
import test from 'node:test';
import { registerDocumentationResources } from '../src/mcpDocumentationResources.ts';

class FakeMcpServer {
  readonly resources = new Map<string, {
    uriOrTemplate: unknown;
    config: Record<string, unknown>;
    callback: (...args: any[]) => Promise<unknown>;
  }>();

  registerResource(
    name: string,
    uriOrTemplate: unknown,
    config: Record<string, unknown>,
    callback: (...args: any[]) => Promise<unknown>
  ): void {
    this.resources.set(name, { uriOrTemplate, config, callback });
  }
}

test('documentation resources register discoverability docs and schemas', async () => {
  const server = new FakeMcpServer();
  registerDocumentationResources(server as unknown as any);

  assert.ok(server.resources.has('mcp-overview'));
  assert.ok(server.resources.has('node-config-schema'));
  assert.ok(server.resources.has('graph-command-schema'));
  assert.ok(server.resources.has('graph-query-schema'));
  assert.ok(server.resources.has('annotation-workflows'));
  assert.ok(server.resources.has('wasm-algo-invocation'));
  assert.ok(server.resources.has('workflow-examples'));

  const overview = await server.resources.get('mcp-overview')!.callback();
  const overviewText = (overview as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(overviewText, /graph_create/);
  assert.match(overviewText, /bulk_edit/);
  assert.match(overviewText, /algo_injection_run/);
  assert.doesNotMatch(overviewText, /algo_injection_register/);
  assert.match(overviewText, /structured MCP objects/i);
  assert.match(overviewText, /do not stringify/i);
  assert.match(overviewText, /node_set_custom/);
  assert.match(overviewText, /flat exhaustive `config` keyed by top-level `node\.type`/i);
  assert.match(overviewText, /k8v:\/\/docs\/node-config-schema\.json/);
  const recommendedReadingIndex = overviewText.indexOf('Recommended reading order:');
  const referenceSchemasIndex = overviewText.indexOf(
    'Reference schemas for uncommon commands or validation details:'
  );
  const recommendedBulkEditExampleIndex = overviewText.indexOf(
    'k8v://docs/examples/bulk-edit-call',
    recommendedReadingIndex
  );
  const referenceNodeConfigSchemaIndex = overviewText.indexOf(
    'k8v://docs/node-config-schema.json',
    referenceSchemasIndex
  );
  assert.ok(
    recommendedReadingIndex >= 0 &&
      referenceSchemasIndex > recommendedReadingIndex &&
      recommendedBulkEditExampleIndex > recommendedReadingIndex &&
      referenceNodeConfigSchemaIndex > referenceSchemasIndex &&
      recommendedBulkEditExampleIndex < referenceNodeConfigSchemaIndex
  );

  const nodeConfigSchema = await server.resources.get('node-config-schema')!.callback();
  const nodeConfigSchemaText =
    (nodeConfigSchema as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(nodeConfigSchemaText, /inline_code/);
  assert.match(nodeConfigSchemaText, /numeric_input/);
  assert.match(nodeConfigSchemaText, /annotation/);
  assert.match(nodeConfigSchemaText, /displayTextOutputs/);

  const annotation = await server.resources.get('annotation-workflows')!.callback();
  const annotationText = (annotation as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(annotationText, /node_add_annotation/);
  assert.match(annotationText, /cardWidth/);
  assert.match(annotationText, /cardHeight/);
  assert.match(annotationText, /__annotation__/);
  assert.match(annotationText, /\(targetNodeId, targetPort, targetAnchor\)/);
  assert.match(annotationText, /distinct .*targetAnchor\.offset/i);
  assert.match(annotationText, /connection_set/);

  const algoDocs = await server.resources.get('wasm-algo-invocation')!.callback();
  const algoDocsText = (algoDocs as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(algoDocsText, /invoked transiently/i);
  assert.match(algoDocsText, /graph_get/);
  assert.match(algoDocsText, /graph_query/);
  assert.match(algoDocsText, /bulk_edit/);
  assert.match(algoDocsText, /absolute `wasmPath`/i);
  assert.match(algoDocsText, /filesystem access/i);

  const examplesResource = server.resources.get('workflow-examples');
  assert.ok(examplesResource);
  const template = examplesResource.uriOrTemplate as {
    uriTemplate?: { toString: () => string };
    _callbacks?: {
      list?: () => Promise<{ resources: Array<{ uri: string; name: string }> }>;
      complete?: { topic?: () => Promise<string[]> };
    };
  };
  assert.equal(template.uriTemplate?.toString(), 'k8v://docs/examples/{topic}');
  const listedExamples = await template._callbacks?.list?.();
  assert.ok(listedExamples);
  assert.ok(listedExamples?.resources.some((resource) => resource.uri === 'k8v://docs/examples/bulk-edit-call'));
  assert.ok(listedExamples?.resources.some((resource) => resource.uri === 'k8v://docs/examples/annotation-multi-arrows'));
  assert.ok(listedExamples?.resources.some((resource) => resource.uri === 'k8v://docs/examples/algo-run'));
  const completedTopics = await template._callbacks?.complete?.topic?.();
  assert.deepEqual(
    completedTopics,
    [
      'annotation-board',
      'annotation-arrows',
      'annotation-multi-arrows',
      'algo-run',
      'bulk-edit-call',
      'bulk-edit-retry',
      'graph-query',
    ]
  );

  const example = await examplesResource.callback(new URL('k8v://docs/examples/annotation-arrows'), {
    topic: 'annotation-arrows',
  });
  const exampleText = (example as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(exampleText, /connection_add/);
  assert.match(exampleText, /__annotation__/);

  const bulkEditExample = await examplesResource.callback(new URL('k8v://docs/examples/bulk-edit-call'), {
    topic: 'bulk-edit-call',
  });
  const bulkEditExampleText =
    (bulkEditExample as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(bulkEditExampleText, /structured objects/i);
  assert.match(bulkEditExampleText, /graphId/);
  assert.match(bulkEditExampleText, /cardWidth/);
  assert.match(bulkEditExampleText, /cardHeight/);

  const algoRunExample = await examplesResource.callback(new URL('k8v://docs/examples/algo-run'), {
    topic: 'algo-run',
  });
  const algoRunExampleText =
    (algoRunExample as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(algoRunExampleText, /wasmPath/);
  assert.match(algoRunExampleText, /absolute\/path/i);
  assert.match(algoRunExampleText, /Renamed by wasm/);

  const multiArrowExample = await examplesResource.callback(
    new URL('k8v://docs/examples/annotation-multi-arrows'),
    {
      topic: 'annotation-multi-arrows',
    }
  );
  const multiArrowExampleText =
    (multiArrowExample as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(multiArrowExampleText, /0\.35/);
  assert.match(multiArrowExampleText, /0\.75/);
});
