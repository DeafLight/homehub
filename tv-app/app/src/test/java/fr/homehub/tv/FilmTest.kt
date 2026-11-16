// Tests du mode film côté télé (Film.kt) : drapeau `discreet` lu sur chaque genre de bandeau, absent par défaut
// (serveur d'avant la fonction 15), durées bornées, minuteurs discrets mis à part.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilmTest {
    private val json = """
        {"events":[
          {"seq":1,"kind":"message","id":"m1","title":"Message d’Alex","text":"On mange à 20 h","seconds":10,"discreet":true},
          {"seq":2,"kind":"bus","id":"b1","title":"Bus dans 5 min","subtitle":"Ligne 1","seconds":45,"discreet":true},
          {"seq":3,"kind":"rain","id":"r1","title":"Pluie vers 8 h","subtitle":"Prenez un parapluie","seconds":60,"discreet":true},
          {"seq":4,"kind":"reminder","id":"n1","reminder":"notes","title":"Mots à lire","subtitle":"Léa : 1 mot","seconds":20,"discreet":true},
          {"seq":5,"kind":"timer","id":"t1","timerId":"a","title":"Pâtes","subtitle":"C’est l’heure !","discreet":true},
          {"seq":6,"kind":"timer","id":"t2","timerId":"b","title":"Riz","subtitle":"C’est l’heure !"},
          {"seq":7,"kind":"timer-clear","id":"t3","timerId":"c"}
        ],"last":7}
    """.trimIndent()

    @Test
    fun litLeDrapeauDiscret() {
        val events = parseEvents(json)
        assertTrue(events.messages.single().discreet)
        assertTrue(events.bus.single().discreet)
        assertTrue(parseRainEvents(json).single().discreet)
        assertTrue(parseReminders(json).single().discreet)
    }

    @Test
    fun absentParDefaut() {
        val old = """{"events":[{"seq":1,"kind":"bus","id":"b","title":"Bus","subtitle":"","seconds":30}],"last":1}"""
        assertFalse(parseEvents(old).bus.single().discreet)
    }

    @Test
    fun minuteursDiscretsMisAPart() {
        val (normal, quiet) = Film.splitTimers(parseTimerEvents(json))
        assertEquals(listOf("t2", "t3"), normal.map { it.id })
        assertEquals(listOf("t1"), quiet.map { it.id })
    }

    @Test
    fun dureesBornees() {
        assertEquals(5_000L, Film.durationMs(1))
        assertEquals(8_000L, Film.durationMs(8))
        assertEquals(12_000L, Film.durationMs(45))
        assertEquals(10_000L, Film.messageMs(10))
        assertEquals(20_000L, Film.messageMs(60))
    }
}
