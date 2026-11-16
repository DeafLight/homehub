<!-- Liste des essais restants de l'appli HomeHub TV sur la vraie télé (0.80.0 à 0.92.0) ; on retire chaque ligne une fois vérifiée. -->

# Essais à faire sur la vraie télé

Chaque ligne vérifiée est retirée du fichier, et une section vide disparaît avec elle. Un essai qui échoue devient un
correctif (nouvelle session, nouvelle branche). Les fonctions 1, 2 et 3 sont déjà vérifiées.

## Avant de tester

- [ ] Déployer depuis le NAS : `sudo scripts/deploy-homehub.sh`. La première fois, accepter la clé `adb` du NAS sur la
      télé (« Toujours autoriser »), puis relancer.
- [ ] `homehub.yaml` : retirer `tv.host` et `tv.port` s'ils y sont encore (ignorés depuis la 0.77.0) ; `rainAlert`
      seulement pour changer ses valeurs par défaut ; `cast` contient bien le Google Home (messages enregistrés) et la télé (`kind: tv`, pour l'allumer).
- [ ] Tablette › Téléphones › Coucher des enfants : activer et régler les heures (coupé par défaut).
- [ ] Tablette › Transports › Alerte sur la télé : régler par trajet.
- [ ] Tablette › Téléphones › Rappels sur la télé : vérifier les heures.
- [ ] Tablette › Téléphones › Télés : alertes « Minuteurs » et « Mode film automatique ».
- [ ] Télé : accepter la clé de l'appli au premier usage de la télécommande ; « Débogage réseau » et « Wake on wireless
      LAN » restent activés.

## 4. Bus du matin (0.80.0)

- [ ] Un matin d'école, le bandeau « Bus dans N min » arrive à l'heure réglée.
- [ ] Rien en vacances ni un jour férié.

## 14. Alerte pluie (0.81.0)

- [ ] Un matin de pluie prévue, le bandeau parapluie arrive une seule fois entre 7 h et 8 h 30.

## 5. Rappels du soir (0.82.0)

- [ ] Le bandeau cloche arrive à l'heure réglée.
- [ ] Télé allumée dans la demi-heure qui suit : le rappel est rattrapé.

## 8. Écran de veille HomeHub (0.85.0)

- [ ] La page s'affiche dans la WebView d'Android 11, avec les bonnes polices.
- [ ] Le délai avant la veille est respecté.
- [ ] L'écran de veille d'origine revient comme avant.
- [ ] L'écran de veille se lance aussi télé en veille rapide.

## 11. Partage de photo ou de vidéo (0.86.0)

- [ ] Une vidéo passe par-dessus la télé en direct.
- [ ] Une photo HEIC s'affiche.
- [ ] Retour ferme le plein écran.

## 12. Séance de sport (0.87.0)

- [ ] La page s'affiche dans la WebView.
- [ ] On entend les bips.
- [ ] Retour à la télécommande ferme la page.

## 13. Mode cuisine (0.88.0)

- [ ] La vue s'ouvre depuis Netflix.
- [ ] La vue s'ouvre depuis la veille.
- [ ] Retour rend l'appli d'avant.
- [ ] L'étape est lisible à 3 m.
- [ ] Les boutons prennent le focus de la télécommande.

## 9. Parler en direct (0.89.0)

- [ ] Le décalage de la voix reste supportable.
- [ ] Le son du programme baisse sous YouTube, Netflix et l'appli de la box.
- [ ] Ça marche en Wi-Fi.
- [ ] Ça marche en 4G.
- [ ] Le bouton est grisé quand la télé est en veille.

## 10. Réponses rapides (0.90.0)

- [ ] Le bandeau prend le focus sans arrêter Netflix, YouTube ou la télé en direct.
- [ ] ◀ ▶ et OK sélectionnent les boutons.
- [ ] Retour masque le bandeau sans répondre et rend la télécommande à l'appli.
- [ ] Les boutons sont lisibles à 3 m.
- [ ] La réponse arrive sur le téléphone de l'expéditeur.

## 15. Mode film (0.91.0)

- [ ] Le mode s'allume en ouvrant Netflix, Disney+, Prime Video, Canal+ (paquets bien reconnus ?).
- [ ] Il tient quand on passe du menu de Netflix à la lecture.
- [ ] Le petit bandeau est lisible sans gêner le film.
- [ ] Le minuteur arrive discret, sans carillon.
- [ ] Tout redevient normal en quittant l'appli.
- [ ] Bouton Mode film du téléphone et de la tablette.

## 16. Heure du coucher (0.92.0)

- [ ] Le rappel lune arrive à l'heure et reste lisible à 3 m.
- [ ] Pause à l'heure dite sous Netflix, YouTube et la télé en direct.
- [ ] L'écran de veille s'ouvre par-dessus l'appli, puis la mise en veille de la télé suit son cours.
- [ ] Retour rend le programme, toujours en pause.
- [ ] « Repousser » et « Annuler » depuis le téléphone ferment l'écran de veille.
- [ ] Télé allumée après l'heure : la pause seule, pas le rappel.
- [ ] À décider à l'usage : rouvrir l'écran de veille si un enfant le ferme ou rallume la télé ?

## 17. Télécommande (0.73.x)

- [ ] E2 : l'appli obtient l'autorisation de l'`adb` de la télé elle-même.
- [ ] E4 : télé joignable après 1 h de veille, et télécommande qui la rallume.
- [ ] E6 : le clavier du téléphone écrit dans YouTube et Netflix (profil choisi par toi).
- [ ] E7 : une rafale de flèches ne traîne pas.

## 18. Ce qui passe à la télé (0.96.0)

- [ ] À l'écran, sur le téléphone, ce que publient YouTube, Netflix, Prime Video, Disney+ et la télé en direct de la
      box : titre, épisode ou chaîne, image, lecture ou pause, avancée juste (noter ce qui manque, appli par appli).
      Netflix (16/11/2026) : session de `com.netflix.ninja` en lecture (`state=3`) avec position, mais `metadata`
      nulle : ni titre, ni durée, ni image (rien à faire côté HomeHub sans lire l'écran, écarté). Depuis la 0.96.2 :
      « Netflix », bannière de l'appli, « Lecture » et temps écoulé seul ; à revoir : YouTube, Prime Video, Disney+,
      la box.
- [ ] Pause à la télécommande : « En pause » en 5 s au plus ; saut dans le programme : temps corrigé.
- [ ] Film laissé en pause puis Accueil : plus de programme affiché ; télé en veille : « Télé en veille ».
