import type { ApiKey } from "@herald/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { CopyField } from "@/components/shared/copy-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { environmentLabels } from "@/lib/environment";
import { formatUtc } from "@/lib/format";
import { API_KEY_ENV_VAR } from "@/lib/integration-snippets";
import { cn } from "@/lib/utils";
import { issueProviderApiKey, revokeProviderApiKey } from "@/server/api-keys";

export function KeyTable({ keys }: { keys: ApiKey[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell className="font-mono text-xs">{key.prefix}…</TableCell>
            <TableCell>{environmentLabels[key.env]}</TableCell>
            <TableCell>{formatUtc(key.createdAt)}</TableCell>
            <TableCell className="text-muted-foreground">
              {key.lastUsedAt ? formatUtc(key.lastUsedAt) : "Never"}
            </TableCell>
            <TableCell>
              {key.revokedAt ? (
                <Badge variant="destructive" title={`Revoked ${formatUtc(key.revokedAt)}`}>
                  Revoked
                </Badge>
              ) : (
                <Badge variant="success">Active</Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              {key.revokedAt ? null : <RevokeKeyButton apiKey={key} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Creates a key and shows it, once, in a dialog. */
export function CreateKeyButton({
  align = "end",
  showSetupLink = true,
}: {
  align?: "start" | "end";
  showSetupLink?: boolean;
}) {
  const router = useRouter();
  const create = useServerFn(issueProviderApiKey);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  async function handleCreate() {
    setPending(true);
    setError(null);
    try {
      const result = await create();
      setSecret(result.secret);
      await router.invalidate();
    } catch {
      setError("Herald couldn't create a key. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", align === "end" ? "items-end" : "items-start")}>
      <Button disabled={pending} onClick={handleCreate}>
        {pending ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
        Create key
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>No key created</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={secret !== null}
        onOpenChange={(open) => {
          if (!open) setSecret(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Put it in your server's <code>{API_KEY_ENV_VAR}</code> environment variable.
            </DialogDescription>
          </DialogHeader>
          {secret ? <CopyField label="API key" value={secret} /> : null}
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Copy it now</AlertTitle>
            <AlertDescription>
              Herald keeps only a fingerprint of the key and can't show it again. If you lose it,
              revoke it and create another.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            {showSetupLink ? (
              <Button variant="outline" nativeButton={false} render={<Link to="/integration" />}>
                See the setup steps
              </Button>
            ) : null}
            <Button onClick={() => setSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RevokeKeyButton({ apiKey }: { apiKey: ApiKey }) {
  const router = useRouter();
  const revoke = useServerFn(revokeProviderApiKey);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setPending(true);
    setError(null);
    try {
      const result = await revoke({ data: { apiKeyId: apiKey.id } });
      // Either way the list may be stale (say, revoked in another tab).
      await router.invalidate();
      if (result.ok) setOpen(false);
      else setError(result.message);
    } catch {
      setError("Herald couldn't revoke the key. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        Revoke
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {apiKey.prefix}…?</AlertDialogTitle>
          <AlertDialogDescription>
            Herald refuses this key from the next request on, so any server still using it stops
            taking payments. You can't undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Not revoked</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={handleRevoke}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
