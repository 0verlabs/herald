import { SweepMinimumEditSchema, USDC_DECIMALS } from "@herald/core";
import type { GasWalletStatus, SweepMinimumListing } from "@herald/core/server";
import { Await, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCopy } from "@/hooks/use-copy";
import {
  baseUnitsToDecimal,
  formatTokenAmount,
  formatUsdc,
  formatUtc,
  shortenMiddle,
} from "@/lib/format";
import {
  editSweepMinimum,
  getAdminAccount,
  getGasWalletStatuses,
  getSweepMinimums,
} from "@/server/admin";
import { getHeraldEnv } from "@/server/herald-env";

// For Herald admins only (the HERALD_ADMINS allowlist). Anyone else, signed
// in or not, gets the 404 page, and the server functions behind it answer
// 404 too (`requireAdmin`).
export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    // `getAdminAccount` answers 404 to anyone but an admin, which shows the
    // not-found page here; any other failure stays an error.
    const [account, heraldEnv] = await Promise.all([getAdminAccount(), getHeraldEnv()]);
    return { account: { ...account, isAdmin: true }, heraldEnv };
  },
  // Gas wallet balances come from each chain's RPC, so they stream in after
  // the page renders. A failed call as a whole shows as unavailable.
  loader: async () => ({
    minimums: await getSweepMinimums(),
    gasWallets: getGasWalletStatuses().catch(() => null),
  }),
  head: () => ({ meta: [{ title: "Admin · Herald" }] }),
  component: Admin,
});

function Admin() {
  const { account, heraldEnv } = Route.useRouteContext();
  const { minimums, gasWallets } = Route.useLoaderData();

  return (
    <AppShell account={account} heraldEnv={heraldEnv}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-medium">Admin</h1>
          <p className="text-muted-foreground">
            Herald {heraldEnv}'s gas wallets, which pay for every settlement and Sweep, and the
            minimum Sweep on each chain.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Gas wallets</CardTitle>
            <CardDescription>
              Native balance of Herald's gas wallet on each chain, read live. Top up a wallet before
              it runs dry: settlements and Sweeps on that chain stop without gas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Await promise={gasWallets} fallback={<GasWalletTable wallets={null} />}>
              {(loaded) =>
                loaded ? (
                  <GasWalletTable wallets={loaded} />
                ) : (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertTitle>Gas wallets unavailable</AlertTitle>
                    <AlertDescription>
                      Herald couldn't read its gas wallets. Reload the page to try again.
                    </AlertDescription>
                  </Alert>
                )
              }
            </Await>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sweep minimums</CardTitle>
            <CardDescription>
              Herald refuses a Sweep below its chain's minimum, so Providers don't lose funds to
              fees or 1Click's minimum deposit. A change applies to the next Sweep planned.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MinimumTable minimums={minimums} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

/** One row per chain; `wallets` is null while they load. */
function GasWalletTable({ wallets }: { wallets: GasWalletStatus[] | null }) {
  const low = wallets?.filter((w) => w.ok && w.low) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {low.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Low gas</AlertTitle>
          <AlertDescription>
            Top up the gas wallet on {low.map((w) => w.label).join(", ")}.
          </AlertDescription>
        </Alert>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Chain</TableHead>
            <TableHead>Gas wallet</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Warns below</TableHead>
            <TableHead>
              <span className="sr-only">Status</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wallets === null ? (
            <TableRow>
              {Array.from({ length: 5 }, (_, i) => (
                <TableCell key={i}>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
              ))}
            </TableRow>
          ) : (
            wallets.map((wallet) => <GasWalletRow key={wallet.network} wallet={wallet} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function GasWalletRow({ wallet }: { wallet: GasWalletStatus }) {
  const amount = (baseUnits: string) =>
    `${formatTokenAmount(baseUnits, wallet.decimals)} ${wallet.symbol}`;

  return (
    <TableRow>
      <TableCell>{wallet.label}</TableCell>
      <TableCell>
        {wallet.address ? (
          <CopyableAddress label={`${wallet.label} gas wallet`} address={wallet.address} />
        ) : (
          <span className="text-muted-foreground">Unknown</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {wallet.ok ? amount(wallet.balance) : null}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {wallet.threshold === null ? "No threshold" : amount(wallet.threshold)}
      </TableCell>
      <TableCell className="text-right">
        {!wallet.ok ? (
          <Badge variant="destructive" title={wallet.message}>
            Unavailable
          </Badge>
        ) : wallet.low ? (
          <Badge variant="destructive">Low</Badge>
        ) : (
          <Badge variant="secondary">OK</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

/** A shortened address with a button that copies all of it. */
function CopyableAddress({ label, address }: { label: string; address: string }) {
  const { copied, copy } = useCopy(address);

  return (
    <span className="flex items-center gap-1">
      <span className="font-mono" title={address}>
        {shortenMiddle(address)}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>
  );
}

function MinimumTable({ minimums }: { minimums: SweepMinimumListing[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Chain</TableHead>
          <TableHead className="text-right">Minimum (USDC)</TableHead>
          <TableHead>Note</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {minimums.map((minimum) => (
          <TableRow key={`${minimum.network}/${minimum.asset}`}>
            <TableCell>{minimum.label}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatUsdc(minimum.minimum)}
            </TableCell>
            <TableCell className="max-w-64 whitespace-normal text-muted-foreground">
              {minimum.note}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatUtc(minimum.updatedAt)}</TableCell>
            <TableCell className="text-right">
              <EditMinimumButton minimum={minimum} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type EditProblems = { minimum?: string; note?: string; form?: string };

function EditMinimumButton({ minimum }: { minimum: SweepMinimumListing }) {
  const router = useRouter();
  const save = useServerFn(editSweepMinimum);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<EditProblems>({});
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setAmount(baseUnitsToDecimal(minimum.minimum, USDC_DECIMALS));
      setNote(minimum.note);
      setProblems({});
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const edit = SweepMinimumEditSchema.safeParse({
      network: minimum.network,
      asset: minimum.asset,
      minimum: amount,
      note,
    });
    if (!edit.success) {
      const found: EditProblems = {};
      for (const issue of edit.error.issues) {
        const field =
          issue.path[0] === "note" ? "note" : issue.path[0] === "minimum" ? "minimum" : "form";
        found[field] ??= issue.message;
      }
      setProblems(found);
      return;
    }
    setPending(true);
    setProblems({});
    try {
      const result = await save({ data: edit.data });
      // Either way the table may be stale (say, edited in another tab).
      await router.invalidate();
      if (result.ok) setOpen(false);
      else setProblems({ form: result.message });
    } catch {
      setProblems({ form: "Herald couldn't save the minimum. Try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Sweep minimum on {minimum.label}</DialogTitle>
            <DialogDescription>
              Providers can't Sweep less than this from {minimum.label}. Sweeps already planned keep
              the minimum they were planned with.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={problems.minimum ? true : undefined}>
              <FieldLabel htmlFor="minimum-amount">Minimum (USDC)</FieldLabel>
              <Input
                id="minimum-amount"
                inputMode="decimal"
                autoComplete="off"
                className="font-mono"
                value={amount}
                aria-invalid={problems.minimum ? true : undefined}
                onChange={(e) => setAmount(e.target.value)}
              />
              <FieldDescription>Up to {USDC_DECIMALS} decimal places, like 0.15.</FieldDescription>
              <FieldError>{problems.minimum}</FieldError>
            </Field>
            <Field data-invalid={problems.note ? true : undefined}>
              <FieldLabel htmlFor="minimum-note">Note</FieldLabel>
              <Textarea
                id="minimum-note"
                value={note}
                aria-invalid={problems.note ? true : undefined}
                onChange={(e) => setNote(e.target.value)}
              />
              <FieldDescription>
                Where the figure comes from, and when you checked it.
              </FieldDescription>
              <FieldError>{problems.note}</FieldError>
            </Field>
          </FieldGroup>
          {problems.form ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>{problems.form}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
