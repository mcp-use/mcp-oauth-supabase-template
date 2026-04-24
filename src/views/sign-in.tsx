import { buttonVariants } from "../components/ui/button.js";
import { Icons } from "../components/ui/icons.js";
import { cn } from "../lib/utils.js";
import { Layout } from "./layout.js";

interface SignInProps {
  /**
   * Map from provider id (e.g. "google", "github") to the href the button
   * navigates to when clicked. The server builds these from the current
   * authorization_id so the OAuth flow can resume after sign-in.
   */
  providerHrefs: {
    google: string;
    github: string;
  };
  errorMessage?: string;
}

export function SignIn({ providerHrefs, errorMessage }: SignInProps) {
  const linkClass = cn(
    buttonVariants({ variant: "outline", size: "lg" }),
    "w-full",
  );

  return (
    <Layout title="Sign In">
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="mx-auto w-full max-w-[400px] space-y-8">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-medium tracking-tight">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground">
              Authorize the MCP client to access your account.
            </p>
          </div>

          <div className="space-y-3">
            <a href={providerHrefs.google} className={linkClass}>
              <Icons.google className="h-4 w-4" />
              Continue with Google
            </a>
            <a href={providerHrefs.github} className={linkClass}>
              <Icons.github className="h-4 w-4" />
              Continue with GitHub
            </a>
          </div>

          {errorMessage ? (
            <p className="text-center text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </main>
    </Layout>
  );
}
