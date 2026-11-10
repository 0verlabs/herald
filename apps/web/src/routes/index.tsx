import { createFileRoute, redirect } from "@tanstack/react-router";

// The dashboard starts at Overview, whose layout sends signed-out visitors to
// sign-in.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/overview" });
  },
});
