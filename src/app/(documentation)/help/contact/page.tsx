import { HELP_CONTACT_FORM_COPY as COPY, HELP_CONTACT_EXIT_COPY as EXIT } from "@/lib/help-contact/copy";
import { isHelpContactConfigured } from "@/lib/help-contact/configured";
import { ContactForm } from "./contact-form";
import { ContactExit, ContactUnavailable } from "./contact-exit";

// Static and session-free (R3), like every help page: any auth(), headers(), cookies() or
// searchParams fails `next build`. The page decides ONE thing at build, whether the form can run
// at all (`isHelpContactConfigured`); the client island and the action carry everything dynamic.
// The action re-checks at request time, so the page and the action agree by construction
// (DECISION-303). No loading.tsx and no error.tsx under this segment (R9, amended).
export const dynamic = "error";

export const metadata = {
  title: COPY.title,
  description: COPY.intro1,
  openGraph: { title: COPY.title, description: COPY.intro1 },
};

export default function HelpContactPage() {
  const configured = isHelpContactConfigured(process.env);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{COPY.title}</h1>
        {configured ? (
          <>
            <p className="text-base leading-7">{COPY.intro1}</p>
            <p className="text-base leading-7">{COPY.intro2}</p>
          </>
        ) : null}
      </header>
      {configured ? (
        <>
          <ContactForm />
          <noscript>
            <section className="space-y-3 rounded-lg border border-border p-4" data-testid="contact-noscript">
              <p className="text-base leading-7">{EXIT.noScript}</p>
              <ContactExit />
            </section>
          </noscript>
        </>
      ) : (
        <ContactUnavailable />
      )}
    </div>
  );
}
