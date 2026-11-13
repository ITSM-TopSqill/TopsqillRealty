import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms, payments and refunds", description: "The rules for using Topsqill.ai, the ad wallet, and refunds." };

export default function Terms() {
  return (
    <LegalPage title="Terms, payments and refunds" updated="13 November 2026">
      <h2>Using Topsqill.ai</h2>
      <ul>
        <li>Post only properties you own or are authorised to market, with true details, real photos you have the right to use, and a valid RERA number where the law requires one.</li>
        <li>No misleading prices, fake listings, spam, or contact details in places meant for property information.</li>
        <li>Our team reviews listings and ad campaigns and may decline, edit or remove anything that breaks these rules or the law.</li>
      </ul>
      <h2>Ad campaigns</h2>
      <ul>
        <li>When you run ads through Topsqill, we place them on Topsqill&apos;s own Meta (Facebook, Instagram) and Google accounts on your behalf, using your listing and the ad text you approve.</li>
        <li>Each campaign is reviewed before it goes live. Meta and Google may also decline or limit ads under their own policies.</li>
        <li>Results such as reach, clicks and leads depend on the platforms and the market; forecasts are estimates, not guarantees.</li>
      </ul>
      <h2>The ad wallet</h2>
      <ul>
        <li>You add money to a prepaid wallet through Razorpay. GST is charged on each top-up and shown on your invoice.</li>
        <li>When you send a campaign for review, its budget (plus any service fee shown before you confirm) is set aside from your wallet.</li>
        <li>You are charged only for what the ads actually spend, plus that fee. Spend is updated every few hours.</li>
        <li>Unspent money returns to your wallet when a campaign ends, is taken back before review, or isn&apos;t approved. Platforms can report the last spend up to three days late; that amount is then taken from your wallet.</li>
      </ul>
      <h2>Refunds</h2>
      <ul>
        <li>You can ask for unused wallet money to be refunded at any time by messaging the Topsqill team from your account. Refunds go back to the original payment method, usually within 7 working days of approval.</li>
        <li>Money already spent on ads that ran can&apos;t be refunded.</li>
        <li>If a payment was taken but didn&apos;t reach your wallet, it is added automatically within a few minutes; if not, contact us with the payment reference and we will fix it.</li>
      </ul>
      <h2>Liability</h2>
      <p>Topsqill connects people; deals are between buyers, sellers and agents. Check every property, its papers and its seller yourself before paying anything.</p>
    </LegalPage>
  );
}
