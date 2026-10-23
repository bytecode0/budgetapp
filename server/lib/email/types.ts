// Transport-layer types. Transports know nothing about templates: they receive a
// fully rendered message and a sender, and either deliver it or throw.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/** The parsed EMAIL_FROM. Each transport formats it the way its API expects. */
export interface Sender {
  address: string;
  name?: string;
}

export interface EmailTransport {
  /** The EMAIL_PROVIDER value that selects this transport. */
  name: string;
  /**
   * Delivers the message or throws. Error messages never contain recipient
   * addresses, tokens or API keys.
   */
  send(msg: EmailMessage, from: Sender): Promise<{ id?: string }>;
}
