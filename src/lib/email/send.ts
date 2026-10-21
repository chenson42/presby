import "server-only";

import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const fromDefault =
  process.env.RESEND_FROM_EMAIL ?? "PresbyPortal <noreply@example.com>";

const client = apiKey ? new Resend(apiKey) : null;

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

export async function sendEmail(input: SendEmailInput) {
  if (!client) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set in production");
    }
    console.warn("[email] RESEND_API_KEY missing — logging instead of sending");
    console.warn(
      `[email] to=${input.to} subject=${input.subject} htmlLen=${input.html.length} textLen=${input.text?.length ?? 0}`,
    );
    return { id: "dev-noop" };
  }
  const res = await client.emails.send({
    from: input.from ?? fromDefault,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.replyTo,
  });
  if (res.error) throw new Error(res.error.message);
  return { id: res.data?.id ?? "" };
}
