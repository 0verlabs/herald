import {
  EvmAddressSchema,
  PriceSchema,
  priceToBaseUnits,
  USDC_DECIMALS,
  type SweepStatus,
} from "@herald/core";
import type { SweepChainOption, SweepEntry } from "@herald/core/server";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, ArrowRightLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatUsdc, formatUtc, shortenMiddle } from "@/lib/format";
import { walletFor } from "@/lib/near-wallet";
import { cn } from "@/lib/utils";
import { finishSweep, getSweepChoices, listSweeps, startSweep } from "@/server/sweeps";

export const Route = createFileRoute("/_dashboard/sweep")({
  loader: async () => {
    const [choices, sweeps] = await Promise.all([getSweepChoices(), listSweeps()]);
    return { choices, sweeps };
  },
  head: () => ({ meta: [{ title: "Sweep · Herald" }] }),
  component: SweepPage,
});

// While a Sweep is waiting on its signature or its receipt, the list
// refreshes this often.
const POLL_MS = 3_000;

const inFlight = (sweep: SweepEntry) =>
  sweep.status === "awaiting_signature" || sweep.status === "submitted";

function SweepPage() {
  const { choices, sweeps: loadedSweeps } = Route.useLoaderData();
  const router = useRouter();
  const fetchSweeps = useServerFn(listSweeps);
  // The list as last polled, until the loader runs again.
  const [polled, setPolled] = useState<{ after: SweepEntry[]; sweeps: SweepEntry[] } | null>(null);
  const sweeps = polled?.after === loadedSweeps ? polled.sweeps : loadedSweeps;

  // Follow unfinished Sweeps; once one finishes, reload the balances too.
  const following = sweeps.filter(inFlight).length;
  useEffect(() => {
    if (following === 0) return;
    const timer = setInterval(async () => {
      const latest = await fetchSweeps().catch(() => null);
      if (!latest) return;
      setPolled({ after: loadedSweeps, sweeps: latest });
      if (latest.filter(inFlight).length < following) await router.invalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [following, fetchSweeps, router, loadedSweeps]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-medium">Sweep</h1>
        <p className="text-muted-foreground">
          Move USDC from your EVM Receiving Address to any address on the same chain. Your NEAR
          wallet signs once, through NEAR Chain Signatures, and Herald pays the gas.
        </p>
      </div>

      <SweepForm
        chains={choices.chains}
        capReached={choices.submittedToday >= choices.dailyCap}
        dailyCap={choices.dailyCap}
        submittedToday={choices.submittedToday}
      />

      <Card>
        <CardHeader>
          <CardTitle>Sweeps</CardTitle>
          <CardDescription>Your latest Sweeps, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {sweeps.length > 0 ? (
            <SweepTable sweeps={sweeps} />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ArrowRightLeftIcon />
                </EmptyMedia>
                <EmptyTitle>No Sweeps yet</EmptyTitle>
                <EmptyDescription>
                  Sweeps you start show up here with their status.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Step = "idle" | "planning" | "signing" | "submitting";

const stepLabels: Record<Exclude<Step, "idle">, string> = {
  planning: "Planning the Sweep…",
  signing: "Waiting for your wallet…",
  submitting: "Reading the signature…",
};

/**
 * A USDC amount the Provider typed (`"1.5"`) in base units, or null if it
 * isn't a positive amount with at most 6 decimals.
 */
function usdcToBaseUnits(amount: string): string | null {
  const parsed = PriceSchema.safeParse(amount.trim());
  return parsed.success ? priceToBaseUnits(parsed.data, USDC_DECIMALS) : null;
}

/** Base units as a plain decimal the amount field accepts: `"1500000"` is `"1.5"`. */
function baseUnitsToInput(baseUnits: string): string {
  return formatUsdc(baseUnits)
    .replaceAll(",", "")
    .replace(/\.?0+$/, "");
}

function SweepForm(props: {
  chains: SweepChainOption[];
  capReached: boolean;
  dailyCap: number;
  submittedToday: number;
}) {
  const { account, heraldEnv } = Route.useRouteContext();
  const router = useRouter();
  const plan = useServerFn(startSweep);
  const finish = useServerFn(finishSweep);
  const [network, setNetwork] = useState(props.chains[0]?.network ?? "");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const chain = props.chains.find((c) => c.network === network);
  if (!chain) return null;
  const balance = chain.balance.ok ? chain.balance.amount : null;
  const baseUnits = usdcToBaseUnits(amount);
  const amountProblem = !amount
    ? null
    : baseUnits === null
      ? "Enter a USDC amount, like 1.50."
      : chain.minimum !== null && BigInt(baseUnits) < BigInt(chain.minimum)
        ? `The minimum Sweep on ${chain.label} is ${formatUsdc(chain.minimum)} USDC.`
        : balance !== null && BigInt(baseUnits) > BigInt(balance)
          ? `Your Receiving Address holds ${formatUsdc(balance)} USDC on ${chain.label}.`
          : null;
  const destinationProblem = !destination
    ? null
    : !EvmAddressSchema.safeParse(destination.trim()).success
      ? "Enter an EVM address: 0x and 40 hex characters."
      : destination.trim().toLowerCase() === chain.address.toLowerCase()
        ? "That's your Receiving Address. Sweep to another address."
        : null;
  const busy = step !== "idle";
  const ready =
    !busy &&
    !props.capReached &&
    balance !== null &&
    chain.minimum !== null &&
    baseUnits !== null &&
    amountProblem === null &&
    destination !== "" &&
    destinationProblem === null;

  async function handleSweep() {
    if (!ready || baseUnits === null) return;
    setError(null);
    setNotice(null);
    try {
      setStep("planning");
      const planned = await plan({
        data: { network, amount: baseUnits, destination: destination.trim() },
      });
      if (!planned.ok) throw new Error(planned.message);

      setStep("signing");
      const wallet = await walletFor(heraldEnv, account.accountId);
      const { signRequest } = planned;
      const outcome = await wallet.signAndSendTransaction({
        network: heraldEnv,
        signerId: account.accountId,
        receiverId: signRequest.contractId,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: signRequest.methodName,
              args: signRequest.args,
              gas: signRequest.gas,
              deposit: signRequest.deposit,
            },
          },
        ],
      });
      const nearTxHash: unknown = outcome.transaction_outcome?.id ?? outcome.transaction?.hash;
      if (typeof nearTxHash !== "string") {
        throw new Error("Your wallet didn't return the NEAR transaction hash.");
      }

      setStep("submitting");
      const finished = await finish({ data: { sweepId: planned.sweepId, nearTxHash } });
      if (!finished.ok) throw new Error(finished.message);
      if (finished.status === "failed") throw new Error(finished.error ?? "The Sweep failed.");
      setAmount("");
      setNotice(
        finished.status === "awaiting_signature"
          ? "The MPC network is still signing. Herald submits the transfer once the signature is on NEAR."
          : "Herald submitted the transfer. Follow it below.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Sweep didn't finish. Try again.");
    } finally {
      setStep("idle");
      // New balances, the cap count and the Sweep list.
      await router.invalidate();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Sweep</CardTitle>
        <CardDescription>
          Same chain, USDC only. The destination receives the full amount.
        </CardDescription>
        <CardAction>
          <Badge variant={props.capReached ? "destructive" : "outline"}>
            {props.submittedToday} of {props.dailyCap} today
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {props.capReached ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Daily limit reached</AlertTitle>
            <AlertDescription>
              Herald submits at most {props.dailyCap} Sweeps per Provider in 24 hours. Try again
              later.
            </AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel>Chain</FieldLabel>
            <ToggleGroup
              value={[network]}
              onValueChange={(value) => {
                if (value[0]) setNetwork(value[0]);
              }}
              variant="outline"
              disabled={busy}
            >
              {props.chains.map((option) => (
                <ToggleGroupItem key={option.network} value={option.network}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              {chain.balance.ok
                ? `Available: ${formatUsdc(chain.balance.amount)} USDC.`
                : chain.balance.message}{" "}
              {chain.minimum !== null
                ? `Minimum Sweep: ${formatUsdc(chain.minimum)} USDC.`
                : `Herald can't Sweep on ${chain.label} yet.`}
            </FieldDescription>
          </Field>
          <Field data-invalid={amountProblem ? true : undefined}>
            <FieldLabel htmlFor="sweep-amount">Amount (USDC)</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="sweep-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="font-mono"
                value={amount}
                disabled={busy}
                aria-invalid={amountProblem ? true : undefined}
                onChange={(event) => setAmount(event.target.value)}
              />
              {/* Left out rather than disabled: a disabled control greys out the whole group. */}
              {balance !== null && balance !== "0" && !busy ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton onClick={() => setAmount(baseUnitsToInput(balance))}>
                    Max
                  </InputGroupButton>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            <FieldError>{amountProblem}</FieldError>
          </Field>
          <Field data-invalid={destinationProblem ? true : undefined}>
            <FieldLabel htmlFor="sweep-destination">Destination address</FieldLabel>
            <Input
              id="sweep-destination"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              className="font-mono"
              value={destination}
              disabled={busy}
              aria-invalid={destinationProblem ? true : undefined}
              onChange={(event) => setDestination(event.target.value)}
            />
            <FieldDescription>
              Any address on {chain.label} that can hold USDC. Double-check it: a Sweep can't be
              undone.
            </FieldDescription>
            <FieldError>{destinationProblem}</FieldError>
          </Field>
        </FieldGroup>

        <SweepSummary
          chain={chain}
          amount={baseUnits !== null && amountProblem === null ? baseUnits : null}
          destination={destination && !destinationProblem ? destination.trim() : null}
        />

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The Sweep didn't go through</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertTitle>Sweep started</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!ready} onClick={handleSweep}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? stepLabels[step] : "Sweep with NEAR wallet"}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** What the Sweep will do, before the Provider signs it. */
function SweepSummary(props: {
  chain: SweepChainOption;
  amount: string | null;
  destination: string | null;
}) {
  const amount = props.amount ? `${formatUsdc(props.amount)} USDC` : null;
  const rows: { term: string; value: string | null; mono?: boolean; title?: string }[] = [
    { term: "Chain", value: props.chain.label },
    {
      term: "From",
      value: shortenMiddle(props.chain.address, 8, 6),
      mono: true,
      title: props.chain.address,
    },
    {
      term: "To",
      value: props.destination ? shortenMiddle(props.destination, 8, 6) : null,
      mono: true,
      title: props.destination ?? undefined,
    },
    { term: "You send", value: amount, mono: true },
    { term: "Destination receives", value: amount, mono: true },
    { term: "Fee", value: `None. Herald pays the gas on ${props.chain.label}.` },
    {
      term: "You approve",
      value: "One NEAR transaction to the MPC signer: 1 yoctoNEAR plus NEAR gas.",
    },
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border p-4">
      {rows.map(({ term, value, mono, title }) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className={cn("min-w-0 truncate", mono && value && "font-mono")} title={title}>
            {value ?? <span className="text-muted-foreground">Not set</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const statusBadges = {
  planned: { label: "Not signed", variant: "outline" },
  awaiting_signature: { label: "Awaiting signature", variant: "secondary" },
  submitted: { label: "Submitted", variant: "secondary" },
  confirmed: { label: "Confirmed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
} as const satisfies Record<SweepStatus, { label: string; variant: string }>;

function SweepTable({ sweeps }: { sweeps: SweepEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Chain</TableHead>
          <TableHead className="text-right">USDC</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Transactions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sweeps.map((sweep) => {
          const badge = statusBadges[sweep.status];
          return (
            <TableRow key={sweep.id}>
              <TableCell>{formatUtc(sweep.createdAt)}</TableCell>
              <TableCell>
                <Badge variant="outline">{sweep.label}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatUsdc(sweep.amount)}
              </TableCell>
              <TableCell className="font-mono" title={sweep.destinationAddress}>
                {shortenMiddle(sweep.destinationAddress)}
              </TableCell>
              <TableCell>
                <div className="flex max-w-64 flex-col items-start gap-1">
                  <Badge variant={badge.variant}>
                    {sweep.status === "awaiting_signature" || sweep.status === "submitted" ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    {badge.label}
                  </Badge>
                  {sweep.error ? (
                    <span className="text-muted-foreground">{sweep.error}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <TxLink label="NEAR" url={sweep.nearTxUrl} hash={sweep.nearTxHash} />
                  <TxLink label={sweep.label} url={sweep.sourceTxUrl} hash={sweep.sourceTxHash} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TxLink(props: { label: string; url: string | null; hash: string | null }) {
  if (!props.url || !props.hash) return null;
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono underline-offset-4 hover:underline"
      title={props.hash}
    >
      {props.label} {shortenMiddle(props.hash, 6, 4)}
      <ExternalLinkIcon aria-hidden className="size-3.5" />
      <span className="sr-only">(opens the block explorer)</span>
    </a>
  );
}
