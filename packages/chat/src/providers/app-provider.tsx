import { ChatsProvider } from "./chats-provider";
import { ModelProvider } from "./model-provider";

/** Composes every app-level provider; keeps the root route declarative. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <ModelProvider>
      <ChatsProvider>{children}</ChatsProvider>
    </ModelProvider>
  );
}
