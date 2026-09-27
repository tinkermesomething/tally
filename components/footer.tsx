export function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

  return (
    <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground">
      Tally · v{version}
    </footer>
  );
}
