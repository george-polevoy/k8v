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
  - Library nodes with retrievable manifests
- **Reusable Subgraphs**: Wrap interlinked parts of graph into reusable library nodes
- **Visual Programming**: Create library nodes using the graph as a visual programming language
- **Node Panel Editing**: Edit card names and manage input ports (add, rename, reorder, delete)
- **Graph Management in UI**: Select graph, create graph, and rename current graph from node panel
- **Node Status Indicators**: Card-level indicator for compute status, stale downstream state, and errors
- **Error-State Smoke Cue**: Error nodes emit subtle black smoke on the canvas
- **Auto Recompute Toggle**: Opt-in downstream recompute when upstream nodes change
- **Canvas Pencil Tool**: Draw freehand annotations with selectable color (white/green/red) and thickness (1/3/9 px)
- **MCP Agent API**: Backend MCP server supports graph editing actions and internal rectangle-based graph screenshots
- **Python Runtime**: Inline nodes can execute with backend `python_process` runtime

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
- graph CRUD-style editing operations (create nodes, move, connect, update code/settings, compute)
- internal screenshot tool `graph_screenshot_region`:
  - renders only graph content on an internal page
  - captures a fixed-size bitmap from an explicit world rectangle (`x`, `y`, `width`, `height`)
  - overlays stable concise node numbers to aid OCR/agent coordination

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
