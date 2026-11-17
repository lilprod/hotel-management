/** Shared `errors` i18n namespace (RFC 7807 `code` and `meta.reason` → message). */
const fr = {
  generic: 'Une erreur est survenue. Réessayez dans un instant.',
  network: 'Le serveur est injoignable. Vérifiez votre connexion.',
  status: {
    '401': 'Identifiants invalides ou session expirée.',
    '403': "Vous n'avez pas le droit d'effectuer cette action.",
    '404': 'Élément introuvable.',
    '409': 'Cette opération entre en conflit avec une donnée existante.',
    '422': 'Certaines informations sont invalides.',
    '429': 'Trop de tentatives. Patientez avant de réessayer.',
  },
  code: {
    VALIDATION_ERROR: 'Certaines informations sont invalides.',
    UNAUTHENTICATED: 'Identifiants invalides ou session expirée.',
    FORBIDDEN: "Vous n'avez pas le droit d'effectuer cette action.",
    TENANT_MISMATCH: "Ce jeton n'appartient pas à cet établissement.",
    FEATURE_NOT_IN_PLAN: "Cette fonctionnalité n'est pas incluse dans votre abonnement.",
    QUOTA_EXCEEDED: 'Le quota de votre abonnement est atteint.',
    SUBSCRIPTION_SUSPENDED: 'Votre abonnement est suspendu.',
    NOT_FOUND: 'Élément introuvable.',
    CONFLICT: 'Cette opération entre en conflit avec une donnée existante.',
    RATE_LIMITED: 'Trop de tentatives. Patientez avant de réessayer.',
    MFA_REQUIRED: 'Une vérification en deux étapes est requise.',
    ACCOUNT_LOCKED: 'Compte temporairement verrouillé après trop de tentatives.',
    INTERNAL_ERROR: 'Erreur interne du serveur.',
    SERVICE_UNAVAILABLE: 'Service momentanément indisponible.',
  },
  reason: {
    LEGAL_ACCEPTANCE_REQUIRED:
      'Les conditions générales doivent être acceptées par le propriétaire.',
    IP_NOT_ALLOWED: "Votre adresse IP n'est pas autorisée pour cet établissement.",
    IMPERSONATION_RESTRICTED: 'Action interdite pendant une session de support.',
    PASSWORD_CHANGE_REQUIRED: 'Vous devez changer votre mot de passe.',
    IMPERSONATION_NOT_ALLOWED: "Cet établissement n'autorise pas l'accès support.",
    ALREADY_ENDED: 'Cette session est déjà terminée.',
  },
};

const en: typeof fr = {
  generic: 'Something went wrong. Please try again shortly.',
  network: 'The server is unreachable. Check your connection.',
  status: {
    '401': 'Invalid credentials or expired session.',
    '403': 'You are not allowed to perform this action.',
    '404': 'Not found.',
    '409': 'This operation conflicts with existing data.',
    '422': 'Some of the information is invalid.',
    '429': 'Too many attempts. Please wait before trying again.',
  },
  code: {
    VALIDATION_ERROR: 'Some of the information is invalid.',
    UNAUTHENTICATED: 'Invalid credentials or expired session.',
    FORBIDDEN: 'You are not allowed to perform this action.',
    TENANT_MISMATCH: 'This token does not belong to this property.',
    FEATURE_NOT_IN_PLAN: 'This feature is not included in your subscription.',
    QUOTA_EXCEEDED: 'Your subscription quota has been reached.',
    SUBSCRIPTION_SUSPENDED: 'Your subscription is suspended.',
    NOT_FOUND: 'Not found.',
    CONFLICT: 'This operation conflicts with existing data.',
    RATE_LIMITED: 'Too many attempts. Please wait before trying again.',
    MFA_REQUIRED: 'Two-step verification is required.',
    ACCOUNT_LOCKED: 'Account temporarily locked after too many attempts.',
    INTERNAL_ERROR: 'Internal server error.',
    SERVICE_UNAVAILABLE: 'Service temporarily unavailable.',
  },
  reason: {
    LEGAL_ACCEPTANCE_REQUIRED: 'The latest terms must be accepted by the account owner.',
    IP_NOT_ALLOWED: 'Your IP address is not allowed for this property.',
    IMPERSONATION_RESTRICTED: 'This action is not allowed during a support session.',
    PASSWORD_CHANGE_REQUIRED: 'You must change your password first.',
    IMPERSONATION_NOT_ALLOWED: 'This property does not allow support access.',
    ALREADY_ENDED: 'This session has already ended.',
  },
};

export const errorMessages = { fr, en } as const;
