// Tests des réponses rapides (Reponses.kt) et de leur lecture dans les événements (Protocol.kt) : réponses et textes
// comme shared/screen.ts, corps et chemin de la requête, durées du bandeau, identifiant de réponse lu ou absent.
package fr.homehub.tv

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReponsesTest {
    @Test
    fun reponsesCommeLeServeur() {
        assertEquals(listOf("ok", "coming", "five"), Reponses.CHOIX.map { it.key })
        assertEquals(listOf("OK", "J’arrive", "5 minutes"), Reponses.CHOIX.map { it.label })
    }

    @Test
    fun corpsDeLaReponse() {
        assertEquals("coming", JSONObject(Reponses.replyJson("coming")!!).getString("reply"))
        assertNull(Reponses.replyJson("peut-être"))
        assertEquals("/api/screen/replies/7f1c2d1e-0000-4000-8000-000000000001", Reponses.path("7f1c2d1e-0000-4000-8000-000000000001"))
        assertEquals("Réponse envoyée : 5 minutes", Reponses.sentText("five"))
    }

    @Test
    fun dureesDuBandeau() {
        assertEquals(10_000L, Reponses.messageMs(10, withReplies = false))
        assertEquals(Reponses.MESSAGE_MIN_MS, Reponses.messageMs(10, withReplies = true))
        assertEquals(45_000L, Reponses.messageMs(45, withReplies = true))
        assertEquals(Reponses.IDLE_MS, Reponses.afterKeyMs(2_000))
        assertEquals(18_000L, Reponses.afterKeyMs(18_000))
    }

    @Test
    fun identifiantDeReponseLuDansLesEvenements() {
        val json = """
            {"events":[
              {"seq":1,"kind":"message","id":"m1","title":"Message d’Alex","text":"On mange ?","seconds":10,"replyId":"r1"},
              {"seq":2,"kind":"message","id":"m2","title":"Message","text":"Sans réponse","seconds":10,"replyId":null}
            ],"last":2}
        """.trimIndent()
        val events = parseEvents(json)
        assertEquals(listOf("r1", null), events.messages.map { it.replyId })
    }
}
