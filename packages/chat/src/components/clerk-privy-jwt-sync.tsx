import { useAuth } from "@clerk/react";
import { useSubscribeToJwtAuthWithFlag } from "@privy-io/react-auth";

export function ClerkPrivyJwtSync() {
  const { isSignedIn, isLoaded, getToken } = useAuth();

  useSubscribeToJwtAuthWithFlag({
    isAuthenticated: isSignedIn,
    isLoading: !isLoaded,
    getExternalJwt: async () => (await getToken()) ?? undefined,
  });

  return null;
}
