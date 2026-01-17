# k8v Quick Start Guide

## Installation

```bash
# Install all dependencies
npm run install:all
```

## Running the Application

```bash
# Start both frontend and backend
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Creating Your First Graph

1. **Open the application** in your browser
2. **Click the "+" button** in the toolbar to add a node
3. **Select "Inline Code"** as the node type
4. **Enter a name** (e.g., "Add Numbers")
5. **Add code**:
   ```javascript
   outputs.result = inputs.a + inputs.b;
   ```
6. **Click "Create"** - the node appears on the canvas
7. **Add another node** (e.g., "Multiply")
8. **Connect nodes** by dragging from output handles to input handles
9. **Click the "▶" button** to compute the graph

## Node Types

- **Inline Code**: Write JavaScript code directly
- **Library Node**: Use pre-built nodes from the library
- **External Input**: Define data entry points
- **External Output**: Define data exit points

## Tips

- **Select a node** to edit its code in the right panel
- **Drag nodes** to reposition them
- **Connect ports** by dragging from output to input
- **Compute graph** to see results (stored in `./data` directory)

## Next Steps

- See `EXAMPLES.md` for more complex examples
- Read `ARCHITECTURE.md` for technical details
- Create reusable subgraphs for complex workflows
