// Tests JVM du protocole de HomeHub TV : réponses du serveur (shared/screen.ts) lues telles qu'il les envoie, genres
// d'événements inconnus ignorés, messages écrits, ordres de la télécommande, message d'erreur, compte rendu (et refus écran éteint), état de la télé, liste des
// applis, adresse de HomeHub donnée par adb.
package fr.homehub.tv

import org.json.JSONArray
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
    fun messageVocalRefuseEcranEteint() {
        assertNull(voiceRefusal(screenOn = true))
        val refused = JSONObject(voiceRefusal(screenOn = false)!!)
        assertEquals(false, refused.getBoolean("ok"))
        assertEquals("écran éteint", refused.getString("reason"))
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

    @Test
    fun ordresDeLaTelecommande() {
        val events = parseEvents(
            """{"events":[
              {"seq":5,"kind":"key","id":"k1","keys":["down","ok"]},
              {"seq":6,"kind":"key","id":"k2","keys":["pause"],"notice":{"title":"À table !","subtitle":"De la part d’Alex"}},
              {"seq":7,"kind":"text","id":"t1","text":"dessin animé","submit":true},
              {"seq":8,"kind":"launch","id":"l1","package":"fr.exemple.video"},
              {"seq":9,"kind":"power","id":"p1","on":false},
              {"seq":10,"kind":"inconnu","id":"x"}
            ],"last":10}""",
        )
        assertEquals(
            listOf(
                RemoteEvent.Keys("k1", listOf("down", "ok"), null),
                RemoteEvent.Keys("k2", listOf("pause"), Notice("À table !", "De la part d’Alex")),
                RemoteEvent.Text("t1", "dessin animé", true),
                RemoteEvent.Launch("l1", "fr.exemple.video"),
                RemoteEvent.Power("p1", false),
            ),
            events.remote,
        )
        assertEquals(emptyList<VoiceEvent>(), events.voices)
    }

    @Test
    fun alerteDuBus() {
        val events = parseEvents(
            """{"events":[
              {"seq":11,"kind":"bus","id":"b1","title":"Bus dans 11 min","subtitle":"Léa · ligne 3 vers Collège · pars dans 7 min","seconds":45},
              {"seq":12,"kind":"bus","id":"b2","title":"Le bus arrive","subtitle":"Tom · ligne 3 · pars maintenant","seconds":9999}
            ],"last":12}""",
        )
        assertEquals(
            listOf(
                BusEvent("b1", "Bus dans 11 min", "Léa · ligne 3 vers Collège · pars dans 7 min", 45),
                BusEvent("b2", "Le bus arrive", "Tom · ligne 3 · pars maintenant", 120),
            ),
            events.bus,
        )
        assertEquals(emptyList<RemoteEvent>(), events.remote)
    }

    @Test
    fun etatEtApplis() {
        val state = JSONObject(stateJson(false, null, "adb", listOf("192.168.1.60")))
        assertEquals(false, state.getBoolean("screenOn"))
        assertEquals(true, state.isNull("foreground"))
        assertEquals("adb", state.getString("control"))
        assertEquals("192.168.1.60", state.getJSONArray("addresses").getString(0))
        assertEquals(false, state.has("volume"))
        assertEquals("fixed", JSONObject(stateJson(true, null, "adb", emptyList(), "fixed")).getString("volume"))

        val apps: JSONArray = JSONObject(appsJson(listOf(AppEntry("fr.exemple.video", "Vidéo+", "iVBORw0KGgo="), AppEntry("fr.exemple.box", "Box TV", null)))).getJSONArray("apps")
        assertEquals("fr.exemple.video", apps.getJSONObject(0).getString("package"))
        assertEquals("iVBORw0KGgo=", apps.getJSONObject(0).getString("banner"))
        assertEquals(true, apps.getJSONObject(1).isNull("banner"))
        assertEquals(80, JSONObject(appsJson(List(100) { AppEntry("fr.exemple.a$it", "A$it", null) })).getJSONArray("apps").length())
    }

    @Test
    fun messagesEcrits() {
        val events = parseEvents(
            """{"events":[
              {"seq":7,"kind":"message","id":"m1","title":"Message d’Alex","text":"À table ! 🍝","seconds":15},
              {"seq":8,"kind":"message","id":"m2","title":"Message","text":"Trop long","seconds":600},
              {"seq":9,"kind":"voice","id":"v1","title":"Message de Sam","audio":"/api/screen/clips/x.webm","contentType":"audio/webm"}
            ],"last":9}""",
        )
        assertEquals(
            listOf(MessageEvent("m1", "Message d’Alex", "À table ! 🍝", 15), MessageEvent("m2", "Message", "Trop long", 60)),
            events.messages,
        )
        assertEquals(1, events.voices.size)
        assertEquals(emptyList<RemoteEvent>(), events.remote)
    }
}
