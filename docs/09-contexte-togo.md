# 09 — Contexte pays : Togo (pays cible de la v1)

Décision : la v1 cible **uniquement le Togo**. L'architecture reste multi-pays (doc 08, X7 et X8), mais seuls les paramètres, connecteurs et mentions légales togolais sont livrés en v1. Les autres pays (Bénin, Côte d'Ivoire, Sénégal…) passent en P2.

> ⚠️ Les éléments marqués **[À CONFIRMER]** doivent être validés par un expert-comptable ou un juriste togolais, ou auprès de l'administration concernée (OTR, IPDCP, DGSN, CNSS), **avant la semaine 6**. Ils sont tous **paramétrables** : une erreur ne demande pas de redéveloppement.

## 1. Paramètres régionaux par défaut (seed `country = TG`)
| Élément | Valeur |
|---|---|
| Pays | Togo (`TG`) |
| Devise | Franc CFA BCEAO, **XOF**, 0 décimale ; format `1 250 000 FCFA` |
| Fuseau horaire | `Africa/Lome` (UTC+0, sans heure d'été) |
| Langue | Français (par défaut) ; anglais pour la clientèle touristique |
| Téléphone | Indicatif **+228**, numéros à 8 chiffres ; validation et normalisation E.164 |
| Formats | Date `JJ/MM/AAAA`, heure 24 h, séparateur de milliers : espace |
| Semaine | Commence le lundi |

## 2. Moyens de paiement locaux
| Code | Libellé affiché | Référence attendue |
|---|---|---|
| `MIXX` | **Mixx by Yas** (ex-T-Money, opérateur Yas/Togocom) | ID de transaction de l'opérateur (alphanumérique) |
| `MOOV_MONEY` | **Moov Money** (Moov Africa Togo, ex-Flooz) | ID de transaction de l'opérateur |
| `CASH` | Espèces | — (n° du reçu de caisse) |
| `CARD` | Carte bancaire (TPE) | N° du ticket TPE / autorisation |
| `BANK_TRANSFER` | Virement bancaire | Référence du virement |

- Le format de la référence est validé par une regex **paramétrable** par mode (aucun format n'est figé dans le code).
- Les numéros marchands Mixx et Moov de la plateforme et de chaque hôtel sont affichés dans les instructions de paiement (SA-39, TN-34).
- Futurs intégrateurs actifs au Togo (P2, EX-74) : CinetPay, FedaPay, PayDunya, Semoa **[À CONFIRMER : couverture Togo et frais]**.

## 3. Fiscalité
| Élément | Paramétrage v1 | Statut |
|---|---|---|
| **TVA** | Taux normal **18 %** (`tax_rules` TG) | Taux réduits ou exonérations éventuels **[À CONFIRMER]**, paramétrables |
| **Taxe de séjour / taxe hôtelière** | Règle paramétrable : fixe par personne et par nuit, fixe par nuit, ou % ; exonérations (enfants, résidents…) | Montant, assiette et collectivité bénéficiaire **[À CONFIRMER]** |
| Autres taxes éventuelles (taxe touristique, redevance…) | Ajoutables via `tax_rules` sans code | **[À CONFIRMER]** |
| **Facture normalisée / électronique** | Connecteur **`otr-togo`** derrière `FiscalInvoiceProvider` (EX-51) ; implémentation `none` par défaut | Spécifications techniques de l'OTR (API, certification, QR code, numéro fiscal, délais) **[À CONFIRMER]** → connecteur priorisé dès réception des spécifications |
| Comptabilité | Plan **SYSCOHADA révisé** (seed), export des journaux (EX-50) | Correspondance des comptes à valider avec le comptable |

### Mentions obligatoires sur les factures (gabarit par défaut, éditable)
Raison sociale, forme juridique, adresse, **NIF**, **RCCM**, régime fiscal, n° de facture séquentiel, date, identité du client (et NIF du client pour une entreprise), détail HT, TVA et TTC par taux, taxe de séjour séparée, mode de paiement, mentions de la facture normalisée lorsqu'elle est activée (numéro fiscal, QR code). **[À CONFIRMER : liste exhaustive OTR]**

## 4. Réglementation hôtelière
- **Fiche de police** (OP-21) : les champs par défaut sont nom, prénoms, date et lieu de naissance, nationalité, profession, domicile habituel, type et n° de pièce, date et lieu de délivrance, provenance, destination, motif du séjour, date d'arrivée et de départ prévue. Les champs exigés et la transmission éventuelle aux services de police (DGSN) sont **[À CONFIRMER]**. Le formulaire est paramétrable par les champs personnalisés (X5).
- **Registre des voyageurs** imprimable et exportable par période (OP-25).
- **Classement hôtelier** et licence d'exploitation : champs informatifs sur l'établissement.

## 5. Protection des données personnelles
- **Loi n° 2019-014 du 29 octobre 2019** relative à la protection des données à caractère personnel.
- Autorité de contrôle : **IPDCP** (Instance de Protection des Données à Caractère Personnel) **[À CONFIRMER : formalités de déclaration ou d'autorisation préalable, transferts hors du Togo]**.
- Conséquences produit :
  - registre des traitements (EX-56) ;
  - consentements (OP-33) ;
  - chiffrement des pièces d'identité ;
  - durée de conservation paramétrable ;
  - droit d'accès et d'effacement ;
  - **localisation de l'hébergement** documentée : région du cloud, transferts hors du Togo, clauses du DPA.
- Pour la clientèle européenne, la conformité RGPD est maintenue (mêmes mécanismes).

## 6. Social et RH (module L10)
- Durée légale du travail, heures supplémentaires et majorations, travail de nuit et jours fériés : règles **paramétrables** (`settings` RH) avec des valeurs par défaut issues du **Code du travail togolais** **[À CONFIRMER]**.
- **Jours fériés du Togo** seedés pour l'année : fêtes civiles fixes, et fêtes religieuses à date variable (Tabaski, Ramadan, Pâques, Pentecôte…) à **mettre à jour chaque année** par le Super Admin.
- Export de paie (EX-53) : heures, majorations, primes, pourboires. Les calculs de paie (cotisations **CNSS**, impôt sur les salaires) sont en P3.

## 7. Communications
- SMS : agrégateur local ou international couvrant **Yas (Togocom)** et **Moov Africa** ; nom d'expéditeur alphanumérique **[À CONFIRMER : enregistrement du sender ID]**.
- WhatsApp Business API : canal privilégié pour les confirmations et les rappels.
- E-mail : SMTP transactionnel (SPF, DKIM, DMARC configurés pour le domaine de la plateforme et les domaines personnalisés).

## 8. Infrastructure et connectivité
- Connectivité variable : PWA, cache, payloads légers, reprise automatique des envois, caisse restaurant tolérante aux coupures (EX-43).
- Coupures d'électricité : sauvegarde automatique des brouillons de formulaires (réservation, commande, fiche de police).
- Hébergement : région cloud proche (Europe de l'Ouest ou Afrique) avec une latence cible < 150 ms depuis Lomé ; le choix doit être compatible avec la section 5.

## 9. Données de démonstration (seed L0b)
2 tenants togolais fictifs (noms inventés, aucune marque réelle) :
- un **complexe balnéaire à Lomé** (60 unités, restaurant, bar, spa, activités) ;
- un **hôtel à Kpalimé** (20 chambres, restaurant).

Les seeds contiennent des clients fictifs (numéros +228 fictifs), des tarifs en XOF, la TVA à 18 % et une taxe de séjour d'exemple, ainsi que des paiements Mixx et Moov avec des références fictives.

## 10. Checklist de validation (à fournir avant S6)
| # | Point | Interlocuteur |
|---|---|---|
| 1 | Taux de TVA applicables à l'hébergement, la restauration, le spa et les activités | Expert-comptable / OTR |
| 2 | Taxe de séjour ou hôtelière : montant, assiette, exonérations, déclaration | Expert-comptable / mairie / ministère du Tourisme |
| 3 | Facture normalisée ou électronique OTR : obligation, calendrier, spécifications techniques | OTR |
| 4 | Mentions obligatoires des factures | Expert-comptable |
| 5 | Champs exigés de la fiche de police et modalités de transmission | DGSN / commissariat |
| 6 | Formalités auprès de l'IPDCP, hébergement hors du Togo | Juriste / IPDCP |
| 7 | Règles de temps de travail et de majorations | Juriste social |
| 8 | Fournisseur SMS et enregistrement du sender ID | Opérateurs / agrégateur |
| 9 | Logiciel comptable cible pour l'export | Client |
