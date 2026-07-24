import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { ModelId } from "../types/model";
import { DEFAULT_MODEL } from "../config/model";
import { modelIdSchema } from "../types/model";

const STORAGE_KEY = "ivanius.chat.model";

function readStoredModel(): ModelId {
  const parsed = modelIdSchema.safeParse(localStorage.getItem(STORAGE_KEY));
  return parsed.success ? parsed.data : DEFAULT_MODEL;
}

interface ModelContextValue {
  model: ModelId;
  setModel: (model: ModelId) => void;
}

const ModelContext = createContext<ModelContextValue | null>(null);

/** The user's preferred model, persisted across reloads. */
export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [model, setModelState] = useState<ModelId>(readStoredModel);

  const setModel = useCallback((next: ModelId) => {
    localStorage.setItem(STORAGE_KEY, next);
    setModelState(next);
  }, []);

  const value = useMemo(() => ({ model, setModel }), [model, setModel]);

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel() {
  const context = useContext(ModelContext);
  if (!context) {
    throw new Error("useModel must be used within a ModelProvider");
  }
  return context;
}
