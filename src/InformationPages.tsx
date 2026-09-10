import React from 'react';

type InformationKind = 'privacy' | 'terms' | 'refunds' | 'help';

const supportEmail = 'girisatya584@gmail.com';

export function InformationPage({ kind, onBack }: { kind: InformationKind; onBack: () => void }) {
  const titles: Record<InformationKind, string> = { privacy: 'Privacy Policy', terms: 'Terms & Conditions', refunds: 'Refund & Cancellation', help: 'Help' };
  return <section className="information-screen">
    <div className="information-header"><button className="information-back" onClick={onBack}>Back</button><h2>{titles[kind]}</h2></div>
    <div className="information-content">
      {kind === 'privacy' && <Privacy />}
      {kind === 'terms' && <Terms />}
      {kind === 'refunds' && <Refunds />}
      {kind === 'help' && <Help />}
    </div>
  </section>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="information-section"><h3>{title}</h3>{children}</section>; }
function Bullets({ items }: { items: string[] }) { return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>; }
function Contact() { return <p>Questions or feedback? Contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>; }

function Privacy() {
  return <>
    <p className="information-lead">Surface helps you remember people, notes, PINs, photos, captures, follow-ups, and the context around them.</p>
    <Section title="1. What Surface is"><p>Surface is designed to save information on your device first. This helps normal use stay fast and lets supported features continue when the internet is unavailable.</p></Section>
    <Section title="2. Information you provide"><p>You may choose to enter or capture:</p><Bullets items={['Your name, username, email address, and phone number.', 'PIN and contact information about people you save.', 'Notes, photos, captures, and follow-up information.', 'Location when you allow a location-based feature to use it.']} /><p>Surface does not independently verify information you enter.</p></Section>
    <Section title="3. Your account"><p>Surface uses Firebase Authentication for account sign-in and session handling. Account records can include your account identifier, email, phone, name or username, and subscription entitlement.</p></Section>
    <Section title="4. Data saved on your device"><p>Local-first information may be lost if app or browser data is cleared, the device is lost or damaged, local storage is removed, or the app is uninstalled without a backup. Local-only data cannot be promised to be recoverable.</p></Section>
    <Section title="5. Cloud data and subscriptions"><p>Free use is primarily local. Pro currently supports Basic Cloud for eligible Notes and PIN information. Max supports broader cloud backup for supported information and media through the available account and storage services. Cloud availability can depend on sign-in, permissions, network access, and the current product implementation.</p></Section>
    <Section title="6. Photos and media"><p>You choose which photos to capture or import. Surface may keep local copies for app features. Max cloud media backup uploads supported media when that feature is enabled and available. Surface does not claim ownership of your photos.</p></Section>
    <Section title="7. Location"><p>Location permission is optional. Where available, Surface uses it for geotag and context features. Camera use should continue in a reduced form without location. Surface does not use location for continuous tracking unless a future feature clearly says so.</p></Section>
    <Section title="8. Permissions"><p>Surface may ask for Camera, Photos or media, Location, and Notifications permissions. These permissions support the matching features and can generally be changed in device or browser settings.</p></Section>
    <Section title="9. Payments"><p>Subscription payments use Cashfree hosted checkout. Surface does not directly store full card or UPI credentials. Cashfree processes payment details under its own terms and privacy practices. Surface and its backend receive the order and payment status needed to verify and activate a subscription.</p></Section>
    <Section title="10. Service providers"><p>Depending on the feature, Surface uses Firebase Authentication, Firestore, Firebase Storage, its Surface payment backend, and Cashfree. These services process only what is needed for the feature in use.</p></Section>
    <Section title="11. Security"><p>Surface uses reasonable controls such as authentication, access rules, and server-authoritative paid entitlement. No internet-connected system can promise absolute security.</p></Section>
    <Section title="12. Account deletion"><p>Account deletion is available from Account where enabled and may require recent sign-in. User-owned cloud data and the Firebase account are deleted through the approved account process. Payment, security, accounting, legal, or audit records may be retained where reasonably necessary. Deleting a cloud account does not automatically erase local device data.</p></Section>
    <Section title="13. Children"><p>Surface is not intentionally designed as a children's service.</p></Section>
    <Section title="14. Changes"><p>This policy may be updated when Surface functionality changes.</p><p>Last updated: September 10, 2026.</p></Section>
    <Section title="15. Contact"><Contact /></Section>
  </>;
}

function Terms() {
  return <>
    <p className="information-lead">Using Surface means using the app, account, and related services under these terms.</p>
    <Section title="What these terms cover"><p>Surface is a productivity and context tool. It helps you organize information you choose to save. It does not guarantee sales, income, prospect conversion, business results, or professional financial or business advice.</p></Section>
    <Section title="Your responsibility"><p>You are responsible for the information you enter and for using it lawfully. Obtain permission where legally or ethically necessary before storing another person's details or photo. Keep your account credentials private and keep submitted information accurate.</p></Section>
    <Section title="Acceptable use"><p>Do not use Surface to break the law, harass or impersonate people, distribute malware or unlawful material, attempt unauthorized access, or abuse Surface or its supporting services.</p></Section>
    <Section title="Accounts"><p>One person controls an account. Keep your login details secure. Surface may require verification or recent sign-in for sensitive actions.</p></Section>
    <Section title="Local data and backups"><p>Information saved only on a device can be lost if that device or its local app/browser data is lost. Eligible cloud-backed information may restore after sign-in, but Surface does not promise recovery of every local or media item.</p></Section>
    <Section title="Subscriptions and payments"><p>Free, Pro, and Max features may differ. Subscription durations use the checkout offering shown before payment. Cashfree hosted checkout processes payment, and paid functionality activates only after confirmed server-side payment. Features and availability may evolve.</p><p>Surface currently sells fixed periods. Purchases do not automatically renew unless the checkout clearly states otherwise.</p></Section>
    <Section title="Feature availability"><p>Some features need an internet connection or permission. Android, iOS, and browser versions may differ because of their platform capabilities and external services.</p></Section>
    <Section title="Suspension and termination"><p>Surface may restrict access where reasonably necessary to address abuse, security threats, fraud, unlawful use, or payment manipulation.</p></Section>
    <Section title="Account deletion"><p>You may request deletion through Account where available. Deletion can remove the account and user-owned cloud data. Local data is handled separately, and records needed for payment, security, accounting, legal, or audit purposes may be retained.</p></Section>
    <Section title="Ownership"><p>Surface software, branding, and the app belong to their owner or licensors. You keep ownership and responsibility for content you create or upload. Using Surface does not transfer ownership of your content.</p></Section>
    <Section title="Availability and limitations"><p>Surface aims to be reliable but cannot guarantee uninterrupted service. Use reasonable backups for information that matters to you. Nothing here removes rights you may have under applicable law.</p></Section>
    <Section title="Changes and contact"><p>These terms may be updated as Surface changes.</p><Contact /></Section>
  </>;
}

function Refunds() {
  return <>
    <p className="information-lead">This policy explains what to do before and after a Surface subscription payment.</p>
    <Section title="Before payment"><p>Before hosted checkout, review the selected plan, duration, and total price.</p></Section>
    <Section title="Failed or pending payments"><p>If payment was not successfully captured, Surface should not activate a paid subscription. A bank or payment-provider transaction may take time to settle or reverse.</p></Section>
    <Section title="Payment succeeded but access is missing"><p>Do not immediately pay again. Wait briefly, reopen Surface, and check the subscription status. If access is still missing, contact Help with the order or payment reference.</p></Section>
    <Section title="Duplicate payment"><p>If the same intended subscription appears to have been charged more than once, contact Help for a review of the duplicate transaction.</p></Section>
    <Section title="Technical failure"><p>If a payment is verified but Surface cannot provide the purchased entitlement because of a Surface-side technical failure that cannot reasonably be corrected, you may request refund review.</p></Section>
    <Section title="Change of mind"><p>After a subscription has been activated and made available, payment is generally not refundable only because you change your mind or stop using Surface, except where applicable law requires otherwise.</p></Section>
    <Section title="Incorrect plan or duration"><p>Contact Help promptly before making another purchase. Do not assume a plan can be converted automatically.</p></Section>
    <Section title="Refund processing"><p>Approved refunds are returned through the applicable payment-provider process. Timing can depend on the payment method, provider, and bank.</p></Section>
    <Section title="Cancellation"><p>Surface currently sells fixed 30-day periods rather than conventional auto-renewing monthly subscriptions. There is no future billing to cancel unless the checkout explicitly says otherwise. Cancelling does not retroactively cancel an already-used entitlement.</p></Section>
    <Section title="How to request help"><Contact /><p>Include the payment or order reference, but never send passwords, one-time codes, card numbers, UPI PINs, or secret credentials.</p></Section>
    <Section title="Your legal rights"><p>Nothing in this policy removes rights that a consumer may have under applicable law.</p></Section>
  </>;
}

function Help() {
  return <>
    <p className="information-lead">Surface helps you save the details around people you meet, then find those details when you need them.</p>
    <Section title="Home"><p>Use Gallery for imported photos, Notes for written information, Camera for a quick capture, and PINs for a person or contact. Create Note or Create PIN from the places where those actions are shown.</p><p>Free Home controls are Camera, Notes, and Captures. Pro and Max controls are Camera, Search, and Captures.</p></Section>
    <Section title="PINs"><p>A PIN is one place for a person's Name, Phone, About information, location, notes, and connected captures. Create a PIN, edit it later, add a follow-up, connect a photo, or delete it from its actions.</p></Section>
    <Section title="Notes"><p>Create a note, add its details, edit it, attach a camera capture, or turn it into a PIN. Notes save locally first. Delete a note from its menu; connected PIN behavior is explained before deletion.</p></Section>
    <Section title="Camera"><p>Allow Camera when asked, then capture or select an image. Location is optional. You can Save, Create PIN, or Connect Existing. On a browser, the available camera and photo controls depend on the device and browser.</p></Section>
    <Section title="Gallery"><p>Gallery contains imported images. Tap an image to open it, zoom or move it, browse where supported, save it to the device, or delete it after confirmation. Some images include date and location context.</p></Section>
    <Section title="Captures"><p>Captures are photos taken through Surface and kept with their capture context. Open one to browse it, save it, create a PIN, connect it to an existing PIN, or delete it after confirmation.</p></Section>
    <Section title="Search"><p>Search is available to Pro and Max users where enabled. It searches saved PIN and Note information such as names, phone numbers, written details, and location labels.</p></Section>
    <Section title="Follow-ups and reminders"><p>A follow-up records who needs your attention and when. Notifications may require permission. Device or browser settings can prevent delivery, so do not rely on a reminder as your only record.</p></Section>
    <Section title="Account"><p>Account contains your name, username, email, and phone number. It also provides change password, password reset, sign out, and account deletion. Account deletion may require recent sign-in and is separate from local data on the device.</p></Section>
    <Section title="Subscriptions"><p>Free, Pro, and Max are shown in Surface Pro. Paid plans use 30-day periods and the quantity selector shown there. Cashfree hosted checkout handles payment; Surface activates paid access only after confirmed payment.</p></Section>
    <Section title="Offline use"><p>Surface saves supported information on your device first. This helps it remain fast and lets many features continue when the internet is unavailable. Cloud sync and payment need a connection.</p></Section>
    <Section title="Cloud"><p>Pro supports Basic Cloud for eligible Notes and PIN information. Max supports broader cloud backup for supported information and media when available. Sign in to restore eligible cloud-backed data; local-only data may not move to another phone.</p></Section>
    <Section title="Permissions"><Bullets items={['Camera: take a photo. If declined, camera capture is unavailable.', 'Photos or media: choose and save images. If declined, import or save may be limited.', 'Location: add geotag context. If declined, the photo can still work without it.', 'Notifications: receive reminders. If declined, in-app follow-up information remains available.']} /></Section>
    <Section title="If payment has a problem"><ol><li>Do not pay repeatedly.</li><li>Wait briefly and reopen Surface Pro.</li><li>Check whether the payment is reflected.</li><li>Contact Help with the order reference if confirmed payment is missing.</li></ol></Section>
    <Section title="If Surface is not working"><ol><li>Close and reopen Surface.</li><li>Check your connection if the feature needs cloud access.</li><li>Check the relevant permission.</li><li>Update Surface.</li><li>Contact Help or Feedback.</li></ol></Section>
    <Section title="Privacy"><p>Surface is local-first, but eligible cloud and payment features can send the information needed to provide those services. Read the <a href="#privacy">Privacy Policy</a> for details.</p></Section>
    <Section title="Still need help?"><Contact /></Section>
  </>;
}
