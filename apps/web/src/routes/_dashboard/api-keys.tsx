import { apiKeyPrefixes, type ApiKey } from "@herald/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, KeyRoundIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { CopyableValue } from "@/components/copyable-value";
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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUtc } from "@/lib/format";
import { API_KEY_ENV_VAR } from "@/lib/integration-snippets";
import { issueProviderApiKey, getApiKeys, revokeProviderApiKey } from "@/server/api-keys";

export const Route = createFileRoute("/_dashboard/api-keys")({
  loader: () => getApiKeys(),
  head: () => ({ meta: [{ title: "API keys · Herald" }] }),
  component: ApiKeys,
});

function ApiKeys() {
  const keys = Route.useLoaderData();
  const { heraldEnv } = Route.useRouteContext();
  const prefix = apiKeyPrefixes[heraldEnv];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-medium">API keys</h1>
        <p className="text-muted-foreground">
          Your server sends a Herald API key to Herald's facilitator to verify and settle payments.
          Keys made here start with <code>{prefix}</code> and work only on Herald's {heraldEnv}{" "}
          facilitator.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <CardDescription>
            Use one key per service, so you can revoke one without touching the others.
          </CardDescription>
          {keys.length > 0 ? (
            <CardAction>
              <CreateKeyButton />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {keys.length > 0 ? (
            <KeyTable keys={keys} />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>No API keys yet</EmptyTitle>
                <EmptyDescription>
                  Create a key, then follow the <Link to="/integration">integration snippet</Link>{" "}
                  to take your first payment.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <CreateKeyButton />
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KeyTable({ keys }: { keys: ApiKey[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Environment</TableHead>
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
            <TableCell className="font-mono">{key.prefix}…</TableCell>
            <TableCell>
              <Badge variant="outline">{key.env}</Badge>
            </TableCell>
            <TableCell>{formatUtc(key.createdAt)}</TableCell>
            <TableCell className="text-muted-foreground">
              {key.lastUsedAt ? formatUtc(key.lastUsedAt) : "Never"}
            </TableCell>
            <TableCell>
              {key.revokedAt ? (
                <Badge variant="destructive">Revoked {formatUtc(key.revokedAt)}</Badge>
              ) : (
                <Badge variant="secondary">Active</Badge>
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
function CreateKeyButton() {
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
    <div className="flex flex-col items-end gap-2">
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
          {secret ? <CopyableValue label="API key" value={secret} /> : null}
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Copy it now</AlertTitle>
            <AlertDescription>
              Herald keeps only a hash of the key and can't show it again. If you lose it, revoke it
              and create another.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button variant="outline" nativeButton={false} render={<Link to="/integration" />}>
              Integration snippet
            </Button>
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
            Herald's facilitator rejects this key from the next request on, so any server still
            using it stops taking payments. You can't undo this.
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
