import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { TRIAL_DAYS } from "@/lib/pricing";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms that govern your use of ${BRAND}.`,
};

// NOTE FOR THE FOUNDER: every [BRACKETED] placeholder below must be filled in
// (and the document reviewed by a solicitor) before GA. The structure is an
// honest, GDPR-era template - not legal advice.

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="[DATE - set when finalised]">
      <p>
        These terms are an agreement between you and{" "}
        <strong>[COMPANY DETAILS: legal name, company number, registered address]</strong> (“
        {BRAND}”, “we”), the operator of the {BRAND} expense-tracking service (the “Service”).
        By creating an account you agree to them.
      </p>

      <h2>1. The Service</h2>
      <p>
        {BRAND} lets sole traders and small businesses capture receipts, record expenses and
        income, compute tax-related summaries (such as capital-allowance schedules and VAT
        positions), and share records with an accountant they authorise. We provide software,
        not accountancy: <strong>nothing in the Service is professional tax, legal or financial
        advice</strong>. Figures are computed from the data you enter and the rules described in
        the product; you and your accountant remain responsible for your tax returns.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>You must provide accurate information and keep your password secure.</li>
        <li>
          You are responsible for activity under your account. Organisation owners control who
          they invite (team members, or an accountant&apos;s read access) and can revoke that
          access at any time.
        </li>
        <li>
          Accountancy practices access a client&apos;s records only through an active link the
          client&apos;s signup created; revoking the link ends that access.
        </li>
      </ul>

      <h2>3. Trials, subscriptions and billing</h2>
      <ul>
        <li>New accounts include a {TRIAL_DAYS}-day free trial of the full product.</li>
        <li>
          After the trial, paid plans are billed monthly through Stripe at a flat price per
          organisation. Accountancy practices are free once approved; each of their clients holds
          their own account and subscribes directly.
        </li>
        <li>
          If a subscription lapses your account becomes <strong>read-only</strong>: everything you
          entered stays visible and exportable, but new records can&apos;t be added until you
          subscribe. We do not delete your data for non-payment.
        </li>
        <li>You can cancel any time via the billing portal; access runs to the end of the paid period.</li>
      </ul>

      <h2>4. Your data</h2>
      <p>
        Your records and receipt images are yours. You can export them at any time, and you can
        ask us to permanently delete your account and all its data (see the{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
        ). You grant us only the licence needed to store and process that data to run the
        Service.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        Don&apos;t misuse the Service: no unlawful content, no attempts to access other users&apos;
        data, no probing or disrupting the infrastructure, no reselling without our agreement. We
        may suspend accounts that break these rules.
      </p>

      <h2>6. Availability and changes</h2>
      <p>
        We aim for high availability but the Service is provided “as is” without warranties of
        uninterrupted operation. We may improve or change features; if a change materially
        reduces the Service you pay for, we&apos;ll tell you in advance.
      </p>

      <h2>7. Liability</h2>
      <p>
        To the extent permitted by law, our total liability for claims arising from the Service
        is limited to the amounts you paid us in the 12 months before the claim. We are not
        liable for indirect losses, or for tax outcomes based on figures you or your accountant
        derived from the Service. Nothing limits liability that cannot lawfully be limited.
      </p>

      <h2>8. Ending the agreement</h2>
      <p>
        You may close your account at any time. We may terminate with notice for material breach
        of these terms. On closure you can request an export and/or deletion of your data;
        statutory retention duties (e.g. our own accounting records) survive.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These terms are governed by the laws of Ireland and the Irish courts have jurisdiction.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these terms: <strong>[CONTACT EMAIL]</strong>.
      </p>
    </LegalShell>
  );
}
