import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${BRAND} collects, uses and protects your data.`,
};

// NOTE FOR THE FOUNDER: fill every [BRACKETED] placeholder (controller
// identity, hosting provider, contact address) and have it reviewed before
// GA. Keep the processors table in step with reality - it currently matches
// the code (GCS or local storage, Gmail SMTP, Stripe when enabled, Sentry
// when enabled).

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="[DATE - set when finalised]">
      <p>
        This policy explains how <strong>[COMPANY DETAILS: legal name, registered address]</strong>{" "}
        (“{BRAND}”, “we”), as data controller, handles personal data in the {BRAND} service. We
        keep it deliberately plain: we store what the product needs, we sell nothing, and we track
        nobody.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> - name, email address, password (stored only as a bcrypt
          hash), and any optional profile fields you fill in (address, occupation, and for tax
          exports, fields such as a PPS number if you choose to provide one).
        </li>
        <li>
          <strong>Your business records</strong> - expenses, income, asset-register entries, VAT
          status, and the <strong>receipt images</strong> you photograph. A receipt image can
          itself contain personal data; images are stored privately and served only via
          short-lived signed URLs to people your organisation authorised.
        </li>
        <li>
          <strong>Billing data</strong> - when paid subscriptions are enabled, Stripe processes
          your payment details; we store only Stripe&apos;s identifiers and your subscription
          status, never card numbers.
        </li>
        <li>
          <strong>Technical logs</strong> - server logs (request IDs, IP-derived rate-limit
          counters, timestamps) kept for security and debugging, and error reports if error
          monitoring is enabled.
        </li>
      </ul>

      <h2>2. Why we process it (legal bases)</h2>
      <ul>
        <li>Running the service you signed up for - contract (GDPR art. 6(1)(b)).</li>
        <li>Security, abuse prevention, service emails - legitimate interests (art. 6(1)(f)).</li>
        <li>Billing and tax-record duties of our own - legal obligation (art. 6(1)(c)).</li>
      </ul>
      <p>We do not use your data for advertising and we do not sell it.</p>

      <h2>3. Who processes it for us</h2>
      <table>
        <thead>
          <tr>
            <th>Processor</th>
            <th>Purpose</th>
            <th>Location / notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>[HOSTING PROVIDER]</td>
            <td>Application hosting and database</td>
            <td>[REGION - choose EU]</td>
          </tr>
          <tr>
            <td>Google Cloud Storage</td>
            <td>Private receipt-image storage</td>
            <td>[BUCKET REGION - choose EU]</td>
          </tr>
          <tr>
            <td>Google (Gmail SMTP)</td>
            <td>Transactional email (invites, resets, verification)</td>
            <td>EU/US - Data Privacy Framework</td>
          </tr>
          <tr>
            <td>Stripe</td>
            <td>Subscription payments (when billing is enabled)</td>
            <td>Stripe Payments Europe</td>
          </tr>
          <tr>
            <td>Sentry (optional)</td>
            <td>Error monitoring (when enabled)</td>
            <td>[REGION - EU data residency available]</td>
          </tr>
        </tbody>
      </table>
      <p>
        Your accountant (or, for practices, your client) sees data only through the access links
        you or they explicitly created inside the product - that is a sharing choice you control,
        not a processor relationship.
      </p>

      <h2>4. How long we keep it</h2>
      <p>
        Your records are kept for as long as your account is active - they are your books. Bear
        in mind that <strong>Irish Revenue requires business records to be kept for 6 years</strong>,
        so export before deleting anything you still need. When you delete your account (or ask
        us to), we hard-delete your organisation&apos;s rows and stored receipt images; residual
        copies age out of encrypted backups on the backup schedule. Our own invoicing records are
        kept as tax law requires.
      </p>

      <h2>5. Your rights</h2>
      <p>
        Under GDPR you can access, correct, export, restrict, object to processing of, or erase
        your personal data. Most of this is self-service: profile edits and exports are in the
        app, and account deletion performs a genuine hard-delete including images. For anything
        else contact <strong>[CONTACT EMAIL]</strong>. If you&apos;re unhappy with our answer you
        can complain to the Irish Data Protection Commission (dataprotection.ie).
      </p>

      <h2>6. Cookies</h2>
      <p>
        {BRAND} sets <strong>essential cookies only</strong>: an httpOnly session cookie that keeps
        you signed in. No analytics cookies, no advertising cookies, no third-party trackers -
        which is why there is no cookie banner.
      </p>

      <h2>7. Security</h2>
      <p>
        Passwords are hashed (bcrypt), receipt images are private with short-lived signed URLs,
        access is organisation-scoped and role-checked on every request, credential endpoints are
        rate-limited, and transport is TLS. No system is perfectly secure; if a breach affects
        your data we will notify you and the DPC as GDPR requires.
      </p>

      <h2>8. Changes</h2>
      <p>
        If we change this policy materially we&apos;ll notify you in the app or by email before
        the change takes effect. See also our{" "}
        <Link href="/terms" className="underline underline-offset-2">
          Terms of Service
        </Link>
        .
      </p>
    </LegalShell>
  );
}
