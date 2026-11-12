import { SweepMinimumEditSchema, USDC_DECIMALS } from "@herald/core";
import type { SweepMinimumListing } from "@herald/core/server";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { CoinAmount } from "@/components/money/amount";
import { NetworkName } from "@/components/money/network-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { baseUnitsToDecimal, formatUtc } from "@/lib/format";
import { USDC } from "@/lib/stablecoins";
import { editSweepMinimum } from "@/server/admin";

/** The smallest withdrawal (Sweep minimum) on each network, each editable. */
export function MinimumTable({ minimums }: { minimums: SweepMinimumListing[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Network</TableHead>
          <TableHead className="text-right">Smallest withdrawal</TableHead>
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
            <TableCell>
              <NetworkName label={minimum.label} />
            </TableCell>
            <TableCell className="text-right">
              <CoinAmount
                baseUnits={minimum.minimum}
                decimals={USDC.decimals}
                symbol={USDC.symbol}
              />
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
            <DialogTitle>Smallest withdrawal on {minimum.label}</DialogTitle>
            <DialogDescription>
              Nobody can withdraw less than this from {minimum.label}, so fees and the bridge's own
              minimum never eat the money. Withdrawals already prepared keep the old figure.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={problems.minimum ? true : undefined}>
              <FieldLabel htmlFor="minimum-amount">Smallest withdrawal (USDC)</FieldLabel>
              <Input
                id="minimum-amount"
                inputMode="decimal"
                autoComplete="off"
                className="amount"
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
              Save minimum
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
