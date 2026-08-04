import { useAuth, useClerk } from "@clerk/react";
import { useSigners, useUser, useWallets } from "@privy-io/react-auth";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@ivanius.ai/ui/components/button";
import { SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";

import type { MessageDraft } from "../types/message";
import { MessageComposer } from "../components/message-composer";
import { useChats } from "../providers/chats-provider";
import { useModel } from "../providers/model-provider";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

const suggestions = ["Swap tokens", "Send crypto", "Delegate to an agent", "Check my balance"];

function ChatComponent() {
  const navigate = useNavigate();
  const { startChat } = useChats();
  const { model, setModel } = useModel();
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();

  const { user } = useUser();
  const { ready, wallets } = useWallets();
  const { addSigners } = useSigners();

  function begin(draft: MessageDraft) {
    if (!isSignedIn) throw openSignIn();

    const chatId = startChat({ draft, model });
    void navigate({ to: "/chat/$chatId", params: { chatId } });
  }

  useEffect(() => {
    if (!ready) return;
  }, [ready]);

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <SidebarTrigger className="md:hidden" />
        <div className="ml-auto">
          <Button variant="outline" size="lg">
            <Plus />
            New chat
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-20">
        <Button
          disabled={!ready}
          onClick={async () => {
            // console.log(user);
            // const wallet = wallets.find(
            //   (wallet) => wallet.connectorType === "embedded" && wallet.type === "ethereum"
            // );
            // if (!wallet) return;
            // const { user } = await addSigners({
            //   address: wallet.address,
            //   signers: [
            //     {
            //       signerId: "t1chi3zhzkvwzs61k37u0vih",
            //     },
            //   ],
            // });
            // console.table(user);
          }}
        >
          Enable agent to access your wallet
        </Button>
        <h1 className="mb-6 font-serif text-4xl tracking-tight">What can I help with?</h1>
        <MessageComposer
          className="max-w-2xl"
          model={model}
          onModelChange={setModel}
          onSend={begin}
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full font-normal text-muted-foreground"
              onClick={() => begin({ text: suggestion, attachments: [] })}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      </main>
    </div>
  );
}
