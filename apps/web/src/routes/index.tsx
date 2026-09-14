import { createFileRoute, Link } from "@tanstack/react-router";
import { ThemeToggle } from "@spaceobject/ui/components/theme-toggle";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6 sm:px-10 sm:py-8">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link className="font-serif text-xl font-semibold tracking-tight" to="/">
          Herald
        </Link>
        <ThemeToggle />
      </header>

      <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="mb-5 font-mono text-xs tracking-[0.22em] text-muted-foreground uppercase">
            Agentic commerce infrastructure
          </p>
          <h1 className="max-w-3xl font-serif text-5xl leading-[0.98] font-medium tracking-[-0.045em] text-balance sm:text-7xl">
            One identity.
            <br />
            Every chain.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground"></p>
        </div>

        <dl className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/10">
          {[
            ["Address", "0x7E57D004F4C4A3F10D82cA14cE9b31AEdBcD2488"],
            ["Agent Id", "8453:4021"],
            ["Hash", "0xb4fc91e1…a2c80d73"],
          ].map(([label, value]) => (
            <div className="border-b border-border p-5 last:border-b-0" key={label}>
              <dt className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {label}
              </dt>
              <dd className="m-0 overflow-hidden font-mono text-sm text-ellipsis">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="flex items-center justify-between border-t border-border pt-6 text-sm text-muted-foreground">
        <span>ERC-8004 identity</span>
        <span className="font-mono">spaceobject.ai</span>
      </footer>
    </main>
  );
}
