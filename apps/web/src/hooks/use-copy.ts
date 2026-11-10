import { useEffect, useState } from "react";

/** Copies text to the clipboard; `copied` stays true for two seconds after. */
export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return { copied, copy };
}
