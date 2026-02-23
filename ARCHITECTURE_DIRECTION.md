# Direction
This is operator edited file. AI agent should read it but not edit.

## k8v Overview

k8v is a visual programming environment. It uses visual programming language to define programs in form of graphs. Graph can be used to define program in functional paradigm, message passing paradigm and some other forms where graph nodes represent program elements, connections represent flow of messages, passed between computing units.

### Graph Definition

*Graph Definition* defines a computer program. It defines how the data flows, it does not have state.
It also defines how the program *looks*. Similarly to text in traditional computer programs, graph has visual representation that can be experienced by the user, so the graph nodes have coordinates in space, so it can be properly visually interpreted by the user, looking at the computer screen and interacting with the program.
Visual graph representation is one specific form of user interfaces to the programs, created as Graph Definitions in k8v.

### Separation of state from Graph Definition

Computer programs shipped as executable code do not contain state.
Similarly, programs, shipped as graph definitions, do not contain state.
For example, current timer counter or external input is not a part of graph definition.
Timer counter, some external input values, such as typed in numeric values or slider movements are part of state, not part of graph definition.

Graph editing capability of k8v environment is completely different from the *Graph Runtime*.
Input values should never be stored as a part of graph definition.

### Runtime State

*Runtime State* is all of the data that is used externally and produced by the program.

### Deployment

Graph Definition Programs can be deployed in various vays.
Current implementation assumes there is one deployment mode: "Deployed In Browser".
This means, when user opens graph in a browser window, there should be a *state* version that is supposed to be executed interactively. It is stored separately from the graph in the database, in another database schema.

In future, there could be other deployment modes, for example "Deployed In Cloud".

### Graph Runtime

k8v IDE has its own runtime that can *execute* the graph definition programs interactively.

Runtime manages available resources, such as CPU, RAM, storage, network and other, higher level abstractions over those basic resources.
