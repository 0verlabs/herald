import type { ReactNode } from "react";
import { CardContent, CardFooter } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";

/**
 * The withdrawal card's body: the fields on the left (the coin and network
 * picker first), what will happen on the right, the action below.
 */
export function WithdrawLayout(props: {
  picker: ReactNode;
  fields?: ReactNode;
  summary: ReactNode;
  messages?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <CardContent className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <FieldGroup>
            {props.picker}
            {props.fields}
          </FieldGroup>
          {props.messages}
        </div>
        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">{props.summary}</div>
      </CardContent>
      {props.footer ? (
        <CardFooter className="flex justify-end gap-2">{props.footer}</CardFooter>
      ) : null}
    </>
  );
}
