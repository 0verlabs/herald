import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** One numbered step of connecting an API, with a rail joining it to the next. */
export function SetupStep(props: {
  number: number;
  title: string;
  description: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-4 sm:gap-5">
      <div className="flex flex-col items-center">
        <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground ring-4 ring-background">
          {props.number}
        </span>
        {props.last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <Card className={props.last ? undefined : "mb-6"}>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{props.children}</CardContent>
      </Card>
    </li>
  );
}
