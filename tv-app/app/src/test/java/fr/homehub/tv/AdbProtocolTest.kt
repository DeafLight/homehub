// Tests JVM du protocole adb : en-tête (petit-boutiste, somme des octets, commande inversée), aller-retour d'un message,
// en-tête corrompu, signature du jeton vérifiable comme le fait adbd, clé publique au format d'Android.
package fr.homehub.tv

import java.io.ByteArrayInputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.util.Base64
import javax.crypto.Cipher
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AdbProtocolTest {
    private val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()

    @Test
    fun enTeteEtAllerRetour() {
        val frame = encodeAdb(adbConnect())
        val head = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(Adb.CNXN, head.getInt(0))
        assertEquals(Adb.VERSION, head.getInt(4))
        assertEquals(Adb.MAX_PAYLOAD, head.getInt(8))
        assertEquals("host::\u0000".length, head.getInt(12))
        assertEquals(adbChecksum("host::\u0000".toByteArray()), head.getInt(16))
        assertEquals(Adb.CNXN.inv(), head.getInt(20))
        assertEquals("CNXN", String(frame, 0, 4, Charsets.US_ASCII))

        val back = readAdb(ByteArrayInputStream(frame))
        assertEquals(Adb.CNXN, back.command)
        assertEquals("host::", back.text())
    }

    @Test
    fun deuxMessagesPuisFinDeFlux() {
        val stream = ByteArrayInputStream(encodeAdb(AdbMessage(Adb.OKAY, 7, 1)) + encodeAdb(AdbMessage(Adb.WRTE, 7, 1, "ok\n".toByteArray())))
        assertEquals(Adb.OKAY, readAdb(stream).command)
        assertEquals("ok\n", readAdb(stream).text())
        assertNull(readAdbOrNull(stream))
    }

    @Test(expected = IllegalStateException::class)
    fun enTeteCorrompu() {
        val frame = encodeAdb(AdbMessage(Adb.OKAY, 1, 2))
        frame[20] = 0
        readAdb(ByteArrayInputStream(frame))
    }

    @Test
    fun signatureDuJetonCommeAdbdLaVerifie() {
        val token = ByteArray(20) { it.toByte() }
        val signature = adbSign(keys.private, token)
        assertEquals(256, signature.size)
        // adbd : RSA_verify(NID_sha1, jeton, …) = bloc PKCS#1 de type 1 contenant DigestInfo SHA-1 + jeton.
        val block = Cipher.getInstance("RSA/ECB/NoPadding").run {
            init(Cipher.DECRYPT_MODE, keys.public)
            doFinal(signature)
        }
        assertEquals(0, block[0].toInt())
        assertEquals(1, block[1].toInt())
        assertArrayEquals(Adb.SHA1_DIGEST_INFO + token, block.copyOfRange(block.size - 35, block.size))
        val verify = Signature.getInstance("NONEwithRSA").apply {
            initVerify(keys.public)
            update(Adb.SHA1_DIGEST_INFO + token)
        }
        assertTrue(verify.verify(signature))
    }

    @Test
    fun clePubliqueAuFormatAndroid() {
        val text = adbPublicKey(keys.public as RSAPublicKey, "homehub-tv@essai").toString(Charsets.UTF_8)
        assertTrue(text.endsWith(" homehub-tv@essai\u0000"))
        val raw = Base64.getDecoder().decode(text.substringBefore(' '))
        assertEquals(4 + 4 + 256 + 256 + 4, raw.size)
        val b = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(64, b.getInt(0))
        val modulus = BigInteger(1, raw.copyOfRange(8, 264).reversedArray())
        val n = (keys.public as RSAPublicKey).modulus
        assertEquals(n, modulus)
        // n0inv × n ≡ -1 (mod 2^32)
        val n0inv = b.getInt(4).toLong() and 0xffffffffL
        assertEquals(0xffffffffL, (BigInteger.valueOf(n0inv) * n).mod(BigInteger.ONE.shiftLeft(32)).toLong())
        val rr = BigInteger(1, raw.copyOfRange(264, 520).reversedArray())
        assertEquals(BigInteger.ONE.shiftLeft(4096).mod(n), rr)
        assertEquals(65537, b.getInt(520))
    }

    @Test
    fun petitBoutiste() {
        assertArrayEquals(byteArrayOf(0x02, 0x01, 0, 0), littleEndian(BigInteger.valueOf(0x0102), 4))
    }
}
