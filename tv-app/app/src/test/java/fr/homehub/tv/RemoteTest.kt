// Tests JVM du langage de l'injecteur et des touches : noms de shared/screen.ts → codes Android, lignes d'ordre et de
// réponse, texte sans accents, plan de frappe (vidage du champ, pauses), commande de lancement par app_process.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteTest {
    @Test
    fun touchesConnuesSeulement() {
        assertEquals(listOf(20, 20, 22, 23), RemoteKeys.codes(listOf("down", "down", "right", "ok")))
        assertEquals(listOf(4, 3, 85, 127, 24, 25, 164, 126), RemoteKeys.codes(listOf("back", "home", "playpause", "pause", "volup", "voldown", "mute", "play")))
        assertEquals(listOf(19), RemoteKeys.codes(listOf("saut", "up")))
        // Les noms de shared/screen.ts (REMOTE_KEYS) ont tous un code.
        assertEquals(13, RemoteKeys.CODES.size)
    }

    @Test
    fun lignesDOrdre() {
        assertEquals("key 20 23", keysLine(listOf(20, 23)))
        assertEquals(InjectorCommand.Keys(listOf(20, 23)), parseCommand("key 20 23"))
        assertEquals(InjectorCommand.Text("Tele de Lea"), parseCommand(textLine("Télé de Léa")))
        assertEquals(InjectorCommand.Ping, parseCommand("ping\r"))
        assertNull(parseCommand("key"))
        assertNull(parseCommand("text pas-du-base64!"))
        assertNull(parseCommand("autre"))
    }

    @Test
    fun reponses() {
        assertEquals(InjectorReply.Ready, parseReply("ready"))
        assertEquals(InjectorReply.Ok, parseReply("ok\r"))
        assertEquals(InjectorReply.Failed("touche refusée"), parseReply("err touche refusée"))
        assertNull(parseReply("key 20"))
    }

    @Test
    fun texteSansAccents() {
        assertEquals("Ecole, coeur, ete a la plage", plainText("École, cœur, été à la plage"))
        assertEquals("deux lignes", plainText("deux\nlignes"))
    }

    @Test
    fun planDeFrappe() {
        val plan = Typing.plan("chaton")
        // D'abord le champ vidé : curseur au bout, puis assez de retours arrière, espacés.
        assertEquals(TypingStep.Key(RemoteKeys.MOVE_END), plan.first())
        val clear = plan.takeWhile { it !is TypingStep.Char }
        assertEquals(Typing.CLEAR_DELETES, clear.count { it == TypingStep.Key(RemoteKeys.DEL) })
        assertTrue(clear.zipWithNext().none { (a, b) -> a is TypingStep.Key && b is TypingStep.Key })
        // Puis les six lettres, dans l'ordre, chacune précédée d'une pause.
        val typed = plan.drop(clear.size - 1)
        assertEquals("chaton", typed.filterIsInstance<TypingStep.Char>().map { it.char }.joinToString(""))
        assertEquals(
            listOf(Typing.SETTLE_MS, Typing.SETTLE_MS, Typing.CHAR_GAP_MS, Typing.CHAR_GAP_MS, Typing.CHAR_GAP_MS, Typing.CHAR_GAP_MS),
            typed.chunked(2).map { (pause, char) -> assertTrue(char is TypingStep.Char); (pause as TypingStep.Pause).ms },
        )
        // La deuxième lettre (perdue en 0.73.1) attend que la recherche ait pris la première.
        assertTrue(Typing.SETTLE_MS >= 300)
    }

    @Test
    fun dureeDuPlan() {
        val clear = Typing.CLEAR_DELETES * Typing.KEY_GAP_MS
        assertEquals(clear, Typing.pausesMs(Typing.plan("")))
        assertEquals(clear + 2 * Typing.SETTLE_MS + 4 * Typing.CHAR_GAP_MS, Typing.pausesMs(Typing.plan("chaton")))
        // Le plus long texte accepté par le serveur (REMOTE_TEXT_MAX, 200) tient dans son attente (remoteTextReportMs).
        assertTrue(4_000 + Typing.pausesMs(Typing.plan("a".repeat(200))) < 4_000 + 1_500 + 60L * 200)
    }

    @Test
    fun lancementDeLInjecteur() {
        assertEquals("CLASSPATH=/data/app/x/base.apk app_process / fr.homehub.tv.Injecteur", injectorShell("/data/app/x/base.apk"))
        assertEquals(Injecteur::class.java.name, INJECTOR_CLASS)
    }
}
