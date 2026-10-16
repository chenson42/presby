import { GIVE_PAGE } from "@/lib/giving/giving-copy";

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : null;
}

/**
 * "Questions, or want to give another way? Call <phone>." - the one line a
 * donor gets when something is wrong or they would rather not pay online.
 * The phone is the congregation's PUBLIC profile phone (already on its website);
 * without one the line says to contact the church. Hook-free, so the client
 * give form, the unavailable notice and the live slot all use it.
 */
export function ContactLine({ phone }: { phone: string | null | undefined }) {
  const tel = phone ? telHref(phone) : null;
  return (
    <p className="text-sm text-muted-foreground">
      {phone ? (
        <>
          {GIVE_PAGE.contactPrefix}{" "}
          {tel ? (
            <a
              href={tel}
              className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {phone}
            </a>
          ) : (
            phone
          )}
          .
        </>
      ) : (
        GIVE_PAGE.contactGeneric
      )}
    </p>
  );
}
