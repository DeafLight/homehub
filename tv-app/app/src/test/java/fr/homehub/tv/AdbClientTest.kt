// Tests JVM du client adb contre un faux adbd local (ServerSocket) qui suit le vrai : jeton à signer, clé inconnue
// envoyée puis « Toujours autoriser » accepté, clé connue reconnue tout de suite ; flux « shell: » qui répond une ligne
// par ordre (comme l'injecteur) et accuse chaque écriture. Et la clé gardée d'un lancement à l'autre.
package fr.homehub.tv

import java.net.ServerSocket
import java.nio.file.Files
import java.security.KeyPair
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AdbClientTest {
    /**
     * Faux adbd : `known` les clés publiques déjà autorisées (format adb). Une clé inconnue est « acceptée à la
     * télécommande » aussitôt et retenue. Le shell répond « ready » puis « ok » à chaque ligne reçue.
     */
    private class FakeAdbd {
        val server = ServerSocket(0)
        val known = mutableSetOf<String>()
        val commands = LinkedBlockingQueue<String>()
        var prompts = 0

        fun serve() = Thread {
            val socket = server.accept()
            val input = socket.getInputStream()
            val output = socket.getOutputStream()
            val send = { m: AdbMessage -> output.write(encodeAdb(m)); output.flush() }
            val token = ByteArray(20) { (it * 7).toByte() }
            var remote = 0
            while (true) {
                val m = readAdbOrNull(input) ?: break
                when (m.command) {
                    Adb.CNXN -> send(AdbMessage(Adb.AUTH, Adb.AUTH_TOKEN, 0, token))
                    Adb.AUTH -> when (m.arg0) {
                        Adb.AUTH_SIGNATURE -> {
                            val ok = known.any { key -> verifies(key, token, m.data) }
                            send(if (ok) AdbMessage(Adb.CNXN, Adb.VERSION, Adb.MAX_PAYLOAD, adbString("device::")) else AdbMessage(Adb.AUTH, Adb.AUTH_TOKEN, 0, token))
                        }
                        Adb.AUTH_RSAPUBLICKEY -> {
                            prompts++
                            known += m.text()
                            send(AdbMessage(Adb.CNXN, Adb.VERSION, Adb.MAX_PAYLOAD, adbString("device::")))
                        }
                    }
                    Adb.OPEN -> {
                        remote = m.arg0
                        commands.offer(m.text())
                        send(AdbMessage(Adb.OKAY, 42, remote))
                        send(AdbMessage(Adb.WRTE, 42, remote, "ready\n".toByteArray()))
                    }
                    Adb.WRTE -> {
                        send(AdbMessage(Adb.OKAY, 42, remote))
                        commands.offer(m.text().trim())
                        // Réponse en deux morceaux, pour le découpage en lignes.
                        send(AdbMessage(Adb.WRTE, 42, remote, "o".toByteArray()))
                        send(AdbMessage(Adb.WRTE, 42, remote, "k\r\n".toByteArray()))
                    }
                    Adb.OKAY -> Unit
                    Adb.CLSE -> break
                }
            }
            socket.close()
        }.apply { isDaemon = true; start() }

        /** Vérifie la signature avec une clé au format adb (on retrouve le module pour comparer). */
        fun verifies(adbKey: String, token: ByteArray, signature: ByteArray): Boolean = keysByAdb[adbKey]?.let { pub ->
            Signature.getInstance("NONEwithRSA").run {
                initVerify(pub)
                update(Adb.SHA1_DIGEST_INFO + token)
                verify(signature)
            }
        } ?: false

        val keysByAdb = mutableMapOf<String, java.security.PublicKey>()
    }

    private fun shell(adbd: FakeAdbd, keys: KeyPair): List<String> {
        adbd.keysByAdb[adbPublicKey(keys.public as RSAPublicKey, "essai").toString(Charsets.UTF_8).trimEnd('\u0000')] = keys.public
        adbd.serve()
        var asked = false
        val connection = AdbConnection.open("127.0.0.1", adbd.server.localPort, keys, "essai", onAuthorization = { asked = true })
        val lines = LinkedBlockingQueue<String>()
        val splitter = LineSplitter { lines.offer(it) }
        val stream = connection.openShell(injectorShell("/data/app/fr.homehub.tv/base.apk"), splitter::feed) {}
        val got = mutableListOf(lines.poll(2, TimeUnit.SECONDS)!!)
        stream.write("ping\n".toByteArray())
        got += lines.poll(2, TimeUnit.SECONDS)!!
        stream.close()
        if (asked) got += "autorisation demandée"
        return got
    }

    @Test
    fun cleInconnuePuisAutoriseeEnsuiteReconnue() {
        val dir = Files.createTempDirectory("adbkey").toFile()
        val keys = AdbKeys.loadOrCreate(dir)
        val adbd = FakeAdbd()
        assertEquals(listOf("ready", "ok", "autorisation demandée"), shell(adbd, keys))
        assertEquals("shell:CLASSPATH=/data/app/fr.homehub.tv/base.apk app_process / fr.homehub.tv.Injecteur", adbd.commands.poll())
        assertEquals("ping", adbd.commands.poll())
        assertEquals(1, adbd.prompts)

        // Deuxième lancement : même clé relue sur le disque, la télé la connaît, pas de nouvelle demande.
        val again = AdbKeys.loadOrCreate(dir)
        assertEquals(keys.public, again.public)
        assertEquals(listOf("ready", "ok"), shell(adbd, again))
        assertEquals(1, adbd.prompts)
        assertTrue(adbd.server.localPort > 0)
    }
}
