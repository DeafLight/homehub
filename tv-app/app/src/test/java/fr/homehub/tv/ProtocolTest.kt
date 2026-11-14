// Tests JVM du protocole de HomeHub TV : réponses du serveur (shared/screen.ts) lues telles qu'il les envoie, genres
// d'événements inconnus ignorés, message d'erreur, compte rendu, adresse de HomeHub donnée par adb.
package fr.homehub.tv

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProtocolTest {
    @Test
    fun demandeEtAttenteDAppairage() {
        assertEquals(PairingStart("id-1", "ABC234", "2026-11-05T07:40:00.000Z"), parsePairingStart("""{"id":"id-1","code":"ABC234","expiresAt":"2026-11-05T07:40:00.000Z"}"""))
        assertEquals(PairingState.Pending, parsePairingState("""{"status":"pending"}"""))
        assertEquals(
            PairingState.Paired("jeton", "tele-1", "Télé du salon"),
            parsePairingState("""{"status":"paired","token":"jeton","screen":{"id":"tele-1","name":"Télé du salon"}}"""),
        )
    }

    @Test
    fun evenementsVocauxSeulement() {
        val events = parseEvents(
            """{"events":[
              {"seq":3,"kind":"voice","id":"e1","title":"Message d’Alex","audio":"/api/screen/clips/abc.webm","contentType":"audio/webm"},
              {"seq":4,"kind":"timer","id":"e2"}
            ],"last":4}""",
        )
        assertEquals(4, events.last)
        assertEquals(listOf(VoiceEvent(3, "e1", "Message d’Alex", "/api/screen/clips/abc.webm", "audio/webm")), events.voices)
        assertEquals(Events(emptyList(), 0), parseEvents("""{"events":[],"last":0}"""))
    }

    @Test
    fun messageDErreur() {
        assertEquals("Télé non reconnue : à appairer de nouveau", errorMessage(401, """{"error":"Télé non reconnue : à appairer de nouveau"}"""))
        assertEquals("HTTP 502", errorMessage(502, "<html>Bad gateway</html>"))
        assertEquals("HTTP 500", errorMessage(500, null))
    }

    @Test
    fun compteRendu() {
        assertEquals(true, JSONObject(reportJson(true)).getBoolean("ok"))
        val failed = JSONObject(reportJson(false, "x".repeat(300)))
        assertEquals(false, failed.getBoolean("ok"))
        assertEquals(200, failed.getString("reason").length)
    }

    @Test
    fun adresseDeHomeHub() {
        assertEquals("http://homehub.exemple", normalizeServer(" homehub.exemple/ "))
        assertEquals("https://homehub.exemple", normalizeServer("https://homehub.exemple"))
        assertEquals("http://192.168.1.10:3000", normalizeServer("http://192.168.1.10:3000/"))
        assertNull(normalizeServer(""))
        assertNull(normalizeServer("http://"))
        assertNull(normalizeServer("deux mots"))
    }
}
