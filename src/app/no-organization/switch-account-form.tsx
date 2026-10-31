import { switchAccountAction } from "./actions";
import { NO_ORG_COPY } from "@/lib/onboarding/no-organization-copy";

/**
 * "Sign in with a different account": a plain `<form action>` over the server
 * action, so it works before hydration (a native POST) and needs no client
 * state. Styled as a link, with a 44px target.
 */
export function SwitchAccountForm() {
  return (
    <form action={switchAccountAction}>
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {NO_ORG_COPY.buttons.switchAccount}
      </button>
    </form>
  );
}
