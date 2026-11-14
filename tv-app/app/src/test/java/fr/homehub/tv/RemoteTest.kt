// Tests JVM du langage de l'injecteur et des touches : noms de shared/screen.ts → codes Android, lignes d'ordre et de
// réponse, texte sans accents, commande de lancement par app_process.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteTest {
    @Test
    fun touchesConnuesSeulement() {
        assertEquals(listOf(20, 20, 22, 23), RemoteKeys.codes(listOf("down", "down", "right", "ok")))
        assertEquals(listOf(4, 3, 85, 127, 24, 25, 164), RemoteKeys.codes(listOf("back", "home", "playpause", "pause", "volup", "voldown", "mute")))
        assertEquals(listOf(19), RemoteKeys.codes(listOf("saut", "up")))
        // Les noms de shared/screen.ts (REMOTE_KEYS) ont tous un code.
        assertEquals(12, RemoteKeys.CODES.size)
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
    fun lancementDeLInjecteur() {
        assertEquals("CLASSPATH=/data/app/x/base.apk app_process / fr.homehub.tv.Injecteur", injectorShell("/data/app/x/base.apk"))
        assertEquals(Injecteur::class.java.name, INJECTOR_CLASS)
    }
}
