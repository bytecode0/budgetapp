// One file per email; each is a pure function (data, locale) => { subject, html, text }.
// To add an email: add a file here, its strings to locales/es.ts and en.ts, a
// sample in ../samples.ts, and a thin sender in mailer.ts or subscriptionEmails.ts.
export { verificationEmail, type VerificationData } from "./verification.js";
export { passwordResetEmail, type PasswordResetData } from "./passwordReset.js";
export { welcomeEmail, type WelcomeData } from "./welcome.js";
export { welcomeGoogleEmail, type WelcomeGoogleData } from "./welcomeGoogle.js";
export { partnerInviteEmail, type PartnerInviteData } from "./partnerInvite.js";
export { subscriptionActivatedEmail, type SubscriptionActivatedData } from "./subscriptionActivated.js";
export { subscriptionCancelledEmail, type SubscriptionCancelledData } from "./subscriptionCancelled.js";
export { paymentFailedEmail, type PaymentFailedData } from "./paymentFailed.js";
export { bankConsentExpiringEmail, type BankConsentExpiringData } from "./bankConsentExpiring.js";
