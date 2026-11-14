// Injecteur résident de HomeHub TV : un petit programme sans écran, rangé dans l'APK et lancé par l'appli à travers
// l'adb de sa propre télé (`CLASSPATH=<APK> app_process / fr.homehub.tv.Injecteur`), comme le serveur de scrcpy. Il
// tourne sous l'identité « shell », qui a le droit d'injecter des événements : touches par
// InputManager.injectInputEvent (API cachée, atteinte par réflexion), texte changé en touches du clavier virtuel
// (KeyCharacterMap). Il lit ses ordres sur son entrée, une ligne chacun, et répond une ligne (langage : Remote.kt).
// Il ne démarre qu'une fois (environ 1 s) ; ensuite une touche coûte quelques millisecondes.
package fr.homehub.tv

import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.InputEvent
import android.view.KeyCharacterMap
import android.view.KeyEvent
import java.lang.reflect.Method

object Injecteur {
    /** INJECT_INPUT_EVENT_MODE_ASYNC : sans attendre que l'appli au premier plan ait traité la touche. */
    private const val MODE_ASYNC = 0
    /** Pause entre deux touches d'une rafale : certaines applis ignorent des touches trop rapprochées. */
    private const val KEY_GAP_MS = 12L

    @JvmStatic
    fun main(args: Array<String>) {
        runCatching { Looper.prepareMainLooper() }
        val injector = try {
            Injector()
        } catch (e: Throwable) {
            println("err injection impossible : ${e.message ?: e.javaClass.simpleName}")
            System.out.flush()
            return
        }
        println("ready")
        System.out.flush()
        val input = System.`in`.bufferedReader()
        while (true) {
            val line = input.readLine() ?: break
            val reply = try {
                when (val command = parseCommand(line)) {
                    is InjectorCommand.Keys -> command.codes.forEachIndexed { i, code ->
                        if (i > 0) Thread.sleep(KEY_GAP_MS)
                        injector.key(code)
                    }
                    is InjectorCommand.Text -> injector.text(command.text)
                    InjectorCommand.Ping -> Unit
                    null -> throw IllegalArgumentException("ordre inconnu")
                }
                "ok"
            } catch (e: Throwable) {
                "err ${e.message ?: e.javaClass.simpleName}"
            }
            println(reply)
            System.out.flush()
        }
    }

    private class Injector {
        private val manager: Any
        private val inject: Method

        init {
            // Android 14 et plus : InputManagerGlobal ; avant : InputManager.getInstance().
            manager = runCatching { Class.forName("android.hardware.input.InputManagerGlobal").getMethod("getInstance").invoke(null) }.getOrNull()
                ?: Class.forName("android.hardware.input.InputManager").getMethod("getInstance").invoke(null)!!
            inject = manager.javaClass.getMethod("injectInputEvent", InputEvent::class.java, Int::class.javaPrimitiveType)
        }

        private fun send(event: InputEvent) {
            if (inject.invoke(manager, event, MODE_ASYNC) != true) throw IllegalStateException("touche refusée par le système")
        }

        fun key(code: Int) {
            val now = SystemClock.uptimeMillis()
            send(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD))
            send(KeyEvent(now, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD))
        }

        /** Chaque caractère en touches du clavier virtuel (majuscules comprises) ; un caractère sans touche est sauté. */
        fun text(text: String) {
            val map = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD)
            for (c in text) {
                val events = map.getEvents(charArrayOf(c)) ?: continue
                for (event in events) {
                    val now = SystemClock.uptimeMillis()
                    send(KeyEvent.changeTimeRepeat(event, now, 0).also { it.source = InputDevice.SOURCE_KEYBOARD })
                }
            }
        }
    }
}
