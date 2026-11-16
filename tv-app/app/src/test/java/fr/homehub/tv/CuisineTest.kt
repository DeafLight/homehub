// Tests du mode cuisine côté appli : lecture de la vue envoyée par HomeHub (shared/screen-cook.ts), événements
// « cook », corps des requêtes, décompte, taille du texte, touches de la télécommande.
package fr.homehub.tv

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CuisineTest {
    private val view = """
        {"cook":{"rev":7,"recipeId":"r1","title":"Mijoté de lentilles","index":1,"total":3,
          "step":{"number":2,"text":"Faire revenir 5 minutes, puis cuire 25 minutes.","section":null,"mode":"Sous pression",
            "durations":[{"seconds":300,"text":"5 min","timerId":null},{"seconds":1500,"text":"25 min","timerId":"t1"}]},
          "next":"Servir chaud.",
          "timers":[{"id":"t1","label":"Cuisson · ét. 2 · Mijoté de l…","durationSeconds":1500,"remainingSeconds":62,"ended":false,"step":2},
                    {"id":"t2","label":"Écrans","durationSeconds":1800,"remainingSeconds":0,"ended":true,"step":null}]}}
    """.trimIndent()

    @Test
    fun vueCuisine() {
        val cook = parseCookView(view)!!
        assertEquals(7, cook.rev)
        assertEquals("Mijoté de lentilles", cook.title)
        assertEquals(1, cook.index)
        assertEquals(3, cook.total)
        assertEquals("Servir chaud.", cook.next)
        val step = cook.step!!
        assertEquals(2, step.number)
        assertNull(step.section)
        assertEquals("Sous pression", step.mode)
        assertEquals(listOf(CookDuration(300, "5 min", null), CookDuration(1500, "25 min", "t1")), step.durations)
        assertEquals(CookTimer("t1", "Cuisson · ét. 2 · Mijoté de l…", 1500, 62, false, 2), cook.timers[0])
        assertEquals(CookTimer("t2", "Écrans", 1800, 0, true, null), cook.timers[1])
    }

    @Test
    fun plusDeModeCuisine() {
        assertNull(parseCookView("""{"cook":null}"""))
    }

    @Test
    fun recetteSansEtapes() {
        val cook = parseCookView("""{"cook":{"rev":1,"recipeId":"r1","title":"Vide","index":0,"total":0,"step":null,"next":null,"timers":[]}}""")!!
        assertNull(cook.step)
        assertNull(cook.next)
    }

    @Test
    fun miseEnPageInchangeeParLeDecompte() {
        val cook = parseCookView(view)!!
        val later = cook.copy(timers = cook.timers.map { it.copy(remainingSeconds = it.remainingSeconds - 5) })
        assertEquals(cook.layoutKey, later.layoutKey)
        val ringing = cook.copy(timers = cook.timers.map { it.copy(ended = true) })
        assertTrue(cook.layoutKey != ringing.layoutKey)
        assertTrue(cook.layoutKey != cook.copy(rev = 8).layoutKey)
    }

    @Test
    fun evenementsCook() {
        val json = """{"events":[{"seq":1,"kind":"voice","id":"v"},{"seq":2,"kind":"cook","id":"c1"},{"seq":3,"kind":"key","id":"k","keys":["ok"]}],"last":3}"""
        assertEquals(listOf("c1"), cookEventIds(json))
    }

    @Test
    fun corpsDesRequetes() {
        assertEquals("""{"index":2}""", stepJson(2))
        assertEquals("""{"index":0}""", stepJson(-1))
        assertEquals("""{"seconds":1500}""", timerJson(1500))
    }

    @Test
    fun decompte() {
        val timer = CookTimer("t", "Cuisson", 300, 62, false, null)
        assertEquals(62, remainingAfter(timer, 0))
        assertEquals(60, remainingAfter(timer, 2_500))
        assertEquals(0, remainingAfter(timer, 90_000))
        assertEquals("1:02", cookClock(62))
        assertEquals("0:05", cookClock(5))
        assertEquals("1:02:03", cookClock(3723))
        assertEquals("0:00", cookClock(-3))
    }

    @Test
    fun tailleDuTexte() {
        assertEquals(46f, stepTextSize(40))
        assertEquals(34f, stepTextSize(200))
        assertEquals(24f, stepTextSize(900))
    }

    @Test
    fun touches() {
        assertEquals(CookKey.PREVIOUS, cookKey(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(CookKey.NEXT, cookKey(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertEquals(CookKey.NEXT, cookKey(KeyEvent.KEYCODE_MEDIA_NEXT))
        assertEquals(CookKey.CLOSE, cookKey(KeyEvent.KEYCODE_BACK))
        assertEquals(CookKey.OTHER, cookKey(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals(CookKey.OTHER, cookKey(KeyEvent.KEYCODE_DPAD_DOWN))
    }
}
