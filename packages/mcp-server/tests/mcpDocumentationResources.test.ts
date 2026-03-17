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
  assert.ok(server.resources.has('graph-command-schema'));
  assert.ok(server.resources.has('graph-query-schema'));
  assert.ok(server.resources.has('annotation-workflows'));
  assert.ok(server.resources.has('workflow-examples'));

  const overview = await server.resources.get('mcp-overview')!.callback();
  const overviewText = (overview as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(overviewText, /graph_create/);
  assert.match(overviewText, /bulk_edit/);

  const annotation = await server.resources.get('annotation-workflows')!.callback();
  const annotationText = (annotation as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(annotationText, /node_add_annotation/);
  assert.match(annotationText, /__annotation__/);

  const examplesResource = server.resources.get('workflow-examples');
  assert.ok(examplesResource);
  const template = examplesResource.uriOrTemplate as { uriTemplate?: { toString: () => string } };
  assert.equal(template.uriTemplate?.toString(), 'k8v://docs/examples/{topic}');

  const example = await examplesResource.callback(new URL('k8v://docs/examples/annotation-arrows'), {
    topic: 'annotation-arrows',
  });
  const exampleText = (example as { contents: Array<{ text?: string }> }).contents[0]?.text ?? '';
  assert.match(exampleText, /connection_add/);
  assert.match(exampleText, /__annotation__/);
});
