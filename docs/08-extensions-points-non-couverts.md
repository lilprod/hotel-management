# 08 — Points non couverts par le prompt et principes d'extensibilité

> Le prompt initial est un **plancher, pas un plafond**. Ce document :
> 1. pose les principes d'architecture qui garantissent qu'aucune fonctionnalité future n'exige de refonte (§1) ;
> 2. liste les **points non couverts** par le prompt et par les documents 01 à 07, avec leur priorité, leur plan et leur lot (§2 à §8).
>
> Identifiants : `EX-*`. Priorités : **M** (v1, S12), **S** (souhaitable en v1, sinon S13-S14), **P2** (v1.1, 3 à 6 mois), **P3** (feuille de route).

## 1. Principes d'extensibilité (obligatoires dès le lot L0)
| # | Principe | Mise en œuvre | Ce que cela débloque |
|---|---|---|---|
| X1 | **Registre de modules** | Chaque module déclare dans `server/src/modules/<m>/module.ts` ses routes, permissions, codes de fonctionnalités, jobs, événements, menus front et paramètres | Ajouter un module sans toucher au noyau |
| X2 | **Feature flags à 3 niveaux** | Plan → surcharge tenant → déploiement progressif plateforme (% de tenants, liste bêta) | Lancer une fonctionnalité en bêta sur quelques hôtels |
| X3 | **Modules à la carte** (*add-ons*) | `addons` facturables en plus du plan : spa, restaurant, pack SMS, unités ou établissements supplémentaires, domaine personnalisé | Vendre au-delà des 3 plans sans en créer de nouveaux |
| X4 | **Paramètres hiérarchiques** | `settings` plateforme → tenant → établissement → utilisateur, avec un schéma Zod par clé et des valeurs par défaut | Rien de codé en dur (heures, délais, règles) |
| X5 | **Champs personnalisés** | `custom_field_definitions` (entité, type, options, obligatoire) + colonne `custom_fields JSONB` sur les entités clés : client, réservation, unité, employé, article, bon de travail | Chaque hôtel ajoute ses propres champs |
| X6 | **Listes paramétrables** | Sources, segments, motifs d'annulation, types de tâches, catégories, étiquettes : tables de référence par tenant, et non des enums figés (les enums restent réservés aux statuts de machine à états) | — |
| X7 | **Moteur de taxes par pays** | `tax_rules` (pays, type, base, taux, inclusion, exonérations, date d'effet) | Togo, Bénin, Côte d'Ivoire, Sénégal… sans code |
| X8 | **Adapters remplaçables** | `PaymentProvider`, `NotificationProvider` (e-mail, SMS, WhatsApp, push), `StorageProvider`, `PdfRenderer`, `FiscalInvoiceProvider`, `ChannelManagerProvider`, `DoorLockProvider` | Intégrations futures sans refonte |
| X9 | **API publique + webhooks** | Les routes sont pensées *API-first* (OpenAPI) ; outbox → webhooks signés (HMAC) par tenant ; clés d'API à portées | Intégrations tierces, applications mobiles |
| X10 | **i18n extensible** | Namespaces i18next par module ; contenus métier stockés en `*_i18n JSONB` ; langues activables par tenant (FR, EN + ES, DE, IT, PT, AR…) | Clientèle touristique internationale |
| X11 | **Multi-devise native** | Devise de référence du tenant + devises acceptées + `exchange_rates` datés | Touristes qui paient en EUR ou USD |
| X12 | **Versionnement d'API** | `/api/v1` figée ; changements cassants uniquement en `/v2` ; dépréciation annoncée | Clients API et apps mobiles stables |
| X13 | **Données analytiques séparées** | Vues matérialisées et tables d'agrégats quotidiens (`daily_stats_*`), rafraîchies par job ; réplique de lecture possible | Rapports lourds sans ralentir l'opérationnel |

## 2. Plateforme SaaS (Super Admin) — compléments
| ID | Point non couvert | Prio | Plan |
|---|---|---|---|
| EX-01 | **Add-ons** facturables (X3) et **codes promo / coupons** d'abonnement (%, montant, durée, nombre d'utilisations) | M / S | — |
| EX-02 | **Revendeurs et parrainage** : partenaires commerciaux, tenants rattachés, commissions calculées, relevés | P2 | — |
| EX-03 | **TVA plateforme et facture conforme** de l'éditeur (mentions, NIF, multi-devise d'abonnement) | M | — |
| EX-04 | **CGU / CGV / DPA versionnées** : acceptation tracée à l'inscription et à chaque nouvelle version (blocage jusqu'à acceptation) | M | — |
| EX-05 | **Indicateurs d'usage par tenant** : connexions, réservations par mois, modules utilisés, *health score*, alerte de risque de churn | S | — |
| EX-06 | **CRM commercial** : leads, demandes de démo, pipeline, conversion en tenant | P2 | — |
| EX-07 | **Changelog et nouveautés** affichés aux tenants ; **page de statut** publique | S | — |
| EX-08 | **Tenant sandbox / démo** réinitialisable chaque nuit pour les prospects | S | — |
| EX-09 | **Clonage de configuration** : modèle d'hôtel (types, tarifs, rôles, menus) appliqué à un nouveau tenant | S | — |
| EX-10 | **Quotas d'usage techniques** : appels API, stockage, e-mails par jour ; facturation au-delà (SMS) | S | — |
| EX-11 | **Rétention et archivage** des tenants résiliés : export automatique remis au client avant la purge | M | — |
| EX-12 | **Accords de niveau de service par plan** et suivi des incidents (support prioritaire Premium) | S | Premium |

## 3. Opérationnel hôtelier — compléments
| ID | Point non couvert | Prio | Plan |
|---|---|---|---|
| EX-20 | **Import de données** (migration) : CSV/Excel de clients, unités, tarifs, réservations futures, articles, avec assistant de correspondance, aperçu et rapport d'erreurs | **M** | Tous |
| EX-21 | **Encaissement multi-devise** (EUR, USD, XOF) avec taux du jour, rendu de monnaie en XOF, écarts de change | **M** | Tous |
| EX-22 | **Revenue management de base** : restrictions *stop-sell*, fermeture à l'arrivée ou au départ (CTA/CTD), séjour maximum, tarifs dérivés (BAR − x %), règles d'occupation (si TO > 80 % alors +10 %) | S | Medium+ |
| EX-23 | **Allotements et agences / tour-opérateurs** : contrats, allotements avec date de libération, tarifs nets, **commissions**, relevés agence | S | Medium+ |
| EX-24 | **Séminaires, événements et banquets (MICE)** : salles (capacité par configuration), devis → contrat → fiche de fonction (BEO), menus de groupe, équipements AV, facturation maître | P2 | Premium |
| EX-25 | **Bons cadeaux et vouchers** (montant ou prestation, code unique, validité, solde) et **codes promo** de réservation | S | Medium+ |
| EX-26 | **Day pass et abonnements externes** : accès piscine, plage ou spa pour non-résidents, cartes de membre, entrées | S | Medium+ |
| EX-27 | **Pré-check-in en ligne** : formulaire de fiche de police, envoi de la pièce d'identité, heure d'arrivée, signature électronique ; **check-out express** (facture par e-mail) ; QR code de séjour | S | Medium+ |
| EX-28 | **Conciergerie** : demandes (taxi, excursion externe, réservation de restaurant extérieur), suivi, facturation des frais | S | Tous |
| EX-29 | **Transferts et navettes** : véhicules, chauffeurs, planning aéroport ↔ hôtel, facturation sur le folio | S | Medium+ |
| EX-30 | **Location d'équipements** : vélos, kayaks, transats, parking (créneaux, caution) | P2 | Medium+ |
| EX-31 | **Blanchisserie** : linge client (bon, tarif, folio) et linge hôtel (rotation, pertes, prestataire) | S | Medium+ |
| EX-32 | **Minibar** : composition standard par type, relevé mobile, refacturation automatique, réassort (lien stock) | M | Tous |
| EX-33 | **Objets trouvés** : registre, photo, restitution, destruction | M | Tous |
| EX-34 | **Pourboires et frais de service** : saisie, répartition par département ou employé, rapport | S | Medium+ |
| EX-35 | **Commissions du personnel** (praticiens spa, serveurs) : règles %, calcul mensuel, export | S | Medium+ |
| EX-36 | **Checklists d'inspection** (housekeeping, ouverture et fermeture de caisse ou de bar, sécurité) paramétrables, avec photos | S | Tous |
| EX-37 | **Énergie et consommations** : relevés de compteurs eau, électricité et gaz, ratios par nuitée, alertes | P2 | Premium |
| EX-38 | **Contrats prestataires et garanties** des équipements, échéances, alertes de renouvellement | P2 | Medium+ |
| EX-39 | **Registre de sécurité** : incidents, visiteurs, rondes | P2 | Medium+ |
| EX-40 | **Budget et objectifs** : budget mensuel par département, comparaison réalisé / budget / N-1 | P2 | Premium |
| EX-41 | **Reporting consolidé multi-établissements** (groupe) et comparatifs | M | Premium |
| EX-42 | **Gestion documentaire interne** : procédures, contrats, documents RH (accès par rôle) | P2 | Medium+ |
| EX-43 | **Caisse restaurant tolérante aux coupures** : file locale (IndexedDB) + synchronisation idempotente ; impression locale | S | Medium+ |
| EX-44 | **Gestion des allergies transverse** : l'alerte du profil client se propage au restaurant, au room service et au spa | M | Tous |
| EX-45 | **Gestion de la liste noire et des fraudes** : alertes à la réservation, impayés, partage interdit entre tenants | M | Tous |

## 4. Finance et conformité — compléments
| ID | Point non couvert | Prio | Plan |
|---|---|---|---|
| EX-50 | **Export comptable SYSCOHADA (OHADA)** : plan de comptes paramétrable, journaux ventes, encaissements et achats, écritures en CSV ou Excel pour Sage, Odoo, etc. | **M** | Medium+ |
| EX-51 | **Facture normalisée ou électronique** : Togo (OTR), Bénin (**e-MECeF**, obligatoire), Côte d'Ivoire (FNE), via `FiscalInvoiceProvider` | M (adapter) / P2 (connecteurs) | Tous |
| EX-52 | **Déclaration de TVA et de taxe de séjour** : états préparatoires mensuels | M | Tous |
| EX-53 | **Export de paie** : heures pointées, heures supplémentaires, primes, pourboires, commissions ; paie Togo (CNSS, IRPP) en P3 | S / P3 | Medium+ |
| EX-54 | **Rapprochement des encaissements** Mobile Money et TPE : import du relevé opérateur (CSV), rapprochement par référence et montant, écarts | S | Medium+ |
| EX-55 | **Clôture mensuelle** : verrouillage d'une période comptable (plus aucune écriture antérieure) | M | Tous |
| EX-56 | **Registre des traitements** (RGPD et APDCP), DPA, politique de conservation par type de donnée | M | — |

## 5. Expérience client — compléments
| ID | Point non couvert | Prio | Plan |
|---|---|---|---|
| EX-60 | **Enquêtes de satisfaction** post-séjour et post-prestation (NPS, notes par département), alertes sur les notes basses, tableau de bord | S | Medium+ |
| EX-61 | **Avis et e-réputation** : collecte, invitation à publier sur Google ou TripAdvisor, réponse | P2 | Premium |
| EX-62 | **Messagerie client ↔ réception** en temps réel (portail + WhatsApp) | S | Medium+ |
| EX-63 | **Marketing** : segments (VIP, anniversaire, inactifs), campagnes e-mail et SMS, désinscription, statistiques | P2 | Premium |
| EX-64 | **Offres et upsell** : surclassement, late check-out, early check-in, forfaits proposés dans le portail et l'e-mail pré-arrivée | S | Medium+ |
| EX-65 | **Parcours e-mail automatisés** : confirmation, pré-arrivée (J-3), bienvenue, pendant le séjour, post-séjour, anniversaire | M | Tous |
| EX-66 | **Notifications push web** (PWA) pour le client et le staff | S | Tous |
| EX-67 | **Programme de parrainage client** (fidélité) | P2 | Premium |
| EX-68 | **Langues touristiques additionnelles** (ES, DE, IT…) activables | S | Tous |

## 6. Intégrations et matériel
| ID | Point non couvert | Prio | Plan |
|---|---|---|---|
| EX-70 | **Matériel** : imprimantes thermiques ESC/POS (réseau ou USB via un agent local), tiroir-caisse, lecteur de codes-barres (stock), écran cuisine | M | Medium+ |
| EX-71 | **Channel manager / OTA** (Booking.com, Expedia, Airbnb) via un connecteur tiers (SiteMinder, Channex…) | P2 | Premium |
| EX-72 | **Serrures électroniques** (Salto, Assa Abloy Vingcard, TTLock) : encodage de cartes au check-in | P2 | Premium |
| EX-73 | **Wi-Fi** : génération de vouchers ou portail captif lié au séjour | P3 | Premium |
| EX-74 | **Intégrateur de paiement** (CinetPay, FedaPay, PayDunya, Semoa…) : paiement en ligne du portail et des abonnements | P2 | Tous |
| EX-75 | **SSO** (Google, Microsoft) et **SCIM** pour les groupes hôteliers | P2 | Premium |
| EX-76 | **Calendriers externes** (Google Calendar, iCal) pour les praticiens et les plannings | P2 | Medium+ |
| EX-77 | **Webhooks et API publique** (X9), avec documentation développeur | P2 | Premium |

## 7. Plateforme technique et exploitation
| ID | Point non couvert | Prio |
|---|---|---|
| EX-80 | **Applications mobiles** staff (housekeeping, maintenance, serveurs) en React Native ou Capacitor, réutilisant l'API | P2 |
| EX-81 | **Plan de reprise d'activité** : réplication PostgreSQL, sauvegardes hors site, restauration par tenant (*point-in-time*) | M (sauvegardes) / S (restauration par tenant) |
| EX-82 | **Observabilité par tenant** : métriques de latence et d'erreurs étiquetées par `tenant_id`, quotas, détection des abus | S |
| EX-83 | **Journal d'activité exportable vers un SIEM** (Premium) | P2 |
| EX-84 | **Performance des requêtes lourdes** : vues matérialisées (X13), pagination par curseur, recherche plein texte (`pg_trgm`) sur les clients et les réservations | M |
| EX-85 | **Tests de charge** multi-tenants (500 tenants simulés) et budget de performance en CI | S |
| EX-86 | **Gestion des versions** : migrations sans interruption (*expand / contract*), feature flags pour les déploiements progressifs | M |

## 8. Intelligence artificielle (feuille de route)
| ID | Point | Prio | Plan |
|---|---|---|---|
| EX-90 | Recommandation de prix selon l'occupation, la saison et les événements locaux | P3 | Premium |
| EX-91 | Assistant conversationnel du portail (FR, EN) : réservations, FAQ, demandes | P3 | Premium |
| EX-92 | Synthèse des avis et des enquêtes, détection des irritants | P3 | Premium |
| EX-93 | Prévision de la consommation des stocks et de l'effectif nécessaire | P3 | Premium |

## 9. Effet sur le planning
- Les points **M** de ce document sont intégrés aux lots existants ou à de nouveaux lots (doc 06 §8) **sans décaler la mise en production en S12**. Ils représentent environ 8 jours-agents, absorbés en V3 à V6.
- Les points **S** sont planifiés en S13-S14 (v1.1) s'ils ne tiennent pas en S12.
- Les points **P2** et **P3** forment la feuille de route ; l'architecture (§1) garantit qu'ils s'ajoutent sans refonte.
