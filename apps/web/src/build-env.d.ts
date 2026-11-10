/**
 * The Wrangler environment this bundle was built for, inlined by the `define`
 * in vite.config.ts. Empty in local dev.
 */
declare const process: { readonly env: { readonly CLOUDFLARE_ENV?: string } };
