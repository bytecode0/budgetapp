import { Resend } from "resend";

// Created on first send, not at import: the Resend constructor throws without
// RESEND_API_KEY, and the modules that send email are loaded by the whole app
// at startup — a missing key must break sending email, not every route.
let client: Resend | null = null;

export const resend = {
  get emails() {
    client ??= new Resend(process.env.RESEND_API_KEY);
    return client.emails;
  },
};
