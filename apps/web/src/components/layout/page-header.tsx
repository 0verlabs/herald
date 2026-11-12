import type { ReactNode } from "react";

/** A page's title, what it is for in one or two sentences, and its main action. */
export function PageHeader(props: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl leading-tight font-semibold text-balance sm:text-[2.125rem]">
          {props.title}
        </h1>
        {props.description ? (
          <p className="text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
            {props.description}
          </p>
        ) : null}
      </div>
      {props.actions ? <div className="flex shrink-0 gap-2">{props.actions}</div> : null}
    </div>
  );
}
