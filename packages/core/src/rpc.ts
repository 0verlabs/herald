/**
 * POSTs a JSON-RPC request to `url` and returns the response if its status
 * is 2xx. Herald's RPC endpoints are private URLs that carry an API key, so
 * the errors it throws never repeat the URL: on a failed request only the
 * error's name, on an error status only the status. `what` names the call
 * in those errors, e.g. `"NEAR RPC view_access_key"`.
 */
export async function postRpc(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  what: string,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    throw new Error(`${what} request failed (${name})`);
  }
  if (!response.ok) throw new Error(`${what} answered ${response.status}`);
  return response;
}
