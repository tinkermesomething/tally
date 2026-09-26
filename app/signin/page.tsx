import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { PocketIdLogo } from "@/components/pocket-id-logo";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-xl">Tally</CardTitle>
          <CardDescription className="text-center">
            Sign in to see your budget.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              await signIn("pocket-id", { redirectTo: callbackUrl || "/grid" });
            }}
          >
            <Button type="submit" className="w-full gap-2">
              <PocketIdLogo className="size-5" />
              Sign in with Pocket ID
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
