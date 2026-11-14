// Tests JVM de la séance de sport sur la télé : adresse de la page (jeton dans le fragment, chemin suspect refusé),
// navigation limitée à HomeHub, et événements « workout » lus tels que le serveur les envoie.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SportTest {
    @Test
    fun adresseDeLaPage() {
        assertEquals("http://homehub.exemple/tele-sport.html#token=a%2Bb%2Fc", Sport.pageUrl("http://homehub.exemple", "/tele-sport.html", "a+b/c"))
        assertNull(Sport.pageUrl("http://homehub.exemple", "//ailleurs.exemple/x", "t"))
        assertNull(Sport.pageUrl("http://homehub.exemple", "https://ailleurs.exemple", "t"))
        assertNull(Sport.pageUrl("http://homehub.exemple", "/../x", "t"))
    }

    @Test
    fun navigationLimiteeAHomeHub() {
        assertTrue(Sport.sameOrigin("http://homehub.exemple", "http://homehub.exemple/tele-sport.html"))
        assertFalse(Sport.sameOrigin("http://homehub.exemple", "http://homehub.exemple.pirate/x"))
        assertFalse(Sport.sameOrigin("http://homehub.exemple", "https://ailleurs.exemple/"))
    }

    @Test
    fun evenementsDeLaSeance() {
        val events = parseEvents(
            """{"events":[
              {"seq":1,"kind":"workout","id":"w1","action":"start","page":"/tele-sport.html"},
              {"seq":2,"kind":"workout","id":"w2","action":"end","page":"/tele-sport.html","notice":{"title":"Séance terminée","subtitle":"Bravo !"}}
            ],"last":2}""",
        )
        assertEquals(
            listOf(
                RemoteEvent.Workout("w1", true, "/tele-sport.html", null),
                RemoteEvent.Workout("w2", false, "/tele-sport.html", Notice("Séance terminée", "Bravo !")),
            ),
            events.remote,
        )
    }
}
