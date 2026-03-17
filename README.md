# k8v - Flow-Based Modeling Software

k8v is an infinite canvas flow-based modeling software similar to Miro, but designed for data flow graphs. It combines the interactivity of visual programming with the power of deterministic computation.

## Features

- **Infinite Canvas**: Create and visualize complex data flow graphs on an unlimited canvas
- **Graph-Based Data Flow**: Nodes pass data to any other graph node, forming a directional graph
- **Directed Dependency Model**: Graphs are treated as directed dependencies and computed in topological order
- **Deterministic Computation**: Nodes recompute only when inputs or the node itself changes
- **Data Persistence**: All outputs are serialized and persisted in structured format
- **Type Inference**: System can infer output structure and validate connections
- **Named Inputs/Outputs**: Nodes have metadata defining named inputs and outputs
- **Multiple Node Types**:
  - Inline code nodes
  - Numeric input nodes
  - Annotation nodes
- **Node Panel Editing**: Edit card names and manage input ports (add, rename, reorder, delete)
- **Graph Panel Management**: Select graph, create graph, rename current graph, and delete current graph from dedicated graph panel
- **Floating Overlay Panels**: Toolbar and right-side panels are draggable overlay windows above the canvas
- **Accordion Sidebar Panels**: Graph, Node, and Output panels remain collapsible as an accordion inside the right-side panel window
- **Node Status Indicators**: Card-level indicator for compute status, stale downstream state, and errors
- **Error-State Smoke Cue**: Error nodes emit subtle black smoke on the canvas
- **Auto Recompute Toggle**: Opt-in downstream recompute when upstream nodes change
- **Persistent Drawings**: Create named drawing objects, draw paths into selected drawing, drag by handle, rename, and delete
- **MCP Agent API**: Backend MCP server exposes empty-graph creation, ordered `GraphCommand[]` mutations via `bulk_edit`, and internal rectangular screenshots
- **Python Runtime**: Inline nodes can execute with backend `python_process` runtime
- **Graph Python Envs**: Graphs can define named Python envs (`name`, `pythonPath`, `cwd`) and Python nodes can bind to them via `pythonEnv`
- **Python PNG Outputs**: Python nodes can render PNG graphics from data URLs, raw base64, or raw bytes via output helpers
- **Canvas Output Projection**: `python_process` nodes project latest graphics output directly below the node card on canvas

## Roadmap Notes

- Reusable library nodes are not currently implemented or triaged.
- Reusable subgraph packaging is also future roadmap work, not a supported feature today.

## Architecture

- **Frontend**: React + TypeScript + Pixi.js (infinite canvas renderer)
- **Backend**: Node.js + Express + TypeScript
- **MCP Server**: Node.js + Playwright (internal graph screenshot rendering for agents)
- **Storage**: SQLite for metadata, file system for serialized data

## Getting Started

```bash
# Install all dependencies
npm run install:all

# Start development servers
npm run dev
```

The frontend will be available at `http://localhost:5173` and the backend at `http://localhost:3000`.

## Testing

```bash
# Unit/integration tests
npm test

# Browser interaction regressions (Playwright + Node test runner)
npm run test:e2e
```

## Canvas Snapshot Debugging

Generate a headless screenshot of the Pixi canvas (no backend required):

```bash
npm run -w packages/frontend snapshot:canvas -- --out tmp/canvas.png
```

Tune readability (defaults are now high-res + zoomed):

```bash
npm run -w packages/frontend snapshot:canvas -- --out tmp/canvas.png --zoom 2.5 --width 2800 --height 1600 --dpr 2
```

## MCP Server (Agent API)

Run MCP server in development:

```bash
npm run dev:mcp
```

The MCP server exposes:
- `graph_create` for empty graph creation (name optional, no seeded nodes/connections)
- `bulk_edit`, which sends ordered backend `GraphCommand[]` batches and is the sole graph mutation surface (compute now flows through command variants instead of a dedicated `graph_compute`)
- read/query helpers: `graph_list`, `graph_get`, `graph_query` (`overview`, `traverse_bfs`, `traverse_dfs`, `starting_vertices`), and `connections_list`
- discoverability resources/templates for MCP schema/docs, including command/query schema JSON and annotation workflow examples
- internal screenshot tool `graph_screenshot_region`:
  - renders the preview frontend in `canvasOnly` mode
  - captures a fixed-size bitmap from an explicit world rectangle (`x`, `y`, `width`, `height`)
  - hides floating toolbar/sidebar windows while preserving the canvas rendering stack

## Project Structure

```
k8v/
├── packages/
│   ├── frontend/     # React frontend with infinite canvas
│   ├── backend/      # Node.js backend with computation engine
│   └── mcp-server/   # MCP API + internal Playwright graph screenshot renderer
└── README.md
```

## Documentation

- [FUNCTIONALITY.md](./FUNCTIONALITY.md) - current implemented behavior inventory
- [TEST_CASES.md](./TEST_CASES.md) - feature-to-test-case coverage map (automated/manual/gap)
- [BACKLOG.md](./BACKLOG.md) - prioritized engineering backlog and status
- [ARCHITECTURE.md](./ARCHITECTURE.md) - system architecture and component boundaries
