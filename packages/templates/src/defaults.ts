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

const G = ['guest.firstName', 'guest.lastName', 'hotel.name', 'hotel.phone'] as const;
const O = ['owner.name', 'hotel.name'] as const;

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
      'reservation.number',
      'reservation.checkIn',
      'reservation.checkOut',
      'reservation.nights',
      'reservation.guests',
      'reservation.roomType',
      'reservation.total',
      'portal.url',
    ],
    content: {
      fr: {
        subject: 'Confirmation de votre réservation {{reservation.number}} - {{hotel.name}}',
        title: 'Votre réservation est confirmée',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Nous avons le plaisir de confirmer votre séjour à {{hotel.name}} : arrivée le {{date reservation.checkIn}}, départ le {{date reservation.checkOut}} ({{reservation.nights}} nuit(s)).',
          'Référence : {{reservation.number}}. Chambre : {{reservation.roomType}}. Montant du séjour : {{money reservation.total}}.',
          'Pour toute question, appelez-nous au {{hotel.phone}}.',
        ],
        cta: { label: 'Gérer ma réservation', url: 'portal.url' },
        sms: '{{hotel.name}} : reservation {{reservation.number}} confirmee du {{date reservation.checkIn}} au {{date reservation.checkOut}}. Info : {{hotel.phone}}',
      },
      en: {
        subject: 'Your booking {{reservation.number}} is confirmed - {{hotel.name}}',
        title: 'Your booking is confirmed',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'We are pleased to confirm your stay at {{hotel.name}}: check-in on {{date reservation.checkIn}}, check-out on {{date reservation.checkOut}} ({{reservation.nights}} night(s)).',
          'Reference: {{reservation.number}}. Room: {{reservation.roomType}}. Stay total: {{money reservation.total}}.',
          'For any question, call us on {{hotel.phone}}.',
        ],
        cta: { label: 'Manage my booking', url: 'portal.url' },
        sms: '{{hotel.name}}: booking {{reservation.number}} confirmed, {{date reservation.checkIn}} to {{date reservation.checkOut}}. Info: {{hotel.phone}}',
      },
    },
  },
  {
    code: 'booking_reminder',
    audience: 'guest',
    mandatory: false,
    variables: [
      ...G,
      'reservation.number',
      'reservation.checkIn',
      'reservation.checkInTime',
      'portal.url',
    ],
    content: {
      fr: {
        subject: 'Rappel : votre arrivée le {{date reservation.checkIn}} - {{hotel.name}}',
        title: 'Votre séjour approche',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Nous vous attendons le {{date reservation.checkIn}} à partir de {{reservation.checkInTime}} à {{hotel.name}} (réservation {{reservation.number}}).',
          'Une question ? Contactez-nous au {{hotel.phone}}.',
        ],
        cta: { label: 'Voir ma réservation', url: 'portal.url' },
        sms: '{{hotel.name}} : rappel, arrivee le {{date reservation.checkIn}} des {{reservation.checkInTime}} (ref {{reservation.number}}). Info : {{hotel.phone}}',
      },
      en: {
        subject: 'Reminder: your arrival on {{date reservation.checkIn}} - {{hotel.name}}',
        title: 'Your stay is coming up',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'We look forward to welcoming you on {{date reservation.checkIn}} from {{reservation.checkInTime}} at {{hotel.name}} (booking {{reservation.number}}).',
          'Any question? Contact us on {{hotel.phone}}.',
        ],
        cta: { label: 'View my booking', url: 'portal.url' },
        sms: '{{hotel.name}}: reminder, arrival on {{date reservation.checkIn}} from {{reservation.checkInTime}} (ref {{reservation.number}}). Info: {{hotel.phone}}',
      },
    },
  },
  {
    code: 'pre_arrival',
    audience: 'guest',
    mandatory: false,
    variables: [
      ...G,
      'reservation.checkIn',
      'reservation.checkInTime',
      'hotel.address',
      'portal.preCheckinUrl',
    ],
    content: {
      fr: {
        subject: 'Préparez votre arrivée à {{hotel.name}}',
        title: 'Plus que quelques jours',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Votre arrivée à {{hotel.name}} est prévue le {{date reservation.checkIn}} à partir de {{reservation.checkInTime}}. Adresse : {{hotel.address}}.',
          'Gagnez du temps à la réception en remplissant votre pré-enregistrement en ligne.',
        ],
        cta: { label: 'Pré-enregistrement', url: 'portal.preCheckinUrl' },
        sms: '{{hotel.name}} : arrivee le {{date reservation.checkIn}}. Pre-enregistrement : {{portal.preCheckinUrl}}',
      },
      en: {
        subject: 'Get ready for your arrival at {{hotel.name}}',
        title: 'Just a few days to go',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'You are expected at {{hotel.name}} on {{date reservation.checkIn}} from {{reservation.checkInTime}}. Address: {{hotel.address}}.',
          'Save time at the front desk by completing your online pre-check-in.',
        ],
        cta: { label: 'Pre-check-in', url: 'portal.preCheckinUrl' },
        sms: '{{hotel.name}}: arrival on {{date reservation.checkIn}}. Pre-check-in: {{portal.preCheckinUrl}}',
      },
    },
  },
  {
    code: 'welcome',
    audience: 'guest',
    mandatory: false,
    variables: [...G, 'reservation.roomNumber', 'reservation.checkOut'],
    content: {
      fr: {
        subject: 'Bienvenue à {{hotel.name}}',
        title: 'Bienvenue, {{guest.firstName}}',
        paragraphs: [
          'Nous sommes ravis de vous accueillir à {{hotel.name}}. Votre chambre : {{reservation.roomNumber}}.',
          'Votre départ est prévu le {{date reservation.checkOut}}. La réception reste à votre disposition au {{hotel.phone}}.',
        ],
        sms: 'Bienvenue a {{hotel.name}}, chambre {{reservation.roomNumber}}. Reception : {{hotel.phone}}',
      },
      en: {
        subject: 'Welcome to {{hotel.name}}',
        title: 'Welcome, {{guest.firstName}}',
        paragraphs: [
          'We are delighted to welcome you to {{hotel.name}}. Your room: {{reservation.roomNumber}}.',
          'Your check-out is on {{date reservation.checkOut}}. The front desk is available on {{hotel.phone}}.',
        ],
        sms: 'Welcome to {{hotel.name}}, room {{reservation.roomNumber}}. Front desk: {{hotel.phone}}',
      },
    },
  },
  {
    code: 'post_stay',
    audience: 'guest',
    mandatory: false,
    variables: [...G, 'reservation.checkOut', 'review.url'],
    content: {
      fr: {
        subject: 'Merci de votre séjour à {{hotel.name}}',
        title: 'Merci pour votre visite',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Merci d’avoir séjourné à {{hotel.name}} jusqu’au {{date reservation.checkOut}}. Votre avis nous aide à nous améliorer.',
        ],
        cta: { label: 'Donner mon avis', url: 'review.url' },
        sms: 'Merci de votre sejour a {{hotel.name}}. Votre avis : {{review.url}}',
      },
      en: {
        subject: 'Thank you for staying at {{hotel.name}}',
        title: 'Thank you for your visit',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'Thank you for staying at {{hotel.name}} until {{date reservation.checkOut}}. Your feedback helps us improve.',
        ],
        cta: { label: 'Leave a review', url: 'review.url' },
        sms: 'Thank you for staying at {{hotel.name}}. Your feedback: {{review.url}}',
      },
    },
  },
  {
    code: 'invoice_issued',
    audience: 'guest',
    mandatory: true,
    variables: [...G, 'invoice.number', 'invoice.total', 'invoice.dueDate', 'document.url'],
    content: {
      fr: {
        subject: 'Facture {{invoice.number}} - {{hotel.name}}',
        title: 'Votre facture est disponible',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'La facture {{invoice.number}} d’un montant de {{money invoice.total}} a été émise par {{hotel.name}}.',
          'Échéance : {{date invoice.dueDate}}.',
        ],
        cta: { label: 'Télécharger la facture', url: 'document.url' },
        sms: '{{hotel.name}} : facture {{invoice.number}} de {{money invoice.total}}. {{document.url}}',
      },
      en: {
        subject: 'Invoice {{invoice.number}} - {{hotel.name}}',
        title: 'Your invoice is available',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'Invoice {{invoice.number}} for {{money invoice.total}} has been issued by {{hotel.name}}.',
          'Due date: {{date invoice.dueDate}}.',
        ],
        cta: { label: 'Download invoice', url: 'document.url' },
        sms: '{{hotel.name}}: invoice {{invoice.number}} for {{money invoice.total}}. {{document.url}}',
      },
    },
  },
  {
    code: 'receipt_issued',
    audience: 'guest',
    mandatory: true,
    variables: [...G, 'receipt.number', 'payment.amount', 'payment.method', 'document.url'],
    content: {
      fr: {
        subject: 'Reçu {{receipt.number}} - {{hotel.name}}',
        title: 'Merci pour votre paiement',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Nous avons bien reçu votre paiement de {{money payment.amount}} ({{payment.method}}). Reçu n° {{receipt.number}}.',
        ],
        cta: { label: 'Télécharger le reçu', url: 'document.url' },
        sms: '{{hotel.name}} : paiement de {{money payment.amount}} recu ({{payment.method}}). Recu {{receipt.number}}',
      },
      en: {
        subject: 'Receipt {{receipt.number}} - {{hotel.name}}',
        title: 'Thank you for your payment',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'We have received your payment of {{money payment.amount}} ({{payment.method}}). Receipt no. {{receipt.number}}.',
        ],
        cta: { label: 'Download receipt', url: 'document.url' },
        sms: '{{hotel.name}}: payment of {{money payment.amount}} received ({{payment.method}}). Receipt {{receipt.number}}',
      },
    },
  },
  {
    code: 'password_reset',
    audience: 'user',
    mandatory: true,
    variables: ['user.name', 'hotel.name', 'reset.url', 'reset.expiresInMinutes'],
    content: {
      fr: {
        subject: 'Réinitialisation de votre mot de passe',
        title: 'Réinitialiser votre mot de passe',
        paragraphs: [
          'Bonjour {{user.name}},',
          'Une réinitialisation du mot de passe de votre compte {{hotel.name}} a été demandée. Ce lien expire dans {{reset.expiresInMinutes}} minutes.',
          'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.',
        ],
        cta: { label: 'Choisir un nouveau mot de passe', url: 'reset.url' },
        sms: '{{hotel.name}} : reinitialisation du mot de passe : {{reset.url}} (valide {{reset.expiresInMinutes}} min)',
      },
      en: {
        subject: 'Reset your password',
        title: 'Reset your password',
        paragraphs: [
          'Hello {{user.name}},',
          'A password reset was requested for your {{hotel.name}} account. This link expires in {{reset.expiresInMinutes}} minutes.',
          'If you did not request it, please ignore this message.',
        ],
        cta: { label: 'Choose a new password', url: 'reset.url' },
        sms: '{{hotel.name}}: password reset: {{reset.url}} (valid {{reset.expiresInMinutes}} min)',
      },
    },
  },
  {
    code: 'user_invitation',
    audience: 'user',
    mandatory: true,
    variables: [
      'invitee.name',
      'inviter.name',
      'hotel.name',
      'invitation.role',
      'invitation.url',
      'invitation.expiresInDays',
    ],
    content: {
      fr: {
        subject: '{{inviter.name}} vous invite à rejoindre {{hotel.name}}',
        title: 'Vous êtes invité(e)',
        paragraphs: [
          'Bonjour {{invitee.name}},',
          '{{inviter.name}} vous invite à rejoindre l’équipe de {{hotel.name}} avec le rôle « {{invitation.role}} ». L’invitation est valable {{invitation.expiresInDays}} jours.',
        ],
        cta: { label: 'Accepter l’invitation', url: 'invitation.url' },
        sms: '{{hotel.name}} : invitation a rejoindre l’equipe : {{invitation.url}}',
      },
      en: {
        subject: '{{inviter.name}} invites you to join {{hotel.name}}',
        title: 'You are invited',
        paragraphs: [
          'Hello {{invitee.name}},',
          '{{inviter.name}} invites you to join the {{hotel.name}} team as "{{invitation.role}}". The invitation is valid for {{invitation.expiresInDays}} days.',
        ],
        cta: { label: 'Accept invitation', url: 'invitation.url' },
        sms: '{{hotel.name}}: you are invited to join the team: {{invitation.url}}',
      },
    },
  },
  {
    code: 'tenant_email_verification',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'verification.url', 'verification.expiresInHours'],
    content: {
      fr: {
        subject: 'Confirmez votre adresse e-mail pour activer {{hotel.name}}',
        title: 'Confirmez votre adresse e-mail',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'Merci d’avoir créé l’espace de {{hotel.name}}. Confirmez votre adresse e-mail pour activer votre compte et commencer la configuration. Ce lien est valable {{verification.expiresInHours}} heures.',
          'Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message.',
        ],
        cta: { label: 'Confirmer mon adresse e-mail', url: 'verification.url' },
        sms: '{{hotel.name}} : confirmez votre e-mail : {{verification.url}}',
      },
      en: {
        subject: 'Confirm your e-mail address to activate {{hotel.name}}',
        title: 'Confirm your e-mail address',
        paragraphs: [
          'Hello {{owner.name}},',
          'Thank you for creating the {{hotel.name}} workspace. Confirm your e-mail address to activate your account and start the setup. This link is valid for {{verification.expiresInHours}} hours.',
          'If you did not sign up, please ignore this message.',
        ],
        cta: { label: 'Confirm my e-mail address', url: 'verification.url' },
        sms: '{{hotel.name}}: confirm your e-mail: {{verification.url}}',
      },
    },
  },
  {
    code: 'tenant_welcome',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'login.url', 'subscription.planName', 'trial.endDate'],
    content: {
      fr: {
        subject: 'Bienvenue sur Hotel Management, {{hotel.name}} est prêt',
        title: 'Votre compte est activé',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'Votre adresse e-mail est confirmée : l’espace de {{hotel.name}} est prêt (formule {{subscription.planName}}, essai jusqu’au {{date trial.endDate}}).',
          'Connectez-vous pour suivre l’assistant de configuration : établissement, chambres, tarifs, taxes, équipe et image de marque.',
        ],
        cta: { label: 'Me connecter', url: 'login.url' },
        sms: '{{hotel.name}} : compte active. Connexion : {{login.url}}',
      },
      en: {
        subject: 'Welcome to Hotel Management, {{hotel.name}} is ready',
        title: 'Your account is active',
        paragraphs: [
          'Hello {{owner.name}},',
          'Your e-mail address is confirmed: the {{hotel.name}} workspace is ready ({{subscription.planName}} plan, trial until {{date trial.endDate}}).',
          'Log in to follow the setup wizard: property, rooms, rates, taxes, team and branding.',
        ],
        cta: { label: 'Log in', url: 'login.url' },
        sms: '{{hotel.name}}: account active. Log in: {{login.url}}',
      },
    },
  },
  {
    code: 'trial_ending',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'subscription.planName', 'trial.endDate', 'trial.daysLeft', 'billing.url'],
    content: {
      fr: {
        subject: 'Votre essai se termine dans {{trial.daysLeft}} jour(s)',
        title: 'Votre période d’essai touche à sa fin',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'L’essai de {{hotel.name}} (formule {{subscription.planName}}) se termine le {{date trial.endDate}}, dans {{trial.daysLeft}} jour(s).',
          'Choisissez votre moyen de paiement pour continuer sans interruption.',
        ],
        cta: { label: 'Gérer mon abonnement', url: 'billing.url' },
        sms: 'Essai {{hotel.name}} termine le {{date trial.endDate}}. Abonnement : {{billing.url}}',
      },
      en: {
        subject: 'Your trial ends in {{trial.daysLeft}} day(s)',
        title: 'Your trial is about to end',
        paragraphs: [
          'Hello {{owner.name}},',
          'The trial of {{hotel.name}} ({{subscription.planName}} plan) ends on {{date trial.endDate}}, in {{trial.daysLeft}} day(s).',
          'Choose your payment method to continue without interruption.',
        ],
        cta: { label: 'Manage my subscription', url: 'billing.url' },
        sms: '{{hotel.name}} trial ends on {{date trial.endDate}}. Subscription: {{billing.url}}',
      },
    },
  },
  {
    code: 'invoice_upcoming',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'subscription.planName', 'invoice.amount', 'invoice.dueDate', 'billing.url'],
    content: {
      fr: {
        subject: 'Prochaine facture : {{money invoice.amount}} le {{date invoice.dueDate}}',
        title: 'Votre prochaine facture',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'La facture de {{hotel.name}} (formule {{subscription.planName}}) d’un montant de {{money invoice.amount}} sera émise avec une échéance au {{date invoice.dueDate}}.',
        ],
        cta: { label: 'Voir la facturation', url: 'billing.url' },
        sms: '{{hotel.name}} : prochaine facture {{money invoice.amount}} au {{date invoice.dueDate}}',
      },
      en: {
        subject: 'Upcoming invoice: {{money invoice.amount}} on {{date invoice.dueDate}}',
        title: 'Your upcoming invoice',
        paragraphs: [
          'Hello {{owner.name}},',
          'The invoice for {{hotel.name}} ({{subscription.planName}} plan) of {{money invoice.amount}} will be issued, due on {{date invoice.dueDate}}.',
        ],
        cta: { label: 'View billing', url: 'billing.url' },
        sms: '{{hotel.name}}: upcoming invoice {{money invoice.amount}} due {{date invoice.dueDate}}',
      },
    },
  },
  {
    code: 'invoice_due',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [
      ...O,
      'invoice.number',
      'invoice.amount',
      'invoice.dueDate',
      'invoice.paymentInstructions',
      'billing.url',
    ],
    content: {
      fr: {
        subject: 'Facture {{invoice.number}} à régler le {{date invoice.dueDate}}',
        title: 'Une facture est à régler',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'La facture {{invoice.number}} de {{hotel.name}} ({{money invoice.amount}}) arrive à échéance le {{date invoice.dueDate}}.',
          '{{invoice.paymentInstructions}}',
        ],
        cta: { label: 'Payer ma facture', url: 'billing.url' },
        sms: '{{hotel.name}} : facture {{invoice.number}} de {{money invoice.amount}} a regler avant le {{date invoice.dueDate}}',
      },
      en: {
        subject: 'Invoice {{invoice.number}} due on {{date invoice.dueDate}}',
        title: 'An invoice is due',
        paragraphs: [
          'Hello {{owner.name}},',
          'Invoice {{invoice.number}} for {{hotel.name}} ({{money invoice.amount}}) is due on {{date invoice.dueDate}}.',
          '{{invoice.paymentInstructions}}',
        ],
        cta: { label: 'Pay my invoice', url: 'billing.url' },
        sms: '{{hotel.name}}: invoice {{invoice.number}} of {{money invoice.amount}} due by {{date invoice.dueDate}}',
      },
    },
  },
  {
    code: 'invoice_overdue',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [
      ...O,
      'invoice.number',
      'invoice.amount',
      'invoice.dueDate',
      'invoice.daysOverdue',
      'invoice.suspensionDate',
      'billing.url',
    ],
    content: {
      fr: {
        subject: 'Facture {{invoice.number}} en retard de {{invoice.daysOverdue}} jour(s)',
        title: 'Paiement en retard',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'La facture {{invoice.number}} de {{hotel.name}} ({{money invoice.amount}}), échue le {{date invoice.dueDate}}, n’est pas réglée.',
          'Sans paiement, le compte sera suspendu le {{date invoice.suspensionDate}}.',
        ],
        cta: { label: 'Régulariser maintenant', url: 'billing.url' },
        sms: '{{hotel.name}} : facture {{invoice.number}} impayee, suspension le {{date invoice.suspensionDate}}. {{billing.url}}',
      },
      en: {
        subject: 'Invoice {{invoice.number}} is {{invoice.daysOverdue}} day(s) overdue',
        title: 'Payment overdue',
        paragraphs: [
          'Hello {{owner.name}},',
          'Invoice {{invoice.number}} for {{hotel.name}} ({{money invoice.amount}}), due on {{date invoice.dueDate}}, is unpaid.',
          'Without payment, the account will be suspended on {{date invoice.suspensionDate}}.',
        ],
        cta: { label: 'Settle now', url: 'billing.url' },
        sms: '{{hotel.name}}: invoice {{invoice.number}} unpaid, suspension on {{date invoice.suspensionDate}}. {{billing.url}}',
      },
    },
  },
  {
    code: 'account_suspended',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'invoice.amountDue', 'hotel.supportEmail', 'billing.url'],
    content: {
      fr: {
        subject: 'Compte {{hotel.name}} suspendu',
        title: 'Votre compte est suspendu',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'Le compte de {{hotel.name}} est suspendu faute de paiement ({{money invoice.amountDue}} dus). Vos données sont conservées.',
          'Dès le règlement reçu, l’accès est rétabli. Support : {{hotel.supportEmail}}.',
        ],
        cta: { label: 'Régler et réactiver', url: 'billing.url' },
        sms: 'Compte {{hotel.name}} suspendu (impaye {{money invoice.amountDue}}). {{billing.url}}',
      },
      en: {
        subject: '{{hotel.name}} account suspended',
        title: 'Your account is suspended',
        paragraphs: [
          'Hello {{owner.name}},',
          'The {{hotel.name}} account is suspended due to non-payment ({{money invoice.amountDue}} due). Your data is kept safe.',
          'Access is restored as soon as payment is received. Support: {{hotel.supportEmail}}.',
        ],
        cta: { label: 'Pay and reactivate', url: 'billing.url' },
        sms: '{{hotel.name}} account suspended ({{money invoice.amountDue}} unpaid). {{billing.url}}',
      },
    },
  },
  {
    code: 'payment_receipt_platform',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [
      ...O,
      'receipt.number',
      'payment.amount',
      'payment.method',
      'payment.paidAt',
      'document.url',
    ],
    content: {
      fr: {
        subject: 'Reçu de paiement {{receipt.number}}',
        title: 'Paiement reçu',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'Nous avons reçu le paiement de {{money payment.amount}} ({{payment.method}}) pour {{hotel.name}} le {{date payment.paidAt}}. Reçu n° {{receipt.number}}.',
        ],
        cta: { label: 'Télécharger le reçu', url: 'document.url' },
        sms: '{{hotel.name}} : paiement {{money payment.amount}} recu le {{date payment.paidAt}}. Recu {{receipt.number}}',
      },
      en: {
        subject: 'Payment receipt {{receipt.number}}',
        title: 'Payment received',
        paragraphs: [
          'Hello {{owner.name}},',
          'We received your payment of {{money payment.amount}} ({{payment.method}}) for {{hotel.name}} on {{date payment.paidAt}}. Receipt no. {{receipt.number}}.',
        ],
        cta: { label: 'Download receipt', url: 'document.url' },
        sms: '{{hotel.name}}: payment {{money payment.amount}} received on {{date payment.paidAt}}. Receipt {{receipt.number}}',
      },
    },
  },
  {
    code: 'waitlist_offer',
    audience: 'guest',
    mandatory: false,
    variables: [
      ...G,
      'reservation.checkIn',
      'reservation.checkOut',
      'reservation.roomType',
      'offer.expiresAt',
    ],
    content: {
      fr: {
        subject: 'Une chambre s’est libérée à {{hotel.name}}',
        title: 'Une chambre est disponible pour vous',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Bonne nouvelle : une chambre ({{reservation.roomType}}) s’est libérée à {{hotel.name}} du {{date reservation.checkIn}} au {{date reservation.checkOut}}, comme vous l’aviez demandé.',
          'Cette proposition est réservée pour vous jusqu’au {{date offer.expiresAt}}. Contactez-nous au {{hotel.phone}} pour la confirmer avant cette date, passé ce délai elle sera proposée au client suivant.',
        ],
        sms: '{{hotel.name}} : une chambre {{reservation.roomType}} est libre du {{date reservation.checkIn}} au {{date reservation.checkOut}}. Offre valable jusqu au {{date offer.expiresAt}}. Appelez le {{hotel.phone}}',
      },
      en: {
        subject: 'A room has become available at {{hotel.name}}',
        title: 'A room is available for you',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'Good news: a room ({{reservation.roomType}}) has become available at {{hotel.name}} from {{date reservation.checkIn}} to {{date reservation.checkOut}}, as you requested.',
          'This offer is held for you until {{date offer.expiresAt}}. Call us on {{hotel.phone}} to confirm it before then, after which it will be offered to the next guest.',
        ],
        sms: '{{hotel.name}}: a {{reservation.roomType}} room is free from {{date reservation.checkIn}} to {{date reservation.checkOut}}. Offer valid until {{date offer.expiresAt}}. Call {{hotel.phone}}',
      },
    },
  },
  {
    code: 'reservation_cancelled',
    audience: 'guest',
    mandatory: false,
    variables: [
      ...G,
      'reservation.number',
      'reservation.checkIn',
      'reservation.checkOut',
      'reservation.roomType',
      'penalty.applies',
      'penalty.amount',
    ],
    content: {
      fr: {
        subject: 'Annulation de votre réservation {{reservation.number}} - {{hotel.name}}',
        title: 'Votre réservation est annulée',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Votre réservation {{reservation.number}} à {{hotel.name}} ({{reservation.roomType}}, du {{date reservation.checkIn}} au {{date reservation.checkOut}}) a bien été annulée.',
          '{{#if penalty.applies}}Conformément aux conditions d’annulation, des frais de {{money penalty.amount}} sont dus.{{else}}Aucun frais d’annulation ne vous est facturé.{{/if}}',
          'Pour toute question, appelez-nous au {{hotel.phone}}.',
        ],
        sms: '{{hotel.name}} : reservation {{reservation.number}} annulee. {{#if penalty.applies}}Frais d annulation : {{money penalty.amount}}.{{else}}Aucun frais.{{/if}} Info : {{hotel.phone}}',
      },
      en: {
        subject: 'Your booking {{reservation.number}} is cancelled - {{hotel.name}}',
        title: 'Your booking is cancelled',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'Your booking {{reservation.number}} at {{hotel.name}} ({{reservation.roomType}}, {{date reservation.checkIn}} to {{date reservation.checkOut}}) has been cancelled.',
          '{{#if penalty.applies}}As per the cancellation policy, a fee of {{money penalty.amount}} is due.{{else}}No cancellation fee is charged.{{/if}}',
          'For any question, call us on {{hotel.phone}}.',
        ],
        sms: '{{hotel.name}}: booking {{reservation.number}} cancelled. {{#if penalty.applies}}Cancellation fee: {{money penalty.amount}}.{{else}}No fee.{{/if}} Info: {{hotel.phone}}',
      },
    },
  },
  {
    code: 'guest_email_verification',
    audience: 'guest',
    mandatory: true,
    variables: ['guest.firstName', 'hotel.name', 'verification.url', 'verification.expiresInHours'],
    content: {
      fr: {
        subject: 'Confirmez votre adresse e-mail - {{hotel.name}}',
        title: 'Confirmez votre adresse e-mail',
        paragraphs: [
          'Bonjour {{guest.firstName}},',
          'Merci d’avoir créé votre compte client {{hotel.name}}. Confirmez votre adresse e-mail pour gérer vos réservations en ligne. Ce lien est valable {{verification.expiresInHours}} heures.',
          'Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message.',
        ],
        cta: { label: 'Confirmer mon adresse e-mail', url: 'verification.url' },
        sms: '{{hotel.name}} : confirmez votre e-mail : {{verification.url}}',
      },
      en: {
        subject: 'Confirm your e-mail address - {{hotel.name}}',
        title: 'Confirm your e-mail address',
        paragraphs: [
          'Hello {{guest.firstName}},',
          'Thank you for creating your {{hotel.name}} guest account. Confirm your e-mail address to manage your bookings online. This link is valid for {{verification.expiresInHours}} hours.',
          'If you did not sign up, please ignore this message.',
        ],
        cta: { label: 'Confirm my e-mail address', url: 'verification.url' },
        sms: '{{hotel.name}}: confirm your e-mail: {{verification.url}}',
      },
    },
  },
  {
    code: 'payment_declaration_rejected',
    audience: 'tenant_owner',
    mandatory: true,
    variables: [...O, 'declaration.amount', 'declaration.reason', 'billing.url'],
    content: {
      fr: {
        subject: 'Votre déclaration de paiement n’a pas pu être validée - {{hotel.name}}',
        title: 'Déclaration de paiement rejetée',
        paragraphs: [
          'Bonjour {{owner.name}},',
          'Nous n’avons pas pu valider votre déclaration de paiement de {{money declaration.amount}} pour {{hotel.name}}.',
          'Motif : {{declaration.reason}}',
          'Vous pouvez effectuer une nouvelle déclaration depuis votre espace abonnement.',
        ],
        cta: { label: 'Voir mon abonnement', url: 'billing.url' },
        sms: '{{hotel.name}} : votre declaration de paiement a ete rejetee. Motif : {{declaration.reason}}',
      },
      en: {
        subject: 'Your payment declaration could not be validated - {{hotel.name}}',
        title: 'Payment declaration rejected',
        paragraphs: [
          'Hello {{owner.name}},',
          'We could not validate your payment declaration of {{money declaration.amount}} for {{hotel.name}}.',
          'Reason: {{declaration.reason}}',
          'You can submit a new declaration from your subscription page.',
        ],
        cta: { label: 'View my subscription', url: 'billing.url' },
        sms: '{{hotel.name}}: your payment declaration was rejected. Reason: {{declaration.reason}}',
      },
    },
  },
  {
    code: 'night_audit_completed',
    audience: 'user',
    mandatory: false,
    variables: [
      'hotel.name',
      'audit.businessDate',
      'audit.occupancy',
      'audit.roomsSold',
      'audit.roomRevenue',
      'audit.totalRevenue',
      'audit.url',
    ],
    content: {
      fr: {
        subject: 'Clôture du {{date audit.businessDate}} - {{hotel.name}}',
        title: 'Audit de nuit terminé',
        paragraphs: [
          'La journée du {{date audit.businessDate}} est clôturée pour {{hotel.name}}.',
          'Taux d’occupation : {{audit.occupancy}} % ({{audit.roomsSold}} chambres vendues). CA hébergement : {{money audit.roomRevenue}}. CA total : {{money audit.totalRevenue}}.',
          'Le rapport du jour est disponible dans l’écran Audit de nuit.',
        ],
        cta: { label: 'Voir le rapport', url: 'audit.url' },
        sms: '{{hotel.name}} : journee du {{date audit.businessDate}} cloturee. TO {{audit.occupancy}} %, CA {{money audit.totalRevenue}}.',
      },
      en: {
        subject: 'Day closed {{date audit.businessDate}} - {{hotel.name}}',
        title: 'Night audit completed',
        paragraphs: [
          'The business day {{date audit.businessDate}} is closed for {{hotel.name}}.',
          'Occupancy: {{audit.occupancy}} % ({{audit.roomsSold}} rooms sold). Room revenue: {{money audit.roomRevenue}}. Total revenue: {{money audit.totalRevenue}}.',
          'The day report is available on the Night audit screen.',
        ],
        cta: { label: 'View report', url: 'audit.url' },
        sms: '{{hotel.name}}: day {{date audit.businessDate}} closed. Occupancy {{audit.occupancy}} %, revenue {{money audit.totalRevenue}}.',
      },
    },
  },
  {
    code: 'night_audit_blocked',
    audience: 'user',
    mandatory: true,
    variables: ['hotel.name', 'audit.businessDate', 'audit.reasons', 'audit.url'],
    content: {
      fr: {
        subject: 'Audit de nuit automatique bloqué - {{hotel.name}}',
        title: 'Audit de nuit à lancer manuellement',
        paragraphs: [
          'L’audit de nuit automatique du {{date audit.businessDate}} n’a pas pu être lancé pour {{hotel.name}}.',
          'Contrôles bloquants : {{audit.reasons}}',
          'Traitez ces points puis lancez l’audit depuis l’écran Audit de nuit.',
        ],
        cta: { label: 'Ouvrir l’audit de nuit', url: 'audit.url' },
        sms: '{{hotel.name}} : audit de nuit du {{date audit.businessDate}} bloque ({{audit.reasons}}).',
      },
      en: {
        subject: 'Automatic night audit blocked - {{hotel.name}}',
        title: 'Night audit to run manually',
        paragraphs: [
          'The automatic night audit of {{date audit.businessDate}} could not run for {{hotel.name}}.',
          'Blocking checks: {{audit.reasons}}',
          'Resolve them, then run the audit from the Night audit screen.',
        ],
        cta: { label: 'Open the night audit', url: 'audit.url' },
        sms: '{{hotel.name}}: night audit of {{date audit.businessDate}} blocked ({{audit.reasons}}).',
      },
    },
  },
];
