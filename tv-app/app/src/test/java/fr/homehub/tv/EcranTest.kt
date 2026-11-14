// Tests JVM de l'adresse de l'écran de veille : page /ecran de HomeHub, jeton après « # » (encodé), rien sans adresse
// ou sans appairage.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EcranTest {
    @Test
    fun adresseDeLaPageAvecLeJeton() {
        assertEquals("http://192.168.1.10:3000/ecran#token=abc-123", Ecran.url("http://192.168.1.10:3000", "abc-123"))
        assertEquals("https://homehub.exemple/ecran#token=a%2Bb%2Fc%3D", Ecran.url("https://homehub.exemple/", "a+b/c="))
    }

    @Test
    fun rienSansAdresseNiAppairage() {
        assertNull(Ecran.url(null, "jeton"))
        assertNull(Ecran.url("http://192.168.1.10:3000", null))
        assertNull(Ecran.url(" ", "jeton"))
    }
}
