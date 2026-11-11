# 00 — Analyse critique du besoin initial

## 1. Besoin exprimé (reformulé)

> Une application SaaS de gestion hôtelière **multi-tenant**, avec :
> - un **espace Super Admin** (éditeur de la plateforme) ;
> - des **tenants** (hôtels clients) autonomes sur leur **sécurité**, leur **branding** et tout leur **opérationnel** ;
> - **3 plans** : Standard, Medium, Premium, avec **tarifs paramétrables** et **périodes d'essai** ;
> - **pas d'intégrateur de paiement** pour l'instant : le Super Admin **enregistre manuellement** les paiements d'abonnement (modes : **Mixx**, **Moov Money**, **Espèces**, **Carte bancaire**) avec une **référence facultative**.

## 2. Ce qui est couvert par le besoin initial

| Domaine | Couvert | Commentaire |
|---|---|---|
| Multi-tenancy | ✅ | Il faut encore choisir le modèle d'isolation (voir doc 03) |
| Espace Super Admin | ✅ (partiel) | Le périmètre fonctionnel n'est pas détaillé |
| Plans et essais | ✅ (partiel) | Ni quotas ni fonctionnalités par plan, ni cycle de facturation, ni règle de fin d'essai |
| Paiement manuel | ✅ (partiel) | Pas de facture, de reçu, de rapprochement, de relance ni de suspension |
| Sécurité tenant | ✅ (intention) | Le contenu reste à définir : 2FA, mots de passe, sessions, IP, audit |
| Branding tenant | ✅ (intention) | Le contenu reste à définir : logo, couleurs, sous-domaine, documents |
| « Tout l'opérationnel » | ⚠️ | C'est le cœur du produit, et il n'est **pas détaillé** |

## 3. Manques identifiés (à intégrer — tous intégrés dans le doc 01)

### 3.1 Opérationnel hôtelier (PMS) — le plus gros manque
1. **Structure de l'établissement** : multi-établissements par tenant, bâtiments et étages, **types de chambres**, chambres, équipements.
2. **Tarification** : plans tarifaires, **saisons**, tarifs week-end, tarifs enfant et lit supplémentaire, tarifs entreprise négociés, promotions, séjour minimum.
3. **Disponibilités** : planning (vue Gantt), blocage de chambres (hors service), gestion du **surbooking**.
4. **Réservations** : individuelles, **groupes**, walk-in, statuts (option, confirmée, arrivée, partie, annulée, no-show), politiques d'annulation, **acomptes**.
5. **Réception** : check-in et check-out, **fiche de police** (obligatoire en Afrique de l'Ouest : pièce d'identité, nationalité, provenance/destination), délogement, changement de chambre, prolongation.
6. **Folio client** : consommations, extras, **taxe de séjour**, **TVA** (18 % au Togo et au Bénin), remises, **factures et reçus numérotés sans trou**, factures entreprise (débiteurs), avoirs.
7. **Encaissements côté hôtel** : mêmes modes que la plateforme (Mixx, Moov Money, Espèces, Carte) + virement, paiements partiels, **sessions de caisse** (ouverture, clôture, écarts).
8. **Audit de nuit** (clôture journalière) : report des nuitées, gel de la journée, rapports du jour.
9. **Housekeeping** : statut des chambres (propre, sale, à inspecter, hors service), affectation des femmes de chambre, linge.
10. **Maintenance** : tickets d'incident par chambre ou équipement, priorité, suivi.
11. **Point de vente restaurant/bar** : carte, commandes, **imputation sur la chambre**, tickets.
12. **Stocks** (minibar, bar, consommables) : entrées, sorties, inventaire, alertes de seuil.
13. **CRM clients** : historique, préférences, clients VIP, liste noire, sociétés.
14. **Rapports et KPI** : taux d'occupation, **ADR**, **RevPAR**, chiffre d'affaires par source, encaissements par mode, main courante, état de caisse.
15. **Notifications** : e-mail, SMS, WhatsApp (confirmation de réservation, rappel, facture).
16. **Moteur de réservation en ligne** (widget public) et **channel manager** (OTA) : à prévoir en phase 2.

### 3.2 Plateforme SaaS
1. **Cycle de vie du tenant** : inscription → essai → actif → impayé (période de grâce) → suspendu (lecture seule) → résilié → purge (RGPD).
2. **Facturation plateforme** : factures d'abonnement générées automatiquement, **reçus PDF** à l'enregistrement d'un paiement, numérotation, prorata lors d'un changement de plan.
3. **Workflow de paiement manuel** : saisie → (option) **double validation** → affectation à une ou plusieurs factures → prolongation de l'abonnement. Il faut aussi annuler ou contre-passer (jamais supprimer) et contrôler l'**unicité de la référence** par mode de paiement.
4. **Déclaration de paiement par le tenant** (recommandé) : le tenant déclare « j'ai payé par Mixx, réf. XXX » et joint une capture ; le Super Admin valide. Cette étape prépare la future intégration d'un agrégateur.
5. **Relances** : J-7, J-3, J0 et J+3 avant ou après échéance (e-mail, SMS, bandeau dans l'application).
6. **Quotas et fonctionnalités par plan** (*feature flags*) : nombre de chambres, d'établissements, d'utilisateurs, modules activés, stockage.
7. **Impersonation** (connexion « en tant que ») encadrée et tracée, pour le support.
8. **Support** : tickets, annonces globales, maintenance planifiée.
9. **Monitoring** : santé de la plateforme, sauvegardes, journaux.
10. **Conformité** : export des données d'un tenant, suppression, CGU/CGV, loi togolaise n° 2019-014 sur la protection des données personnelles.

### 3.3 Transverses
- **Langues** : FR (par défaut), EN. **Devise** : XOF (FCFA) par défaut, paramétrable par tenant. **Fuseau** : Africa/Lome.
- **Faible connectivité** : interface légère, PWA, mise en cache, tolérance aux coupures (mode hors ligne complet : hors périmètre v1).
- **Mobile-first** pour le housekeeping et la maintenance.
- **Intégrateur de paiement futur** : abstraire dès maintenant un `PaymentProvider` (le mode `manual` étant la seule implémentation v1).

## 4. Hypothèses retenues (à valider par le client)
- H1 : les tenants encaissent aussi leurs clients avec les modes Mixx, Moov Money, Espèces, Carte et Virement, en **enregistrement manuel** (même modèle que la plateforme).
- H2 : un tenant = une organisation hôtelière, qui peut avoir **plusieurs établissements** selon son plan.
- H3 : l'accès se fait par sous-domaine `{slug}.app.domaine.com`, avec un domaine personnalisé en Premium.
- H4 : le paiement « carte bancaire » v1 = encaissement par TPE physique ; on saisit seulement la référence du ticket TPE.
- H5 : un abonnement est payable au mois, au trimestre ou à l'année, avec une remise paramétrable.
- H6 : en fin d'essai sans paiement, le tenant passe en **suspendu (lecture seule)** et ne perd pas ses données pendant N jours (paramétrable, 90 par défaut).

## 5. Verdict
Le besoin initial pose correctement la **dimension SaaS** (multi-tenant, plans, paiement manuel). En revanche, il **sous-spécifie fortement le métier hôtelier** (« tout l'opérationnel ») et le **cycle de facturation** (factures, relances, suspension). Les documents 01 à 07 comblent ces manques.
