// Client adb de l'appli vers l'adb de sa télé (127.0.0.1:5555) : clé RSA générée une fois et gardée dans le dossier
// privé de l'appli (la télé la retient après « Toujours autoriser »), poignée de main et authentification, puis un seul
// flux « shell: » dont on écrit l'entrée et lit la sortie. Une écriture attend l'accusé (OKAY) de la précédente, comme
// le veut le protocole. Testé sur la JVM contre un faux adbd (AdbClientTest).
package fr.homehub.tv

import java.io.File
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** Clé adb de l'appli : `adbkey` (privée, PKCS#8) et `adbkey.pub` (X.509) dans `dir`, créées au premier besoin. */
object AdbKeys {
    fun loadOrCreate(dir: File): KeyPair {
        val private = File(dir, "adbkey")
        val public = File(dir, "adbkey.pub")
        val factory = KeyFactory.getInstance("RSA")
        if (private.exists() && public.exists()) {
            runCatching {
                return KeyPair(
                    factory.generatePublic(X509EncodedKeySpec(public.readBytes())),
                    factory.generatePrivate(PKCS8EncodedKeySpec(private.readBytes())),
                )
            }
        }
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        dir.mkdirs()
        private.writeBytes(pair.private.encoded)
        public.writeBytes(pair.public.encoded)
        return pair
    }
}

class AdbError(message: String) : Exception(message)

/**
 * Connexion adb ouverte et authentifiée. `onAuthorization` : la télé ne connaît pas encore la clé, elle affiche
 * « Autoriser le débogage ? » ; la connexion attend la réponse à la télécommande (au plus `authorizationMs`).
 */
class AdbConnection private constructor(private val socket: Socket) {
    private val input = socket.getInputStream().buffered()
    private val output: OutputStream = socket.getOutputStream()

    @Synchronized
    private fun send(message: AdbMessage) {
        output.write(encodeAdb(message))
        output.flush()
    }

    private fun receive(): AdbMessage = readAdbOrNull(input) ?: throw AdbError("connexion adb fermée par la télé")

    fun close() {
        runCatching { socket.close() }
    }

    /**
     * Ouvre le flux `shell:<command>` ; `onOutput` reçoit la sortie du programme au fil de l'eau (fil de lecture de la
     * connexion), `onClosed` une fois quand le flux ou la connexion tombe.
     */
    fun openShell(command: String, onOutput: (ByteArray) -> Unit, onClosed: () -> Unit): AdbStream {
        val localId = 1
        send(AdbMessage(Adb.OPEN, localId, 0, adbString("shell:$command")))
        var reply = receive()
        while (reply.command != Adb.OKAY) {
            if (reply.command == Adb.CLSE) throw AdbError("commande refusée par la télé")
            reply = receive()
        }
        val stream = AdbStream(localId, reply.arg0)
        Thread({
            try {
                while (true) {
                    val m = readAdbOrNull(input) ?: break
                    when (m.command) {
                        Adb.OKAY -> stream.acks.release()
                        Adb.WRTE -> {
                            send(AdbMessage(Adb.OKAY, localId, stream.remoteId))
                            onOutput(m.data)
                        }
                        Adb.CLSE -> break
                    }
                }
            } catch (_: Exception) {
            } finally {
                stream.closed = true
                stream.acks.release(Int.MAX_VALUE / 2)
                close()
                onClosed()
            }
        }, "adb-lecture").apply { isDaemon = true }.start()
        return stream
    }

    inner class AdbStream(private val localId: Int, val remoteId: Int) {
        internal val acks = Semaphore(0)
        @Volatile internal var closed = false

        /** Écrit sur l'entrée du programme et attend l'accusé de la télé. */
        @Synchronized
        fun write(data: ByteArray, timeoutMs: Long = 5_000) {
            if (closed) throw AdbError("flux adb fermé")
            for (start in data.indices step Adb.MAX_PAYLOAD / 4) {
                val part = data.copyOfRange(start, minOf(data.size, start + Adb.MAX_PAYLOAD / 4))
                send(AdbMessage(Adb.WRTE, localId, remoteId, part))
                if (!acks.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS) || closed) throw AdbError("la télé n’accuse pas réception")
            }
        }

        fun close() {
            runCatching { send(AdbMessage(Adb.CLSE, localId, remoteId)) }
            this@AdbConnection.close()
        }
    }

    companion object {
        /** Connexion et authentification ; lève AdbError (refus, délai) ou une IOException (adb fermé). */
        fun open(
            host: String,
            port: Int,
            keys: KeyPair,
            name: String,
            authorizationMs: Int = 120_000,
            onAuthorization: () -> Unit = {},
        ): AdbConnection {
            val socket = Socket()
            socket.connect(InetSocketAddress(host, port), 5_000)
            socket.tcpNoDelay = true
            socket.soTimeout = 10_000
            val connection = AdbConnection(socket)
            try {
                connection.send(adbConnect())
                var sentSignature = false
                var sentKey = false
                while (true) {
                    val m = connection.receive()
                    when {
                        m.command == Adb.CNXN -> {
                            socket.soTimeout = 0
                            return connection
                        }
                        m.command == Adb.AUTH && m.arg0 == Adb.AUTH_TOKEN && !sentSignature -> {
                            sentSignature = true
                            connection.send(AdbMessage(Adb.AUTH, Adb.AUTH_SIGNATURE, 0, adbSign(keys.private, m.data)))
                        }
                        m.command == Adb.AUTH && m.arg0 == Adb.AUTH_TOKEN && !sentKey -> {
                            // Clé inconnue de la télé : elle demande à la télécommande ; on attend la réponse.
                            sentKey = true
                            connection.send(AdbMessage(Adb.AUTH, Adb.AUTH_RSAPUBLICKEY, 0, adbPublicKey(keys.public as RSAPublicKey, name)))
                            socket.soTimeout = authorizationMs
                            onAuthorization()
                        }
                        m.command == Adb.AUTH -> throw AdbError("clé refusée par la télé")
                    }
                }
            } catch (e: java.net.SocketTimeoutException) {
                connection.close()
                throw AdbError(if (socket.soTimeout == authorizationMs) "« Autoriser le débogage ? » pas accepté sur la télé" else "adb ne répond pas")
            } catch (e: Exception) {
                connection.close()
                throw e
            }
        }
    }
}

/** Sortie d'un programme découpée en lignes (la dernière, incomplète, attend la suite). */
class LineSplitter(private val onLine: (String) -> Unit) {
    private val pending = StringBuilder()

    @Synchronized
    fun feed(data: ByteArray) {
        pending.append(data.toString(Charsets.UTF_8))
        while (true) {
            val end = pending.indexOf("\n")
            if (end < 0) return
            val line = pending.substring(0, end).trimEnd('\r')
            pending.delete(0, end + 1)
            onLine(line)
        }
    }
}

/** File d'attente des réponses d'un programme (une ligne par ordre). */
class Replies {
    private val queue = LinkedBlockingQueue<String>()
    fun offer(line: String) = queue.offer(line)
    fun clear() = queue.clear()
    fun take(timeoutMs: Long): String? = queue.poll(timeoutMs, TimeUnit.MILLISECONDS)
}
