// `accepts()` and the facilitator URLs land here in #3. Until then the package
// only exposes the network names it will take.
import type { Environment } from "@herald/core";

/** Which Herald deployment a Provider integrates with. */
export type Network = Environment;
