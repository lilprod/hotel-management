import type { Locale } from './locale.js';

/** Who receives the message: a guest (communications log) or a user (in-app / preferences). */
export type TemplateAudience = 'guest' | 'user' | 'tenant_owner';

export interface LocaleContent {
  subject: string;
  title: string;
  paragraphs: string[];
  /** Call to action: the button is shown only when the `url` variable is a valid URL. */
  cta?: { label: string; url: string };
  /** Plain-text variant for SMS / WhatsApp / in-app body (no HTML, short). */
  sms: string;
}

export interface DefaultTemplateDef {
  code: string;
  audience: TemplateAudience;
  /** Mandatory messages ignore notification preferences (security, billing). */
  mandatory: boolean;
  /** Whitelist of variables a template (default or tenant override) may reference. */
  variables: readonly string[];
  content: Record<Locale, LocaleContent>;
}

const G = ['guestName', 'hotelName', 'hotelPhone'] as const;
const O = ['ownerName', 'hotelName'] as const;

/**
 * Default templates (doc 08 EX-65, doc 03 §5 jobs). `money`/`date` helpers format amounts and
 * dates; nothing country-specific is hard-coded (amounts carry their own currency).
 */
export const DEFAULT_TEMPLATES: readonly DefaultTemplateDef[] = [
  {
    code: 'booking_confirmation',
    audience: 'guest',
    mandatory: false,
    variables: [
      ...G,
      'reference',
      'checkIn',
      'checkOut',
      'nights',
      'guests',
      'roomType',
      'total',
      'portalUrl',
    ],
    content: {
      fr: {
        subject: 'Confirmation de votre réservation {{reference}} - {{hotelName}}',
        title: 'Votre réservation est confirmée',
        paragraphs: [
          'Bonjour {{guestName}},',
          'Nous avons le plaisir de confirmer votre séjour à {{hotelName}} : arrivée le {{date checkIn}}, départ le {{date checkOut}} ({{nights}} nuit(s)).',
          'Référence : {{reference}}. Chambre : {{roomType}}. Montant du séjour : {{money total}}.',
          'Pour toute question, appelez-nous au {{hotelPhone}}.',
        ],
        cta: { label: 'Gérer ma réservation', url: 'portalUrl' },
        sms: '{{hotelName}} : reservation {{reference}} confirmee du {{date checkIn}} au {{date checkOut}}. Info : {{hotelPhone}}',
      },
      en: {
        subject: 'Your booking {{reference}} is confirmed - {{hotelName}}',
        title: 'Your booking is confirmed',
        paragraphs: [
          'Hello {{guestName}},',
          'We are pleased to confirm your stay at {{hotelName}}: check-in on {{date checkIn}}, check-out on {{date checkOut}} ({{nights}} night(s)).',
          'Reference: {{reference}}. Room: {{roomType}}. Stay total: {{money total}}.',
          'For any question, call us on {{hotelPhone}}.',
        ],
        cta: { label: 'Manage my booking', url: 'portalUrl' },
        sms: '{{hotelName}}: booking {{reference}} confirmed, {{date checkIn}} to {{date checkOut}}. Info: {{hotelPhone}}',
      },
    },
  },
  {
    code: 'booking_reminder',
    audience: 'guest',
    mandatory: false,
    variables: [...G, 'reference', 'checkIn', 'checkInTime', 'portalUrl'],
    content: {
      fr: {
        subject: 'Rappel : votre arrivée le {{date checkIn}} - {{hotelName}}',
        title: 'Votre séjour approche',
        paragraphs: [
          'Bonjour {{guestName}},',
          'Nous vous attendons le {{date checkIn}} à partir de {{checkInTime}} à {{hotelName}} (réservation {{reference}}).',
          'Une question ? Contactez-nous au {{hotelPhone}}.',
        ],
        cta: { label: 'Voir ma réservation', url: 'portalUrl' },
        sms: '{{hotelName}} : rappel, arrivee le {{date checkIn}} des {{checkInTime}} (ref {{reference}}). Info : {{hotelPhone}}',
      },
      en: {
        subject: 'Reminder: your arrival on {{date checkIn}} - {{hotelName}}',
        title: 'Your stay is coming up',
        paragraphs: [
          'Hello {{guestName}},',
          'We look forward to welcoming you on {{date checkIn}} from {{checkInTime}} at {{hotelName}} (booking {{reference}}).',
          'Any question? Contact us on {{hotelPhone}}.',
        ],
        cta: { label: 'View my booking', url: 'portalUrl' },
        sms: '{{hotelName}}: reminder, arrival on {{date checkIn}} from {{checkInTime}} (ref {{reference}}). Info: {{hotelPhone}}',
      },
    },
  },
  {
    code: 'pre_arrival',
    audience: 'guest',
    mandatory: false,
    variables: [...G, 'checkIn', 'checkInTime', 'address', 'preCheckinUrl'],
    content: {
      fr: {
        subject: 'Préparez votre arrivée à {{hotelName}}',
        title: 'Plus que quelques jours',
        paragraphs: [
          'Bonjour {{guestName}},',
          'Votre arrivée à {{hotelName}} est prévue le {{date checkIn}} à partir de {{checkInTime}}. Adresse : {{address}}.',
          'Gagnez du temps à la réception en remplissant votre pré-enregistrement en ligne.',
        ],
        cta: { label: 'Pré-enregistrement', url: 'preCheckinUrl' },
        sms: '{{hotelName}} : arrivee le {{date checkIn}}. Pre-enregistrement : {{preCheckinUrl}}',
      },
      en: {
        subject: 'Get ready for your arrival at {{hotelName}}',
        title: 'Just a few days to go',
        paragraphs: [
          'Hello {{guestName}},',
          'You are expected at {{hotelName}} on {{date checkIn}} from {{checkInTime}}. Address: {{address}}.',
          'Save time at the front desk by completing your online pre-check-in.',
        ],
        cta: { label: 'Pre-check-in', url: 'preCheckinUrl' },
        sms: '{{hotelName}}: arrival on {{date checkIn}}. Pre-check-in: {{preCheckinUrl}}',
      },
    },
  },
  {
    code: 'welcome',
    audience: 'guest',
    mandatory: false,
    variables: [...G, 'roomNumber', 'checkOut'],
    content: {
      fr: {
        subject: 'Bienvenue à {{hotelName}}',
        title: 'Bienvenue, {{guestName}}',
        paragraphs: [
          'Nous sommes ravis de vous accueillir à {{hotelName}}. Votre chambre : {{roomNumber}}.',
          'Votre départ est prévu le {{date checkOut}}. La réception reste à votre disposition au {{hotelPhone}}.',
        ],
        sms: 'Bienvenue a {{hotelName}}, chambre {{roomNumber}}. Reception : {{hotelPhone}}',
      },
      en: {
        subject: 'Welcome to {{hotelName}}',
        title: 'Welcome, {{guestName}}',
        paragraphs: [
          'We are delighted to welcome you to {{hotelName}}. Your room: {{roomNumber}}.',
          'Your check-out is on {{date checkOut}}. The front desk is available on {{hotelPhone}}.',
        ],
        sms: 'Welcome to {{hotelName}}, room {{roomNumber}}. Front desk: {{hotelPhone}}',
      },
    },
  },
  {
    code: 'post_stay',
    audience: 'guest',
    mandatory: false,
    variables: [...G, 'checkOut', 'reviewUrl'],
    content: {
      fr: {
        subject: 'Merci de votre séjour à {{hotelName}}',
        title: 'Merci pour votre visite',
        paragraphs: [
          'Bonjour {{guestName}},',
          'Merci d’avoir séjourné à {{hotelName}} jusqu’au {{date checkOut}}. Votre avis nous aide à nous améliorer.',
        ],
        cta: { label: 'Donner mon avis', url: 'reviewUrl' },
        sms: 'Merci de votre sejour a {{hotelName}}. Votre avis : {{reviewUrl}}',
      },
      en: {
        subject: 'Thank you for staying at {{hotelName}}',
        title: 'Thank you for your visit',
        paragraphs: [
          'Hello {{guestName}},',
          'Thank you for staying at {{hotelName}} until {{date checkOut}}. Your feedback helps us improve.',
        ],
        cta: { label: 'Leave a review', url: 'reviewUrl' },
        sms: 'Thank you for staying at {{hotelName}}. Your feedback: {{reviewUrl}}',
      },
    },
  },
  {
    code: 'invoice_issued',
    audience: 'guest',
    mandatory: true,
    variables: [...G, 'invoiceNumber', 'total', 'dueDate', 'documentUrl'],
    content: {
      fr: {
        subject: 'Facture {{invoiceNumber}} - {{hotelName}}',
        title: 'Votre facture est disponible',
        paragraphs: [
          'Bonjour {{guestName}},',
          'La facture {{invoiceNumber}} d’un montant de {{money total}} a été émise par {{hotelName}}.',
          'Échéance : {{date dueDate}}.',
        ],
        cta: { label: 'Télécharger la facture', url: 'documentUrl' },
        sms: '{{hotelName}} : facture {{invoiceNumber}} de {{money total}}. {{documentUrl}}',
      },
      en: {
        subject: 'Invoice {{invoiceNumber}} - {{hotelName}}',
        title: 'Your invoice is available',
        paragraphs: [
          'Hello {{guestName}},',
          'Invoice {{invoiceNumber}} for {{money total}} has been issued by {{hotelName}}.',
          'Due date: {{date dueDate}}.',
        ],
        cta: { label: 'Download invoice', url: 'documentUrl' },
        sms: '{{hotelName}}: invoice {{invoiceNumber}} for {{money total}}. {{documentUrl}}',
      },
    },
  },
  {
    code: 'receipt_issued',
    audience: 'guest',
    mandatory: true,
    variables: [...G, 'receiptNumber', 'amount', 'method', 'documentUrl'],
    content: {
      fr: {
        subject: 'Reçu {{receiptNumber}} - {{hotelName}}',
        title: 'Merci pour votre paiement',
        paragraphs: [
          'Bonjour {{guestName}},',
          'Nous avons bien reçu votre paiement de {{money amount}} ({{method}}). Reçu n° {{receiptNumber}}.',
        ],
        cta: { label: 'Télécharger le reçu', url: 'documentUrl' },
        sms: '{{hotelName}} : paiement de {{money amount}} recu ({{method}}). Recu {{receiptNumber}}',
      },
      en: {
        subject: 'Receipt {{receiptNumber}} - {{hotelName}}',
        title: 'Thank you for your payment',
        paragraphs: [
          'Hello {{guestName}},',
          'We have received your payment of {{money amount}} ({{method}}). Receipt no. {{receiptNumber}}.',
        ],
        cta: { label: 'Download receipt', url: 'documentUrl' },
        sms: '{{hotelName}}: payment of {{money amount}} received ({{method}}). Receipt {{receiptNumber}}',
      },
    },
  },
  {
    code: 'password_reset',
    audience: 'user',
    mandatory: true,
    variables: ['userName', 'hotelName', 'resetUrl', 'expiresInMinutes'],
    content: {
      fr: {
        subject: 'Réinitialisation de votre mot de passe',
        title: 'Réinitialiser votre mot de passe',
        paragraphs: [
          'Bonjour {{userName}},',
          'Une réinitialisation du mot de passe de votre compte {{hotelName}} a été demandée. Ce lien expire dans {{expiresInMinutes}} minutes.',
          'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.',
        ],
        cta: { label: 'Choisir un nouveau mot de passe', url: 'resetUrl' },
        sms: '{{hotelName}} : reinitialisation du mot de passe : {{resetUrl}} (valide {{expiresInMinutes}} min)',
      },
      en: {
        subject: 'Reset your password',
        title: 'Reset your password',
        paragraphs: [
          'Hello {{userName}},',
          'A password reset was requested for your {{hotelName}} account. This link expires in {{expiresInMinutes}} minutes.',
          'If you did not request it, please ignore this message.',
        ],
        cta: { label: 'Choose a new password', url: 'resetUrl' },
        sms: '{{hotelName}}: password reset: {{resetUrl}} (valid {{expiresInMinutes}} min)',
      },
    },
  },
  {
    code: 'user_invitation',
    audience: 'user',
    mandatory: true,
    variables: ['inviteeName', 'inviterName', 'hotelName', 'roleName', 'inviteUrl', 'expiresInDays'],
    content: {
      fr: {
        subject: '{{inviterName}} vous invite à rejoindre {{hotelName}}',
        title: 'Vous êtes invité(e)',
        paragraphs: [
          'Bonjour {{inviteeName}},',
          '{{inviterName}} vous invite à rejoindre l’équipe de {{hotelName}} avec le rôle « {{roleName}} ». L’invitation est valable {{expiresInDays}} jours.',
        ],
        cta: { label: 'Accepter l’invitation', url: 'inviteUrl' },
        sms: '{{hotelName}} : invitation a rejoindre l’equipe : {{inviteUrl}}',
      },
      en: {
        subject: '{{inviterName}} invites you to join {{hotelName}}',
        title: 'You are invited',
        paragraphs: [
          'Hello {{inviteeName}},',
          '{{inviterName}} invites you to join the {{hotelName}} team as "{{roleName}}". The invitation is valid for {{expiresInDays}} days.',
        ],
        cta: { label: 'Accept invitation', url: 'inviteUrl' },
        sms: '{{hotelName}}: you are invited to join the team: {{inviteUrl}}',
      },
    },
  },
  {
    code: 'trial_ending',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'planName', 'trialEndDate', 'daysLeft', 'billingUrl'],
    content: {
      fr: {
        subject: 'Votre essai se termine dans {{daysLeft}} jour(s)',
        title: 'Votre période d’essai touche à sa fin',
        paragraphs: [
          'Bonjour {{ownerName}},',
          'L’essai de {{hotelName}} (formule {{planName}}) se termine le {{date trialEndDate}}, dans {{daysLeft}} jour(s).',
          'Choisissez votre moyen de paiement pour continuer sans interruption.',
        ],
        cta: { label: 'Gérer mon abonnement', url: 'billingUrl' },
        sms: 'Essai {{hotelName}} termine le {{date trialEndDate}}. Abonnement : {{billingUrl}}',
      },
      en: {
        subject: 'Your trial ends in {{daysLeft}} day(s)',
        title: 'Your trial is about to end',
        paragraphs: [
          'Hello {{ownerName}},',
          'The trial of {{hotelName}} ({{planName}} plan) ends on {{date trialEndDate}}, in {{daysLeft}} day(s).',
          'Choose your payment method to continue without interruption.',
        ],
        cta: { label: 'Manage my subscription', url: 'billingUrl' },
        sms: '{{hotelName}} trial ends on {{date trialEndDate}}. Subscription: {{billingUrl}}',
      },
    },
  },
  {
    code: 'invoice_upcoming',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'planName', 'amount', 'dueDate', 'billingUrl'],
    content: {
      fr: {
        subject: 'Prochaine facture : {{money amount}} le {{date dueDate}}',
        title: 'Votre prochaine facture',
        paragraphs: [
          'Bonjour {{ownerName}},',
          'La facture de {{hotelName}} (formule {{planName}}) d’un montant de {{money amount}} sera émise avec une échéance au {{date dueDate}}.',
        ],
        cta: { label: 'Voir la facturation', url: 'billingUrl' },
        sms: '{{hotelName}} : prochaine facture {{money amount}} au {{date dueDate}}',
      },
      en: {
        subject: 'Upcoming invoice: {{money amount}} on {{date dueDate}}',
        title: 'Your upcoming invoice',
        paragraphs: [
          'Hello {{ownerName}},',
          'The invoice for {{hotelName}} ({{planName}} plan) of {{money amount}} will be issued, due on {{date dueDate}}.',
        ],
        cta: { label: 'View billing', url: 'billingUrl' },
        sms: '{{hotelName}}: upcoming invoice {{money amount}} due {{date dueDate}}',
      },
    },
  },
  {
    code: 'invoice_due',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'invoiceNumber', 'amount', 'dueDate', 'paymentInstructions', 'billingUrl'],
    content: {
      fr: {
        subject: 'Facture {{invoiceNumber}} à régler le {{date dueDate}}',
        title: 'Une facture est à régler',
        paragraphs: [
          'Bonjour {{ownerName}},',
          'La facture {{invoiceNumber}} de {{hotelName}} ({{money amount}}) arrive à échéance le {{date dueDate}}.',
          '{{paymentInstructions}}',
        ],
        cta: { label: 'Payer ma facture', url: 'billingUrl' },
        sms: '{{hotelName}} : facture {{invoiceNumber}} de {{money amount}} a regler avant le {{date dueDate}}',
      },
      en: {
        subject: 'Invoice {{invoiceNumber}} due on {{date dueDate}}',
        title: 'An invoice is due',
        paragraphs: [
          'Hello {{ownerName}},',
          'Invoice {{invoiceNumber}} for {{hotelName}} ({{money amount}}) is due on {{date dueDate}}.',
          '{{paymentInstructions}}',
        ],
        cta: { label: 'Pay my invoice', url: 'billingUrl' },
        sms: '{{hotelName}}: invoice {{invoiceNumber}} of {{money amount}} due by {{date dueDate}}',
      },
    },
  },
  {
    code: 'invoice_overdue',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [
      ...O,
      'invoiceNumber',
      'amount',
      'dueDate',
      'daysOverdue',
      'suspensionDate',
      'billingUrl',
    ],
    content: {
      fr: {
        subject: 'Facture {{invoiceNumber}} en retard de {{daysOverdue}} jour(s)',
        title: 'Paiement en retard',
        paragraphs: [
          'Bonjour {{ownerName}},',
          'La facture {{invoiceNumber}} de {{hotelName}} ({{money amount}}), échue le {{date dueDate}}, n’est pas réglée.',
          'Sans paiement, le compte sera suspendu le {{date suspensionDate}}.',
        ],
        cta: { label: 'Régulariser maintenant', url: 'billingUrl' },
        sms: '{{hotelName}} : facture {{invoiceNumber}} impayee, suspension le {{date suspensionDate}}. {{billingUrl}}',
      },
      en: {
        subject: 'Invoice {{invoiceNumber}} is {{daysOverdue}} day(s) overdue',
        title: 'Payment overdue',
        paragraphs: [
          'Hello {{ownerName}},',
          'Invoice {{invoiceNumber}} for {{hotelName}} ({{money amount}}), due on {{date dueDate}}, is unpaid.',
          'Without payment, the account will be suspended on {{date suspensionDate}}.',
        ],
        cta: { label: 'Settle now', url: 'billingUrl' },
        sms: '{{hotelName}}: invoice {{invoiceNumber}} unpaid, suspension on {{date suspensionDate}}. {{billingUrl}}',
      },
    },
  },
  {
    code: 'account_suspended',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'amountDue', 'supportEmail', 'billingUrl'],
    content: {
      fr: {
        subject: 'Compte {{hotelName}} suspendu',
        title: 'Votre compte est suspendu',
        paragraphs: [
          'Bonjour {{ownerName}},',
          'Le compte de {{hotelName}} est suspendu faute de paiement ({{money amountDue}} dus). Vos données sont conservées.',
          'Dès le règlement reçu, l’accès est rétabli. Support : {{supportEmail}}.',
        ],
        cta: { label: 'Régler et réactiver', url: 'billingUrl' },
        sms: 'Compte {{hotelName}} suspendu (impaye {{money amountDue}}). {{billingUrl}}',
      },
      en: {
        subject: '{{hotelName}} account suspended',
        title: 'Your account is suspended',
        paragraphs: [
          'Hello {{ownerName}},',
          'The {{hotelName}} account is suspended due to non-payment ({{money amountDue}} due). Your data is kept safe.',
          'Access is restored as soon as payment is received. Support: {{supportEmail}}.',
        ],
        cta: { label: 'Pay and reactivate', url: 'billingUrl' },
        sms: '{{hotelName}} account suspended ({{money amountDue}} unpaid). {{billingUrl}}',
      },
    },
  },
  {
    code: 'payment_receipt_platform',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'receiptNumber', 'amount', 'method', 'paidAt', 'documentUrl'],
    content: {
      fr: {
        subject: 'Reçu de paiement {{receiptNumber}}',
        title: 'Paiement reçu',
        paragraphs: [
          'Bonjour {{ownerName}},',
          'Nous avons reçu le paiement de {{money amount}} ({{method}}) pour {{hotelName}} le {{date paidAt}}. Reçu n° {{receiptNumber}}.',
        ],
        cta: { label: 'Télécharger le reçu', url: 'documentUrl' },
        sms: '{{hotelName}} : paiement {{money amount}} recu le {{date paidAt}}. Recu {{receiptNumber}}',
      },
      en: {
        subject: 'Payment receipt {{receiptNumber}}',
        title: 'Payment received',
        paragraphs: [
          'Hello {{ownerName}},',
          'We received your payment of {{money amount}} ({{method}}) for {{hotelName}} on {{date paidAt}}. Receipt no. {{receiptNumber}}.',
        ],
        cta: { label: 'Download receipt', url: 'documentUrl' },
        sms: '{{hotelName}}: payment {{money amount}} received on {{date paidAt}}. Receipt {{receiptNumber}}',
      },
    },
  },
];
