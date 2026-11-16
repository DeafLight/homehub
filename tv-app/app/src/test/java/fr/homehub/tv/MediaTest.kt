// Tests JVM du partage d'une photo ou d'une vidéo vers la télé : événements « media » lus tels que le serveur les
// envoie (shared/screen-media.ts), taille de décodage d'une photo, délai de fermeture, extension, compte rendu de
// l'écran plein écran (affichée, échec, fermée).
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaTest {
    @Test
    fun evenementsMedia() {
        val json = """{"events":[
          {"seq":5,"kind":"media","id":"m1","media":"photo","title":"Photo de Léa","url":"/api/screen/media/abc.jpg","contentType":"image/jpeg","seconds":60},
          {"seq":6,"kind":"message","id":"v1","title":"Message d’Alex","text":"Coucou","seconds":10},
          {"seq":7,"kind":"media","id":"m2","media":"video","title":"Vidéo d’Alex","url":"/api/screen/media/def.mp4","contentType":"video/mp4"}
        ],"last":7}"""
        assertEquals(
            listOf(
                MediaEvent(5, "m1", false, "Photo de Léa", "/api/screen/media/abc.jpg", "image/jpeg", 60),
                MediaEvent(7, "m2", true, "Vidéo d’Alex", "/api/screen/media/def.mp4", "video/mp4", MEDIA_VIDEO_MAX_SECONDS),
            ),
            parseMediaEvents(json),
        )
        // Les autres lecteurs ignorent ce genre : une appli plus ancienne ne casse pas.
        assertEquals(listOf("v1"), parseEvents(json).messages.map { it.id })
    }

    @Test
    fun tailleDeDecodage() {
        assertEquals(1440 to 1080, fitSize(4000, 3000, 1920, 1080))
        assertEquals(608 to 1080, fitSize(2250, 4000, 1920, 1080))
        assertEquals(800 to 600, fitSize(800, 600, 1920, 1080))
        assertEquals(1920 to 1080, fitSize(0, 0, 1920, 1080))
    }

    @Test
    fun delaisEtExtension() {
        assertEquals(60_000L, closeDelayMs(60))
        assertEquals(5_000L, closeDelayMs(0))
        assertEquals(600_000L, closeDelayMs(5_000))
        assertEquals("jpg", mediaExtension("/api/screen/media/abc.jpg"))
        assertEquals("bin", mediaExtension("/api/screen/media/abc"))
    }

    @Test
    fun compteRenduDeLEcran() {
        val event = MediaEvent(1, "m", false, "Photo", "/x.jpg", "image/jpeg", 60)
        val ok = MediaSession(event, "/tmp/x.jpg").apply { shown() }
        assertEquals(0L, ok.started.count)
        assertNull(ok.error)
        val bad = MediaSession(event, "/tmp/x.jpg").apply { failed("photo illisible") }
        assertEquals("photo illisible", bad.error)
        // Un échec après l'affichage (vidéo coupée en route) ne change plus le compte rendu.
        val late = MediaSession(event, "/tmp/x.jpg").apply { shown(); failed("coupée") }
        assertNull(late.error)
        late.close()
        assertTrue(late.closed.count == 0L)
    }
}
