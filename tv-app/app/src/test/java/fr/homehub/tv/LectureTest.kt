// Tests de ce qui passe (fonction 18) : session retenue (appli au premier plan, sinon une qui joue, jamais une pause
// laissée derrière), état de lecture, position à l'envoi, durée en direct oubliée, titre et sous-titre, JSON envoyé
// avec l'état de la télé, clé qui ignore l'écoulement normal mais pas un saut.
package fr.homehub.tv

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LectureTest {
    private val serie = Lecture("fr.exemple.cine", "Les Voisins du dessus", "Saison 2 · Épisode 4", "playing", 600_000, 2_400_000, "/9j/abc")

    @Test
    fun sessionRetenue() {
        val musique = SessionVue("fr.exemple.musique", EtatsLecture.PLAYING)
        val filmEnPause = SessionVue("fr.exemple.cine", EtatsLecture.PAUSED)
        assertEquals(1, choisirSession(listOf(musique, filmEnPause), "fr.exemple.cine"))
        // Film laissé en pause, Accueil : seule la musique qui joue compte.
        assertEquals(0, choisirSession(listOf(musique, filmEnPause), "fr.exemple.lanceur"))
        assertNull(choisirSession(listOf(filmEnPause), "fr.exemple.lanceur"))
        assertNull(choisirSession(listOf(SessionVue("fr.exemple.cine", EtatsLecture.STOPPED)), "fr.exemple.cine"))
        assertEquals(0, choisirSession(listOf(SessionVue("fr.exemple.box", EtatsLecture.BUFFERING)), null))
        assertNull(choisirSession(emptyList(), "fr.exemple.cine"))
    }

    @Test
    fun etatsDeLecture() {
        assertEquals("playing", etatLecture(EtatsLecture.PLAYING))
        assertEquals("playing", etatLecture(EtatsLecture.FAST_FORWARDING))
        assertEquals("paused", etatLecture(EtatsLecture.PAUSED))
        assertEquals("buffering", etatLecture(EtatsLecture.SKIPPING_TO_NEXT))
        assertNull(etatLecture(EtatsLecture.ERROR))
        assertNull(etatLecture(0))
    }

    @Test
    fun positionDureeEtTextes() {
        assertEquals(70_000L, positionActuelle(60_000, 1_000, 1f, true, 11_000))
        assertEquals(80_000L, positionActuelle(60_000, 1_000, 2f, true, 11_000))
        assertEquals(60_000L, positionActuelle(60_000, 1_000, 1f, false, 11_000))
        assertNull(positionActuelle(-1, 1_000, 1f, true, 11_000))
        assertNull(dureeLecture(0))
        assertNull(dureeLecture(-1))
        assertEquals(2_400_000L, dureeLecture(2_400_000))
        assertEquals("Chaîne 2", sousTitre(null, " Chaîne 2 ", "Album"))
        assertEquals("Saison 2", sousTitre("Saison 2", "Artiste", null))
        assertNull(sousTitre("", " ", null))
        assertEquals("Journal", titre(null, "Journal"))
    }

    @Test
    fun jsonEnvoye() {
        val state = JSONObject(stateJson(true, "fr.exemple.cine", "adb", emptyList(), nowPlaying = serie))
        val np = state.getJSONObject("nowPlaying")
        assertEquals("fr.exemple.cine", np.getString("package"))
        assertEquals("playing", np.getString("state"))
        assertEquals(600_000L, np.getLong("positionMs"))
        assertEquals("/9j/abc", np.getString("artwork"))
        val direct = JSONObject(lectureJson(serie.copy(title = null, positionMs = null, durationMs = null, artwork = null)).toString())
        assertEquals(true, direct.isNull("title") && direct.isNull("positionMs") && direct.isNull("durationMs") && direct.isNull("artwork"))
        assertEquals(true, JSONObject(stateJson(true, null, "adb", emptyList())).isNull("nowPlaying"))
    }

    @Test
    fun cleSansEcoulementNormal() {
        // 10 s plus tard, la position a avancé d'autant : même clé ; un saut d'une minute : autre clé.
        val avant = cleLecture(serie, 1_000_000)
        assertEquals(avant, cleLecture(serie.copy(positionMs = 610_000), 1_010_000))
        assertNotEquals(avant, cleLecture(serie.copy(positionMs = 670_000), 1_010_000))
        assertNotEquals(avant, cleLecture(serie.copy(state = "paused"), 1_000_000))
        assertEquals("-", cleLecture(null, 0))
    }
}
