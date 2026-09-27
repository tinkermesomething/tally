export function Footer() {
  // A git tag ("v1.1.0") already includes the "v" - strip it so the fixed
  // "v" below never doubles up, regardless of whether the source value
  // happens to carry one (a release tag does, the "dev" fallback doesn't).
  const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
  const version = rawVersion.replace(/^v/i, "");

  return (
    <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground">
      Tally · v{version}
    </footer>
  );
}
