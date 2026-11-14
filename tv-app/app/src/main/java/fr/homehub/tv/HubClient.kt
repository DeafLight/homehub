// Appels HTTP à HomeHub, sans bibliothèque (HttpURLConnection) : en-tête de version du protocole, jeton de la télé,
// réponse lue en texte ; les erreurs portent le message du serveur et son statut (401 : télé retirée).
package fr.homehub.tv

import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class HubError(val status: Int, message: String) : Exception(message)

class HubClient(private val server: String, private val token: String? = null) {

    /** GET ou POST JSON ; `readTimeoutMs` couvre l'attente longue du serveur (25 s). */
    fun call(method: String, path: String, body: String? = null, readTimeoutMs: Int = 15_000): String {
        val conn = open(path, method, readTimeoutMs)
        try {
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val text = (if (status < 400) conn.inputStream else conn.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) }
            if (status >= 400) throw HubError(status, errorMessage(status, text))
            return text ?: ""
        } finally {
            conn.disconnect()
        }
    }

    /** Télécharge `path` dans `target` (message vocal). */
    fun download(path: String, target: File) {
        val conn = open(path, "GET", 15_000)
        try {
            val status = conn.responseCode
            if (status >= 400) throw HubError(status, errorMessage(status, conn.errorStream?.use { it.readBytes().toString(Charsets.UTF_8) }))
            conn.inputStream.use { input -> target.outputStream().use { input.copyTo(it) } }
        } finally {
            conn.disconnect()
        }
    }

    private fun open(path: String, method: String, readTimeoutMs: Int): HttpURLConnection {
        val conn = URL(server + path).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 10_000
        conn.readTimeout = readTimeoutMs
        conn.setRequestProperty(Protocol.HEADER, Protocol.VERSION.toString())
        conn.setRequestProperty("Accept", "application/json")
        token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
        return conn
    }
}
