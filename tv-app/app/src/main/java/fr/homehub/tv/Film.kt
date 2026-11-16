// Mode film (fonction 15, shared/screen-film.ts côté HomeHub) : pendant un film, HomeHub marque les bandeaux
// `discreet` (message écrit, minuteur, bus, pluie, rappel) et fait lire les messages vocaux par le Google Home. La télé
// montre alors un petit bandeau en bas à gauche (OverlayBanner.showDiscreet), sans son, sans focus de la télécommande,
// et moins longtemps. Fonctions pures, testées sur la JVM (FilmTest).
package fr.homehub.tv

object Film {
    /** Bornes d'un bandeau discret : assez pour lire, pas assez pour gêner le film. */
    const val MIN_MS = 5_000L
    const val MAX_MS = 12_000L
    /** Un message écrit se lit : il garde un peu plus. */
    const val MESSAGE_MAX_MS = 20_000L
    /** Minuteur terminé en mode film : pas de carillon ni de bouton, le bandeau passe seul (la tablette sonne). */
    const val TIMER_MS = 10_000L

    /** Durée d'un bandeau discret demandé pour `seconds` secondes. */
    fun durationMs(seconds: Int): Long = (seconds * 1_000L).coerceIn(MIN_MS, MAX_MS)

    /** Durée d'un message écrit discret. */
    fun messageMs(seconds: Int): Long = (seconds * 1_000L).coerceIn(MIN_MS, MESSAGE_MAX_MS)

    /** Minuteurs qui sonnent, partagés entre le bandeau habituel (carillon, « Arrêter ») et le bandeau discret. */
    fun splitTimers(events: List<TimerEvent>): Pair<List<TimerEvent>, List<TimerEvent.Ring>> {
        val discreet = events.filterIsInstance<TimerEvent.Ring>().filter { it.discreet }
        return events.filterNot { it is TimerEvent.Ring && it.discreet } to discreet
    }
}
