import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy policy", description: "What Topsqill.ai collects, why, who sees it, and your choices." };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="13 November 2026">
      <p>Topsqill.ai is a real estate network for buyers, owners, dealers and builders. This page explains, in plain words, what we collect, why, who sees it, and the choices you have.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Your account:</b> name, mobile number or email, city, the kind of member you are, and anything you add to your profile.</li>
        <li><b>What you post:</b> listings, photos, videos, requirements, jobs, posts, comments and messages.</li>
        <li><b>Verification:</b> KYC and RERA documents you upload. These are stored privately and seen only by our review team.</li>
        <li><b>When you respond to an ad:</b> if you fill in a form on one of our Facebook, Instagram or Google ads, we receive the name, phone number, email and answers you entered in that form.</li>
        <li><b>Payments:</b> when you add money to an ad wallet, Razorpay processes the payment. We receive the amount and a payment reference, never your card, UPI or bank details.</li>
        <li><b>Usage:</b> pages viewed and actions taken, used to keep the service working and safe.</li>
      </ul>
      <h2>Why we use it</h2>
      <ul>
        <li>To run your account and show your listings, requirements and posts to other members.</li>
        <li>To match buyers with properties, and to pass an enquiry to the person who listed the property.</li>
        <li>To send you sign-in codes and alerts you can control in the app.</li>
        <li>To run advertising campaigns that members ask us to run, and to issue invoices.</li>
        <li>To prevent fraud, spam and misuse, and to meet legal obligations.</li>
      </ul>
      <h2>Who sees it</h2>
      <ul>
        <li><b>Other members</b> see what you publish (your profile, listings, posts). Your phone and email are shared with someone only when you contact them or respond to their listing or ad.</li>
        <li><b>The member who listed a property</b> receives your details when you enquire about it or fill in a form on its ad.</li>
        <li><b>Service providers</b> who run parts of Topsqill for us under contract: Google Cloud (hosting), Meta and Google (ads), Razorpay (payments), email and messaging providers, and AI providers that help write text. They may use the data only to provide their service to us.</li>
        <li><b>Authorities</b>, when the law requires it.</li>
      </ul>
      <p>We do not sell your personal data.</p>
      <h2>How long we keep it</h2>
      <p>For as long as your account is open, and afterwards only as long as the law requires (for example, invoices). Leads from ads stay with the member who received them until they delete them.</p>
      <h2>Your choices</h2>
      <ul>
        <li>See and change your details from your profile, and switch alerts on or off.</li>
        <li>Delete posts, listings and messages you created.</li>
        <li>Ask us for a copy of your data, to correct it, or to delete your account, by messaging the Topsqill team from your account.</li>
      </ul>
      <h2>Security</h2>
      <p>Data is encrypted in transit, documents are stored privately, and access is limited to people who need it. No system is perfectly secure; if something goes wrong that affects you, we will tell you.</p>
      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we&apos;ll let you know in the app before it takes effect.</p>
    </LegalPage>
  );
}
