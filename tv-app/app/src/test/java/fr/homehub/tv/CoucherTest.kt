// Tests de l'heure du coucher : lecture des événements « bedtime » parmi les autres (ouvrir, fermer, action inconnue
// ignorée) ; le rappel du coucher reste un rappel ordinaire, la pause une touche avec son bandeau.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class CoucherTest {
    @Test
    fun evenementsDuCoucher() {
        val json = """{"events":[
            {"seq":1,"kind":"reminder","id":"r","reminder":"bedtime","title":"Coucher dans 15 min","subtitle":"Léa et Tom : au lit à 20:30","seconds":20},
            {"seq":2,"kind":"key","id":"k","keys":["pause"],"notice":{"title":"C’est l’heure d’aller au lit","subtitle":"Bonne nuit Léa et Tom !"}},
            {"seq":3,"kind":"bedtime","id":"s","action":"sleep"},
            {"seq":4,"kind":"bedtime","id":"w","action":"wake"},
            {"seq":5,"kind":"bedtime","id":"x","action":"plus-tard"}
        ],"last":5}"""
        assertEquals(listOf(BedtimeEvent("s", true), BedtimeEvent("w", false)), parseBedtime(json))
        assertEquals("bedtime", parseReminders(json).single().reminder)
        assertEquals(R.drawable.ic_moon, Rappels.icon("bedtime"))
        assertEquals(null, Rappels.icon("evening-routine"))
        val keys = parseEvents(json).remote.single() as RemoteEvent.Keys
        assertEquals("C’est l’heure d’aller au lit", keys.notice?.title)
    }

    @Test
    fun aucunEvenementDuCoucher() {
        assertEquals(emptyList<BedtimeEvent>(), parseBedtime("""{"events":[],"last":0}"""))
    }
}
