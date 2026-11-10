/**
 * The Wrangler environment this bundle was deployed as, inlined by
 * `wrangler deploy --define` in the deploy script. Unset in local dev and tests.
 */
declare const process: { readonly env: { readonly CLOUDFLARE_ENV?: string } };
