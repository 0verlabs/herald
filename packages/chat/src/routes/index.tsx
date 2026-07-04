import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@ivanius.ai/ui/components/button";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

function ChatComponent() {
  return <Button>Payout Threshold</Button>;
}
