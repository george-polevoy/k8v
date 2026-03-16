import { useCallback, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { PythonEnvironment } from '../types';
import {
  addPythonEnvDraft as addPythonEnvDraftEntry,
  buildPythonEnvCommitPlan,
  deletePythonEnvDraft as deletePythonEnvDraftEntry,
  type PythonEnvDraftField,
  updatePythonEnvDraftField as updatePythonEnvDraftFieldValue,
} from '../utils/panelPythonEnvHelpers';

interface UseGraphManagementStateOptions {
  enabled?: boolean;
}

export function useGraphManagementState(
  { enabled = true }: UseGraphManagementStateOptions = {}
) {
  const graph = useGraphStore((state) => state.graph);
  const graphSummaries = useGraphStore((state) => state.graphSummaries);
  const loadGraph = useGraphStore((state) => state.loadGraph);
  const createGraph = useGraphStore((state) => state.createGraph);
  const deleteGraph = useGraphStore((state) => state.deleteGraph);
  const refreshGraphSummaries = useGraphStore((state) => state.refreshGraphSummaries);
  const submitGraphCommands = useGraphStore((state) => state.submitGraphCommands);

  const [graphNameValue, setGraphNameValue] = useState('');
  const [newGraphName, setNewGraphName] = useState('Untitled Graph');
  const [pythonEnvDrafts, setPythonEnvDrafts] = useState<PythonEnvironment[]>([]);
  const [pythonEnvValidationError, setPythonEnvValidationError] = useState<string | null>(null);
  const [isGraphActionInFlight, setIsGraphActionInFlight] = useState(false);
  const [isDeleteGraphConfirming, setIsDeleteGraphConfirming] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refreshGraphSummaries();
  }, [enabled, refreshGraphSummaries]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (graph) {
      setGraphNameValue(graph.name);
      setPythonEnvDrafts(graph.pythonEnvs ?? []);
    } else {
      setGraphNameValue('');
      setPythonEnvDrafts([]);
    }
    setPythonEnvValidationError(null);
  }, [enabled, graph]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setIsDeleteGraphConfirming(false);
  }, [enabled, graph?.id]);

  const runGraphAction = useCallback(async (action: () => Promise<void>) => {
    setIsGraphActionInFlight(true);
    try {
      await action();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, []);

  const commitGraphName = useCallback(async () => {
    if (!graph) {
      return;
    }

    const trimmed = graphNameValue.trim();
    if (!trimmed) {
      setGraphNameValue(graph.name);
      return;
    }
    if (trimmed === graph.name) {
      return;
    }

    await runGraphAction(async () => {
      await submitGraphCommands([{
        kind: 'set_graph_name',
        name: trimmed,
      }]);
      await refreshGraphSummaries();
    });
  }, [graph, graphNameValue, refreshGraphSummaries, runGraphAction, submitGraphCommands]);

  const handleSelectGraph = useCallback(async (graphId: string) => {
    if (!graphId || (graph && graph.id === graphId)) {
      return;
    }

    await runGraphAction(async () => {
      await loadGraph(graphId);
      await refreshGraphSummaries();
    });
  }, [graph, loadGraph, refreshGraphSummaries, runGraphAction]);

  const handleCreateGraph = useCallback(async () => {
    const name = newGraphName.trim() || 'Untitled Graph';

    await runGraphAction(async () => {
      await createGraph(name);
      await refreshGraphSummaries();
      setNewGraphName('Untitled Graph');
    });
  }, [createGraph, newGraphName, refreshGraphSummaries, runGraphAction]);

  const requestDeleteCurrentGraph = useCallback(() => {
    if (!graph || isGraphActionInFlight) {
      return;
    }
    setIsDeleteGraphConfirming(true);
  }, [graph, isGraphActionInFlight]);

  const cancelDeleteCurrentGraph = useCallback(() => {
    if (isGraphActionInFlight) {
      return;
    }
    setIsDeleteGraphConfirming(false);
  }, [isGraphActionInFlight]);

  const handleDeleteCurrentGraph = useCallback(async () => {
    if (!graph) {
      return;
    }

    await runGraphAction(async () => {
      await deleteGraph(graph.id);
      await refreshGraphSummaries();
      setIsDeleteGraphConfirming(false);
    });
  }, [deleteGraph, graph, refreshGraphSummaries, runGraphAction]);

  const updatePythonEnvDraftField = useCallback((
    index: number,
    field: PythonEnvDraftField,
    value: string
  ) => {
    setPythonEnvDrafts((current) => updatePythonEnvDraftFieldValue(current, index, field, value));
    setPythonEnvValidationError(null);
  }, []);

  const addPythonEnvDraft = useCallback(() => {
    setPythonEnvDrafts((current) => addPythonEnvDraftEntry(current));
    setPythonEnvValidationError(null);
  }, []);

  const deletePythonEnvDraft = useCallback((index: number) => {
    setPythonEnvDrafts((current) => deletePythonEnvDraftEntry(current, index));
    setPythonEnvValidationError(null);
  }, []);

  const commitPythonEnvs = useCallback(async () => {
    if (!graph) {
      return;
    }

    const resolution = buildPythonEnvCommitPlan(graph, pythonEnvDrafts);
    if (!resolution.ok) {
      setPythonEnvValidationError(resolution.error);
      return;
    }

    await runGraphAction(async () => {
      await submitGraphCommands([
        {
          kind: 'replace_nodes',
          nodes: resolution.nextNodes,
        },
        {
          kind: 'replace_python_envs',
          pythonEnvs: resolution.normalizedEnvs,
        },
      ]);
      await refreshGraphSummaries();
      setPythonEnvValidationError(null);
    });
  }, [graph, pythonEnvDrafts, refreshGraphSummaries, runGraphAction, submitGraphCommands]);

  return {
    graph,
    graphSummaries,
    refreshGraphSummaries,
    submitGraphCommands,
    graphNameValue,
    setGraphNameValue,
    newGraphName,
    setNewGraphName,
    pythonEnvDrafts,
    pythonEnvValidationError,
    isGraphActionInFlight,
    isDeleteGraphConfirming,
    runGraphAction,
    commitGraphName,
    handleSelectGraph,
    handleCreateGraph,
    requestDeleteCurrentGraph,
    cancelDeleteCurrentGraph,
    handleDeleteCurrentGraph,
    updatePythonEnvDraftField,
    addPythonEnvDraft,
    deletePythonEnvDraft,
    commitPythonEnvs,
  };
}
