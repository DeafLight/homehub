// Tests du volume annoncé à HomeHub : fixe si le système le dit ou si le son sort par une barre de son (HDMI ARC,
// eARC), réglable sinon (haut-parleurs de la télé, HDMI simple).
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class VolumeTest {
    @Test
    fun volumeFixeOuReglable() {
        val speaker = 2 // AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
        val hdmi = 9 // AudioDeviceInfo.TYPE_HDMI
        assertEquals("adjustable", volumeMode(false, listOf(speaker, hdmi)))
        assertEquals("fixed", volumeMode(false, listOf(speaker, AudioOutputs.HDMI_ARC)))
        assertEquals("fixed", volumeMode(false, listOf(AudioOutputs.HDMI_EARC)))
        assertEquals("fixed", volumeMode(true, listOf(speaker)))
        assertEquals("adjustable", volumeMode(false, emptyList()))
    }
}
