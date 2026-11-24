import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDesktopMode } from "@/lib/desktop/mode";
import { GUIDE, type Block } from "@/lib/help/guide";
import { HELP } from "@/lib/help/content";

export const metadata = { title: "Help · Tally" };

function BlockView({ block }: { block: Block }) {
  if ("p" in block) return <p className="text-sm leading-relaxed text-muted-foreground">{block.p}</p>;
  if ("steps" in block)
    return (
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-foreground">
        {block.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    );
  if ("bullets" in block)
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
        {block.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    );
  if ("code" in block)
    return <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-foreground">{block.code}</pre>;
  if ("tip" in block) {
    const { title, tip } = HELP[block.tip];
    return (
      <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{title}. </span>
        {tip}
      </p>
    );
  }
  return (
    <Link href="/grid?tour=1" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}>
      Take the tour
    </Link>
  );
}

export default function HelpPage() {
  const desktop = isDesktopMode();
  const sections = GUIDE.filter((s) => !s.only || (s.only === "desktop") === desktop);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Help</h1>
        <p className="text-sm text-muted-foreground">How Tally works. Click a section to jump to it.</p>
      </div>

      <nav aria-label="Help contents" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-primary hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-20 space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{s.title}</h2>
          {s.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </section>
      ))}
    </div>
  );
}
