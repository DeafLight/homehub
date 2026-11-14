// Volume de la télé, annoncé à HomeHub (fonction 6, shared/screen.ts : ScreenVolume) : « fixed » quand le système le
// déclare fixe ou que le son sort par une barre de son (HDMI ARC / eARC), que la télé ne règle pas ; la télécommande
// ne fait alors que la pause. Sinon « adjustable ». Fonction pure, testée sur la JVM (VolumeTest).
package fr.homehub.tv

object AudioOutputs {
    // Types de android.media.AudioDeviceInfo, recopiés pour rester testables sur la JVM.
    const val HDMI_ARC = 10
    const val HDMI_EARC = 29
}

/** « fixed » ou « adjustable », d'après `AudioManager.isVolumeFixed` et les types des sorties audio. */
fun volumeMode(fixed: Boolean, outputTypes: List<Int>): String =
    if (fixed || outputTypes.any { it == AudioOutputs.HDMI_ARC || it == AudioOutputs.HDMI_EARC }) "fixed" else "adjustable"
