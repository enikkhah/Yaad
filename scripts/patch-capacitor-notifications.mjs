import fs from 'fs';
import path from 'path';

const pluginDir = path.resolve(
  process.cwd(),
  'node_modules/@capacitor/local-notifications/android/src/main/kotlin/com/capacitorjs/plugins/localnotifications'
);

if (!fs.existsSync(pluginDir)) {
  console.log('[patch-capacitor-notifications] Plugin directory not found, skipping patch.');
  process.exit(0);
}

// 1. Patch NotificationAction.kt to support foreground boolean property (default false for background action buttons)
const notificationActionContent = `package com.capacitorjs.plugins.localnotifications

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import org.json.JSONObject

/**
 * Action types that will be registered for the notifications.
 */
class NotificationAction {

    var id: String? = null
    var title: String? = null
    private var input: Boolean? = null
    private var foreground: Boolean? = null

    constructor()

    constructor(id: String?, title: String?, input: Boolean?, foreground: Boolean? = false) {
        this.id = id
        this.title = title
        this.input = input
        this.foreground = foreground
    }

    fun isInput(): Boolean = input == true

    fun setInput(input: Boolean?) {
        this.input = input
    }

    fun isForeground(): Boolean = foreground == true

    fun setForeground(foreground: Boolean?) {
        this.foreground = foreground
    }

    companion object {
        fun buildTypes(types: JSArray): Map<String, Array<NotificationAction>>? {
            val actionTypeMap = HashMap<String, Array<NotificationAction>>()
            try {
                val objects = types.toList<JSONObject>()
                for (obj in objects) {
                    val jsObject = JSObject.fromJSONObject(obj)
                    val actionGroupId = jsObject.getString("id") ?: return null
                    val actions = jsObject.getJSONArray("actions")
                    if (actions != null) {
                        val typesArray = Array(actions.length()) { i ->
                            val action = JSObject.fromJSONObject(actions.getJSONObject(i))
                            val fg = if (action.has("foreground")) action.getBoolean("foreground", false) ?: false else false
                            NotificationAction(
                                action.getString("id"),
                                action.getString("title"),
                                action.getBool("input"),
                                fg
                            )
                        }
                        actionTypeMap[actionGroupId] = typesArray
                    }
                }
            } catch (e: Exception) {
                Logger.error(Logger.tags("LN"), "Error when building action types", e)
            }
            return actionTypeMap
        }
    }
}
`;

// 2. Patch NotificationStorage.kt to persist foreground flag for action buttons
const notificationStoragePath = path.join(pluginDir, 'NotificationStorage.kt');
let notificationStorageContent = fs.readFileSync(notificationStoragePath, 'utf8');
if (!notificationStorageContent.includes('foreground$i')) {
  notificationStorageContent = notificationStorageContent
    .replace(
      `editor.putBoolean("input$i", notificationActions[i].isInput())`,
      `editor.putBoolean("input$i", notificationActions[i].isInput())\n                editor.putBoolean("foreground$i", notificationActions[i].isForeground())`
    )
    .replace(
      `val input = storage.getBoolean("input$i", false)\n            NotificationAction(id, title, input)`,
      `val input = storage.getBoolean("input$i", false)\n            val foreground = storage.getBoolean("foreground$i", false)\n            NotificationAction(id, title, input, foreground)`
    );
}

// 3. Patch LocalNotificationManager.kt so background action buttons use PendingIntent.getBroadcast instead of PendingIntent.getActivity
const managerPath = path.join(pluginDir, 'LocalNotificationManager.kt');
let managerContent = fs.readFileSync(managerPath, 'utf8');
const targetActionLoop = `        // Build action types
        val actionTypeId = localNotification.actionTypeId
        if (actionTypeId != null) {
            val actionGroup = storage.getActionGroup(actionTypeId)
            for (notificationAction in actionGroup) {
                val actionIntent = buildIntent(localNotification, notificationAction.id)
                val actionPendingIntent = PendingIntent.getActivity(
                    context,
                    id + (notificationAction.id?.hashCode() ?: 0),
                    actionIntent,
                    flags
                )
                val actionBuilder = NotificationCompat.Action.Builder(
                    R.drawable.ic_transparent,
                    notificationAction.title,
                    actionPendingIntent
                )
                if (notificationAction.isInput()) {
                    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(notificationAction.title).build()
                    actionBuilder.addRemoteInput(remoteInput)
                }
                mBuilder.addAction(actionBuilder.build())
            }
        }`;

const replacementActionLoop = `        // Build action types (use PendingIntent.getBroadcast when foreground is false so app never opens on button click)
        val actionTypeId = localNotification.actionTypeId
        if (actionTypeId != null) {
            val actionGroup = storage.getActionGroup(actionTypeId)
            for (notificationAction in actionGroup) {
                val isForegroundAction = notificationAction.isForeground() &&
                    notificationAction.id != "done" &&
                    notificationAction.id != "snooze" &&
                    notificationAction.id != "stop" &&
                    notificationAction.id != "dismiss" &&
                    notificationAction.id != "complete"

                val actionPendingIntent = if (isForegroundAction) {
                    val actionIntent = buildIntent(localNotification, notificationAction.id)
                    PendingIntent.getActivity(
                        context,
                        id + (notificationAction.id?.hashCode() ?: 0),
                        actionIntent,
                        flags
                    )
                } else {
                    val broadcastIntent = Intent(context, NotificationDismissReceiver::class.java)
                    broadcastIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
                    broadcastIntent.putExtra(ACTION_INTENT_KEY, notificationAction.id)
                    broadcastIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                    PendingIntent.getBroadcast(
                        context,
                        id + (notificationAction.id?.hashCode() ?: 0),
                        broadcastIntent,
                        flags
                    )
                }
                val actionBuilder = NotificationCompat.Action.Builder(
                    R.drawable.ic_transparent,
                    notificationAction.title,
                    actionPendingIntent
                )
                if (!isForegroundAction) {
                    actionBuilder.setShowsUserInterface(false)
                }
                if (notificationAction.isInput()) {
                    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(notificationAction.title).build()
                    actionBuilder.addRemoteInput(remoteInput)
                }
                mBuilder.addAction(actionBuilder.build())
            }
        }`;

if (managerContent.includes(targetActionLoop)) {
  managerContent = managerContent.replace(targetActionLoop, replacementActionLoop);
}

// 4. Patch NotificationDismissReceiver.kt to handle background action button clicks without launching MainActivity
const dismissReceiverContent = `package com.capacitorjs.plugins.localnotifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.getcapacitor.CapConfig
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import java.util.Date

/**
 * Receiver called when a notification is dismissed or when a background action button (foreground: false) is clicked.
 */
class NotificationDismissReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val intExtra = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (intExtra == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "Invalid notification operation", null)
            return
        }

        val actionId = intent.getStringExtra(LocalNotificationManager.ACTION_INTENT_KEY) ?: "dismiss"
        val storage = NotificationStorage(context)

        if (actionId == "dismiss") {
            val existing = storage.getSavedNotification(intExtra.toString())
            if (LocalNotificationManager.isSafeToForget(existing)) {
                storage.deleteNotification(intExtra.toString())
            }
            return
        }

        // Background action button clicked (e.g., done, snooze, stop) — NEVER launch MainActivity!
        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.cancel(intExtra)

        var requestJson: JSObject? = null
        val notificationJsonString = intent.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY)
        if (notificationJsonString != null) {
            try {
                requestJson = JSObject(notificationJsonString)
            } catch (e: Exception) {
            }
        }
        if (requestJson == null) {
            requestJson = storage.getSavedNotificationAsJSObject(intExtra.toString())
        }

        val reminderId = requestJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""

        // Cancel all repeating notifications and scheduled alarms associated with this reminder
        cancelAllRelatedNotifications(context, storage, notificationManager, intExtra, reminderId)

        val dataJson = JSObject()
        val results = RemoteInput.getResultsFromIntent(intent)
        if (results != null) {
            val input = results.getCharSequence(LocalNotificationManager.REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        dataJson.put("actionId", actionId)
        if (requestJson != null) {
            dataJson.put("notification", requestJson)
        } else {
            val fallbackNotif = JSObject()
            fallbackNotif.put("id", intExtra)
            dataJson.put("notification", fallbackNotif)
        }

        val dispatched = LocalNotificationsPlugin.fireActionPerformed(dataJson)
        if (!dispatched) {
            // App WebView is not currently running: queue action for next app open
            LocalNotificationsPlugin.queueBackgroundAction(context, dataJson)

            // If user tapped Snooze while app was killed, natively schedule the snoozed notification for 15 minutes later
            if (actionId == "snooze" && requestJson != null) {
                try {
                    val snoozedJson = JSObject(requestJson.toString())
                    val newAtMs = System.currentTimeMillis() + 15L * 60L * 1000L
                    val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                    sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                    val scheduleObj = JSObject()
                    scheduleObj.put("at", sdf.format(Date(newAtMs)))
                    scheduleObj.put("allowWhileIdle", true)
                    snoozedJson.put("schedule", scheduleObj)

                    val localNotif = LocalNotification.buildNotificationFromJSObject(snoozedJson)
                    val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                    manager.schedule(null, listOf(localNotif))
                    storage.appendNotifications(listOf(localNotif))
                } catch (e: Exception) {
                    Logger.error(Logger.tags("LN"), "Failed to schedule native background snooze", e)
                }
            }
        }
    }

    private fun cancelAllRelatedNotifications(
        context: Context,
        storage: NotificationStorage,
        notificationManager: NotificationManagerCompat,
        primaryId: Int,
        reminderId: String
    ) {
        val idsToCancel = HashSet<Int>()
        idsToCancel.add(primaryId)

        // Also compute deterministic baseId and 25 repeat IDs if reminderId is present
        if (reminderId.isNotEmpty()) {
            var hash = 0
            for (i in 0 until reminderId.length) {
                hash = (hash * 31 + reminderId[i].code) and 0x7fffffff
            }
            val baseId = if (hash == 0) 1 else hash
            idsToCancel.add(baseId)
            for (index in 0 until 25) {
                val repeatId = ((baseId.toLong() + 1000L + index.toLong() + 1L) % 2147483647L).toInt()
                idsToCancel.add(repeatId)
            }
        }

        // Check all saved notifications in storage for matching reminderId
        for (savedIdStr in storage.getSavedNotificationIds()) {
            val savedId = savedIdStr.toIntOrNull() ?: continue
            val savedJson = storage.getSavedNotificationAsJSObject(savedIdStr)
            val savedRemId = savedJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
            if (reminderId.isNotEmpty() && savedRemId == reminderId) {
                idsToCancel.add(savedId)
            }
        }

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        var flags = PendingIntent.FLAG_NO_CREATE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }

        for (id in idsToCancel) {
            notificationManager.cancel(id)
            val alarmIntent = Intent(context, TimedNotificationPublisher::class.java)
            val pi = PendingIntent.getBroadcast(context, id, alarmIntent, flags)
            if (pi != null) {
                alarmManager.cancel(pi)
                pi.cancel()
            }
            storage.deleteNotification(id.toString())
        }
    }
}
`;

// 5. Patch LocalNotificationsPlugin.kt to add fireActionPerformed and background action queue
const pluginPath = path.join(pluginDir, 'LocalNotificationsPlugin.kt');
let pluginContent = fs.readFileSync(pluginPath, 'utf8');
if (!pluginContent.includes('fireActionPerformed')) {
  pluginContent = pluginContent
    .replace(
      `        LegacyNotificationMigrator.run(context, notificationStorage, manager)\n    }`,
      `        LegacyNotificationMigrator.run(context, notificationStorage, manager)\n        flushQueuedBackgroundActions()\n    }\n\n    private fun flushQueuedBackgroundActions() {\n        try {\n            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)\n            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return\n            prefs.edit().remove(BG_ACTION_KEY).apply()\n            val arr = JSONArray(raw)\n            for (i in 0 until arr.length()) {\n                val itemStr = arr.optString(i, null) ?: continue\n                val itemJson = JSObject(itemStr)\n                notifyListeners("localNotificationActionPerformed", itemJson, true)\n            }\n        } catch (e: Exception) {\n        }\n    }`
    )
    .replace(
      `    internal fun dispatchReceived(notification: JSObject?) {\n        notifyListeners("localNotificationReceived", notification, true)\n    }`,
      `    internal fun dispatchReceived(notification: JSObject?) {\n        notifyListeners("localNotificationReceived", notification, true)\n    }\n\n    internal fun dispatchActionPerformed(dataJson: JSObject) {\n        notifyListeners("localNotificationActionPerformed", dataJson, true)\n    }`
    )
    .replace(
      `        fun fireReceived(notification: JSObject?) {\n            getLocalNotificationsInstance()?.dispatchReceived(notification)\n        }`,
      `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"\n        private const val BG_ACTION_KEY = "queued_actions"\n\n        fun fireReceived(notification: JSObject?) {\n            getLocalNotificationsInstance()?.dispatchReceived(notification)\n        }\n\n        fun fireActionPerformed(dataJson: JSObject): Boolean {\n            val instance = getLocalNotificationsInstance()\n            if (instance != null) {\n                instance.dispatchActionPerformed(dataJson)\n                return true\n            }\n            return false\n        }\n\n        fun queueBackgroundAction(context: Context, dataJson: JSObject) {\n            try {\n                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)\n                val existing = prefs.getString(BG_ACTION_KEY, "[]")\n                val arr = JSONArray(existing)\n                arr.put(dataJson.toString())\n                prefs.edit().putString(BG_ACTION_KEY, arr.toString()).apply()\n            } catch (e: Exception) {\n            }\n        }`
    );
}

fs.writeFileSync(path.join(pluginDir, 'NotificationAction.kt'), notificationActionContent, 'utf8');
fs.writeFileSync(notificationStoragePath, notificationStorageContent, 'utf8');
fs.writeFileSync(managerPath, managerContent, 'utf8');
fs.writeFileSync(path.join(pluginDir, 'NotificationDismissReceiver.kt'), dismissReceiverContent, 'utf8');
fs.writeFileSync(pluginPath, pluginContent, 'utf8');

console.log('[patch-capacitor-notifications] Successfully patched @capacitor/local-notifications for background actions.');
