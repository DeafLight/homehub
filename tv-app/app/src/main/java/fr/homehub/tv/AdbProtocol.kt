// Protocole adb, écrit à la main (sans bibliothèque) pour que l'appli parle à l'adb de sa propre télé (127.0.0.1:5555) :
// messages de 24 octets en petit-boutiste (commande, deux arguments, longueur, somme des octets, commande inversée)
// suivis des données ; poignée de main CNXN, authentification par clé RSA (AUTH : signature d'un jeton, sinon envoi de
// la clé publique, que la télé fait accepter à la télécommande), puis un flux (OPEN, WRTE, OKAY, CLSE). Fonctions pures
// et cryptographie standard de Java : testées sur la JVM (AdbProtocolTest).
package fr.homehub.tv

import java.io.DataInputStream
import java.io.EOFException
import java.io.InputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.util.Base64

object Adb {
    const val CNXN = 0x4e584e43
    const val AUTH = 0x48545541
    const val OPEN = 0x4e45504f
    const val OKAY = 0x59414b4f
    const val CLSE = 0x45534c43
    const val WRTE = 0x45545257

    const val AUTH_TOKEN = 1
    const val AUTH_SIGNATURE = 2
    const val AUTH_RSAPUBLICKEY = 3

    /** Version du protocole : la plus ancienne, que tout adbd comprend (somme des octets toujours calculée). */
    const val VERSION = 0x01000000
    const val MAX_PAYLOAD = 256 * 1024
    const val HEADER_SIZE = 24

    /** Préfixe DigestInfo de SHA-1 : adbd vérifie la signature du jeton comme celle d'une empreinte SHA-1. */
    val SHA1_DIGEST_INFO = byteArrayOf(0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14)

    fun name(command: Int): String = when (command) {
        CNXN -> "CNXN"
        AUTH -> "AUTH"
        OPEN -> "OPEN"
        OKAY -> "OKAY"
        CLSE -> "CLSE"
        WRTE -> "WRTE"
        else -> "0x%08x".format(command)
    }
}

class AdbMessage(val command: Int, val arg0: Int, val arg1: Int, val data: ByteArray = ByteArray(0)) {
    override fun toString() = "${Adb.name(command)}($arg0, $arg1, ${data.size} o)"

    /** Données lues comme texte (sans le zéro final des chaînes adb). */
    fun text(): String = data.toString(Charsets.UTF_8).trimEnd('\u0000')
}

/** Somme des octets des données, comme adbd la vérifie (versions anciennes du protocole). */
fun adbChecksum(data: ByteArray): Int = data.fold(0) { sum, b -> sum + (b.toInt() and 0xff) }

/** Message prêt à écrire sur la connexion : en-tête puis données. */
fun encodeAdb(message: AdbMessage): ByteArray {
    val buffer = ByteBuffer.allocate(Adb.HEADER_SIZE + message.data.size).order(ByteOrder.LITTLE_ENDIAN)
    buffer.putInt(message.command)
    buffer.putInt(message.arg0)
    buffer.putInt(message.arg1)
    buffer.putInt(message.data.size)
    buffer.putInt(adbChecksum(message.data))
    buffer.putInt(message.command.inv())
    buffer.put(message.data)
    return buffer.array()
}

/** Lit un message ; erreur sur un en-tête incohérent, EOFException en fin de flux. */
fun readAdb(input: InputStream): AdbMessage {
    val data = DataInputStream(input)
    val head = ByteArray(Adb.HEADER_SIZE)
    data.readFully(head)
    val buffer = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN)
    val command = buffer.int
    val arg0 = buffer.int
    val arg1 = buffer.int
    val length = buffer.int
    buffer.int // somme des octets : pas vérifiée (adbd récent envoie 0)
    val magic = buffer.int
    if (magic != command.inv()) throw IllegalStateException("message adb mal formé")
    if (length < 0 || length > 16 * 1024 * 1024) throw IllegalStateException("message adb trop long")
    val payload = ByteArray(length)
    data.readFully(payload)
    return AdbMessage(command, arg0, arg1, payload)
}

/** Chaîne adb terminée par un zéro (« host:: », « shell:… »). */
fun adbString(text: String): ByteArray = (text + "\u0000").toByteArray(Charsets.UTF_8)

/** Message CNXN de l'appli. */
fun adbConnect(): AdbMessage = AdbMessage(Adb.CNXN, Adb.VERSION, Adb.MAX_PAYLOAD, adbString("host::"))

/**
 * Signature du jeton envoyé par la télé : RSA PKCS#1 v1.5 sur (DigestInfo SHA-1 + jeton), le jeton tenant lieu
 * d'empreinte, comme le fait le client adb du PC.
 */
fun adbSign(privateKey: PrivateKey, token: ByteArray): ByteArray =
    Signature.getInstance("NONEwithRSA").run {
        initSign(privateKey)
        update(Adb.SHA1_DIGEST_INFO)
        update(token)
        sign()
    }

/**
 * Clé publique au format d'adb (structure RSAPublicKey d'Android, en base64), suivie de « nom » et d'un zéro : longueur
 * du module en mots de 32 bits, n0inv = -1/n mod 2^32, module et R² mod n en petit-boutiste, exposant.
 */
fun adbPublicKey(key: RSAPublicKey, name: String): ByteArray {
    val words = key.modulus.bitLength() / 32
    val r32 = BigInteger.ONE.shiftLeft(32)
    val n0inv = key.modulus.mod(r32).modInverse(r32).negate().mod(r32)
    val rr = BigInteger.ONE.shiftLeft(words * 32 * 2).mod(key.modulus)
    val buffer = ByteBuffer.allocate(4 + 4 + words * 4 * 2 + 4).order(ByteOrder.LITTLE_ENDIAN)
    buffer.putInt(words)
    buffer.putInt(n0inv.toInt())
    buffer.put(littleEndian(key.modulus, words * 4))
    buffer.put(littleEndian(rr, words * 4))
    buffer.putInt(key.publicExponent.toInt())
    val encoded = Base64.getEncoder().encodeToString(buffer.array())
    return adbString("$encoded $name")
}

/** Nombre positif sur `size` octets, poids faible en premier. */
fun littleEndian(value: BigInteger, size: Int): ByteArray {
    val big = value.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
    require(big.size <= size) { "nombre trop grand" }
    return ByteArray(size) { i -> if (i < big.size) big[big.size - 1 - i] else 0 }
}

/** Lit un message, sauf fin de flux : null. */
fun readAdbOrNull(input: InputStream): AdbMessage? = try {
    readAdb(input)
} catch (_: EOFException) {
    null
}
