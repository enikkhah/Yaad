import fs from 'fs';
import path from 'path';

const pluginRoot = path.resolve(
  process.cwd(),
  'node_modules/@capacitor/local-notifications'
);

const pluginDir = path.join(
  pluginRoot,
  'android/src/main/kotlin/com/capacitorjs/plugins/localnotifications'
);

if (!fs.existsSync(pluginDir)) {
  console.log('[patch-capacitor-notifications] Plugin directory not found, skipping patch.');
  process.exit(0);
}

// Read and log plugin version for diagnostics
let pluginVersion = 'unknown';
try {
  const pkgJsonPath = path.join(pluginRoot, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    pluginVersion = pkg.version || 'unknown';
  }
} catch {
  // ignore
}

const requiredFiles = [
  'NotificationAction.kt',
  'NotificationStorage.kt',
  'LocalNotificationManager.kt',
  'TimedNotificationPublisher.kt',
  'NotificationChannelManager.kt',
  'NotificationDismissReceiver.kt',
  'LocalNotificationsPlugin.kt',
];

for (const file of requiredFiles) {
  const fullPath = path.join(pluginDir, file);
  if (!fs.existsSync(fullPath)) {
    console.error(
      `[patch-capacitor-notifications] ERROR: Missing expected file "${file}" in @capacitor/local-notifications@${pluginVersion} (${fullPath}).`
    );
    process.exit(1);
  }
}

/**
 * Safely applies a patch to a file's content or verifies that the patch is already applied (idempotent).
 * Supports upgrading from an earlier patch revision via optional legacyAnchors.
 * Exits with code 1 if neither the original anchor nor the patched marker is found.
 */
function applyPatchOrVerify(content, fileName, stepName, origAnchor, replacement, patchedMarker, legacyAnchors = []) {
  if (content.includes(patchedMarker)) {
    return content;
  }
  if (content.includes(origAnchor)) {
    return content.replace(origAnchor, replacement);
  }
  for (const legacyAnchor of legacyAnchors) {
    if (content.includes(legacyAnchor)) {
      return content.replace(legacyAnchor, replacement);
    }
  }
  console.error(
    `[patch-capacitor-notifications] ERROR in ${fileName} (${stepName}): Expected code anchor not found in @capacitor/local-notifications@${pluginVersion}.`
  );
  process.exit(1);
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

notificationStorageContent = applyPatchOrVerify(
  notificationStorageContent,
  'NotificationStorage.kt',
  'persist foreground$i',
  `editor.putBoolean("input$i", notificationActions[i].isInput())`,
  `editor.putBoolean("input$i", notificationActions[i].isInput())\n                editor.putBoolean("foreground$i", notificationActions[i].isForeground())`,
  `editor.putBoolean("foreground$i", notificationActions[i].isForeground())`
);

notificationStorageContent = applyPatchOrVerify(
  notificationStorageContent,
  'NotificationStorage.kt',
  'read foreground$i',
  `val input = storage.getBoolean("input$i", false)\n            NotificationAction(id, title, input)`,
  `val input = storage.getBoolean("input$i", false)\n            val foreground = storage.getBoolean("foreground$i", false)\n            NotificationAction(id, title, input, foreground)`,
  `val foreground = storage.getBoolean("foreground$i", false)`
);

// 3. Patch LocalNotificationManager.kt:
// - Do NOT auto-dismiss notification on body tap (DEFAULT_PRESS_ACTION) when ongoing/persistent
// - Ensure USAGE_ALARM on default and custom sound channels
// - Apply VISIBILITY_PUBLIC, CATEGORY_ALARM, PRIORITY_MAX, and 10-minute safety timeout (setTimeoutAfter)
// - Apply FLAG_ONGOING_EVENT, FLAG_NO_CLEAR, and FLAG_INSISTENT when ongoing == true or autoCancel == false
// - Use PendingIntent.getBroadcast for background action buttons so app never opens on action button click
// - Distinguish swipe deleteIntent ("swipe_dismiss") from explicit "dismiss" button
const managerPath = path.join(pluginDir, 'LocalNotificationManager.kt');
let managerContent = fs.readFileSync(managerPath, 'utf8');

const origHandleAction = `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        if (isSafeToForget(existing)) {
            notificationStorage.deleteNotification(notificationId.toString())
        }
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        dismissVisibleNotification(notificationId)`;

const patchedHandleAction = `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        // Do NOT dismiss or delete persistent/ongoing notification when user taps the notification body ("tap"):
        // Notification must stay in status bar until user explicitly taps Done, Snooze, Edit, or Dismiss!
        val isBodyTapOnPersistent = (menuAction == DEFAULT_PRESS_ACTION || menuAction == null) &&
            (existing?.ongoing == true || existing?.autoCancel == false)
        if (!isBodyTapOnPersistent) {
            if (isSafeToForget(existing)) {
                notificationStorage.deleteNotification(notificationId.toString())
            }
            dismissVisibleNotification(notificationId)
            cancelMuteTimerForNotification(notificationId)
            YaadAlarmPopupActivity.dismissIfMatching(notificationId)
        }`;

const legacyHandleActionV1 = `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        // Do NOT dismiss or delete persistent/ongoing notification when user taps the notification body ("tap"):
        // Notification must stay in status bar until user explicitly taps Done, Snooze, or Dismiss!
        val isBodyTapOnPersistent = (menuAction == DEFAULT_PRESS_ACTION || menuAction == null) &&
            (existing?.ongoing == true || existing?.autoCancel == false)
        if (!isBodyTapOnPersistent) {
            if (isSafeToForget(existing)) {
                notificationStorage.deleteNotification(notificationId.toString())
            }
            dismissVisibleNotification(notificationId)
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'handleNotificationActionPerformed persistent body tap',
  origHandleAction,
  patchedHandleAction,
  'YaadAlarmPopupActivity.dismissIfMatching(notificationId)',
  [
    legacyHandleActionV1,
    `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        // Do NOT dismiss or delete persistent/ongoing notification when user taps the notification body ("tap"):
        // Notification must stay in status bar until user explicitly taps Done, Snooze, Edit, or Dismiss!
        val isBodyTapOnPersistent = (menuAction == DEFAULT_PRESS_ACTION || menuAction == null) &&
            (existing?.ongoing == true || existing?.autoCancel == false)
        if (!isBodyTapOnPersistent) {
            if (isSafeToForget(existing)) {
                notificationStorage.deleteNotification(notificationId.toString())
            }
            dismissVisibleNotification(notificationId)
            cancelMuteTimerForNotification(notificationId)
        }`,
  ]
);

const origRequestFallback = `        try {
            val notificationJsonString = data.getStringExtra(NOTIFICATION_OBJ_INTENT_KEY)
            if (notificationJsonString != null) {
                request = JSObject(notificationJsonString)
            }
        } catch (e: JSONException) {
        }
        dataJson.put("notification", request)`;

const patchedRequestFallback = `        try {
            val notificationJsonString = data.getStringExtra(NOTIFICATION_OBJ_INTENT_KEY)
            if (notificationJsonString != null) {
                request = JSObject(notificationJsonString)
            }
        } catch (e: JSONException) {
        }
        if (request == null && existing?.source != null) {
            try {
                request = JSObject(existing.source)
            } catch (e: JSONException) {
            }
        }
        dataJson.put("notification", request)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'handleNotificationActionPerformed fallback to existing.source',
  origRequestFallback,
  patchedRequestFallback,
  'if (request == null && existing?.source != null)'
);

// Replace any USAGE_NOTIFICATION in LocalNotificationManager.kt (both createNotificationChannel and soundChannelId) with USAGE_ALARM
if (managerContent.includes('.setUsage(AudioAttributes.USAGE_NOTIFICATION)')) {
  managerContent = managerContent.replaceAll(
    '.setUsage(AudioAttributes.USAGE_NOTIFICATION)',
    '.setUsage(AudioAttributes.USAGE_ALARM)'
  );
}
if (!managerContent.includes('.setUsage(AudioAttributes.USAGE_ALARM)')) {
  console.error(
    `[patch-capacitor-notifications] ERROR in LocalNotificationManager.kt: AudioAttributes.USAGE_ALARM could not be configured.`
  );
  process.exit(1);
}

const origBuildFlags = `        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        mBuilder.setOnlyAlertOnce(true)`;

const legacyBuildFlags = `        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        mBuilder.setOnlyAlertOnce(!localNotification.ongoing)
        if (localNotification.ongoing) {
            mBuilder.setCategory(NotificationCompat.CATEGORY_ALARM)
            mBuilder.setPriority(NotificationCompat.PRIORITY_MAX)
        }`;

const legacyBuildFlagsV2 = `        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        mBuilder.setOnlyAlertOnce(!localNotification.ongoing)
        if (localNotification.ongoing) {
            mBuilder.setCategory(NotificationCompat.CATEGORY_ALARM)
            mBuilder.setPriority(NotificationCompat.PRIORITY_MAX)
            mBuilder.setTimeoutAfter(10 * 60 * 1000L)
        }`;

const patchedBuildFlags = `        val isSilentChannel = channelId == "yaad_channel_v2_silent"
        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        if (isSilentChannel) {
            mBuilder.setSilent(true)
            mBuilder.setOnlyAlertOnce(true)
            mBuilder.setDefaults(0)
            mBuilder.setSound(null)
        } else {
            mBuilder.setOnlyAlertOnce(!localNotification.ongoing)
        }
        if (localNotification.ongoing) {
            mBuilder.setCategory(NotificationCompat.CATEGORY_ALARM)
            mBuilder.setPriority(NotificationCompat.PRIORITY_MAX)
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'buildNotification visibility, category, priority, and silent channel handling',
  origBuildFlags,
  patchedBuildFlags,
  'val isSilentChannel = channelId == "yaad_channel_v2_silent"',
  [legacyBuildFlags, legacyBuildFlagsV2]
);

const origBuildNotif = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()`;

const legacyBuildNotifV1 = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                Notification.FLAG_INSISTENT
        }`;

const legacyBuildNotifV2 = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                Notification.FLAG_INSISTENT
        }`;

const legacyBuildNotifV3 = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }`;

const patchedBuildNotif = `        createActionIntents(localNotification, mBuilder)
        if (!isSilentChannel && (localNotification.ongoing || !localNotification.autoCancel)) {
            localNotification.id?.let { notifId ->
                val fullScreenIntent = Intent(context, YaadAlarmPopupActivity::class.java)
                fullScreenIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                fullScreenIntent.putExtra(NOTIFICATION_INTENT_KEY, notifId)
                fullScreenIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                var fsFlags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    fsFlags = fsFlags or PendingIntent.FLAG_MUTABLE
                }
                val fullScreenPendingIntent = PendingIntent.getActivity(
                    context,
                    notifId + 700000,
                    fullScreenIntent,
                    fsFlags
                )
                mBuilder.setFullScreenIntent(fullScreenPendingIntent, true)
            }
        }
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'buildNotification fullScreenIntent, FLAG_INSISTENT and silent mode',
  origBuildNotif,
  patchedBuildNotif,
  'mBuilder.setFullScreenIntent(fullScreenPendingIntent, true)',
  [legacyBuildNotifV2, legacyBuildNotifV3, legacyBuildNotifV1]
);

const origImmediateNotify = `            try {
                val notificationJson = JSObject(localNotification.source ?: "{}")
                LocalNotificationsPlugin.fireReceived(notificationJson)
            } catch (e: JSONException) {
            }
            localNotification.id?.let { notificationManager.notify(it, buildNotification) }`;

const legacyImmediateNotifyV1 = `            if (!isSilentChannel) {
                try {
                    val notificationJson = JSObject(localNotification.source ?: "{}")
                    LocalNotificationsPlugin.fireReceived(notificationJson)
                } catch (e: JSONException) {
                }
            }
            localNotification.id?.let {
                notificationManager.notify(it, buildNotification)
                if (!isSilentChannel && (buildNotification.flags and Notification.FLAG_INSISTENT) != 0) {
                    scheduleMuteAfterOneMinute(it, localNotification.source)
                }
            }`;

const patchedImmediateNotify = `            if (!isSilentChannel) {
                try {
                    val notificationJson = JSObject(localNotification.source ?: "{}")
                    LocalNotificationsPlugin.fireReceived(notificationJson)
                } catch (e: JSONException) {
                }
            }
            localNotification.id?.let {
                notificationManager.notify(it, buildNotification)
                if (!isSilentChannel && (buildNotification.flags and Notification.FLAG_INSISTENT) != 0) {
                    scheduleMuteAfterOneMinute(it, localNotification.source)
                    YaadAlarmPopupActivity.launch(context, it, localNotification.source)
                }
            }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'scheduleMuteAfterOneMinute and YaadAlarmPopupActivity on immediate notify',
  origImmediateNotify,
  patchedImmediateNotify,
  'YaadAlarmPopupActivity.launch(context, it, localNotification.source)',
  [legacyImmediateNotifyV1]
);

const origOpenIntent = `        // Open intent
        val intent = buildIntent(localNotification, DEFAULT_PRESS_ACTION)
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getActivity(context, id, intent, flags)
        mBuilder.setContentIntent(pendingIntent)`;

const patchedOpenIntent = `        // Open intent: use a no-op Broadcast so tapping the notification body does NOT open the app
        // (Only the explicit "edit" action button should open the app)
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val bodyTapIntent = Intent(context, NotificationDismissReceiver::class.java)
        bodyTapIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
        bodyTapIntent.putExtra(ACTION_INTENT_KEY, "body_tap_noop")
        val pendingIntent = PendingIntent.getBroadcast(context, id, bodyTapIntent, flags)
        mBuilder.setContentIntent(pendingIntent)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'createActionIntents body_tap_noop contentIntent',
  origOpenIntent,
  patchedOpenIntent,
  'bodyTapIntent.putExtra(ACTION_INTENT_KEY, "body_tap_noop")'
);

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

const legacyActionLoopV1 = `        // Build action types (use PendingIntent.getBroadcast when foreground is false so app never opens on button click)
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

const replacementActionLoop = `        // Build action types (ONLY "edit" or explicit foreground actions use PendingIntent.getActivity to open the app)
        val actionTypeId = localNotification.actionTypeId
        if (actionTypeId != null) {
            val actionGroup = storage.getActionGroup(actionTypeId)
            for (notificationAction in actionGroup) {
                val isForegroundAction = (notificationAction.id == "edit" || notificationAction.isForeground()) &&
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
                actionBuilder.setShowsUserInterface(isForegroundAction)
                if (notificationAction.isInput()) {
                    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(notificationAction.title).build()
                    actionBuilder.addRemoteInput(remoteInput)
                }
                mBuilder.addAction(actionBuilder.build())
            }
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'createActionIntents foreground edit and background broadcast actions',
  targetActionLoop,
  replacementActionLoop,
  'actionBuilder.setShowsUserInterface(isForegroundAction)',
  [legacyActionLoopV1]
);

const origDeleteIntent = `        // Dismiss intent
        val dismissIntent = Intent(context, NotificationDismissReceiver::class.java)
        dismissIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        dismissIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
        dismissIntent.putExtra(ACTION_INTENT_KEY, "dismiss")`;

const patchedDeleteIntent = `        // Dismiss intent (when user swipes notification away in shade)
        val dismissIntent = Intent(context, NotificationDismissReceiver::class.java)
        dismissIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        dismissIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
        dismissIntent.putExtra(ACTION_INTENT_KEY, "swipe_dismiss")
        dismissIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'createActionIntents swipe_dismiss deleteIntent',
  origDeleteIntent,
  patchedDeleteIntent,
  'dismissIntent.putExtra(ACTION_INTENT_KEY, "swipe_dismiss")'
);

const origBuildIntentFlags = `        intent.action = Intent.ACTION_MAIN
        intent.addCategory(Intent.CATEGORY_LAUNCHER)
        intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP`;

const patchedBuildIntentFlags = `        intent.action = Intent.ACTION_MAIN
        intent.addCategory(Intent.CATEGORY_LAUNCHER)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'buildIntent FLAG_ACTIVITY_NEW_TASK for Edit action button',
  origBuildIntentFlags,
  patchedBuildIntentFlags,
  'intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP'
);

const origDismissVisible = `    private fun dismissVisibleNotification(notificationId: Int) {
        NotificationManagerCompat.from(context).cancel(notificationId)
    }`;

const patchedDismissVisible = `    private fun scheduleMuteAfterOneMinute(id: Int, sourceJson: String?) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            muteIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
            muteIntent.putExtra(ACTION_INTENT_KEY, "mute_after_1m")
            if (sourceJson != null) {
                muteIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            val pi = PendingIntent.getBroadcast(context, id + 500000, muteIntent, flags)
            val triggerAt = System.currentTimeMillis() + 60_000L
            val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
            if (canExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        } catch (e: Exception) {
            Logger.error(Logger.tags("LN"), "Failed to schedule 1m mute timer", e)
        }
    }

    private fun cancelMuteTimerForNotification(notificationId: Int) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            var flags = PendingIntent.FLAG_NO_CREATE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            val pi = PendingIntent.getBroadcast(context, notificationId + 500000, muteIntent, flags)
            if (pi != null) {
                alarmManager.cancel(pi)
                pi.cancel()
            }
        } catch (e: Exception) {
        }
    }

    private fun dismissVisibleNotification(notificationId: Int) {
        cancelMuteTimerForNotification(notificationId)
        YaadAlarmPopupActivity.dismissIfMatching(notificationId)
        NotificationManagerCompat.from(context).cancel(notificationId)
    }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'scheduleMuteAfterOneMinute and cancelMuteTimerForNotification helpers',
  origDismissVisible,
  patchedDismissVisible,
  'private fun scheduleMuteAfterOneMinute(id: Int, sourceJson: String?)'
);

// 4. Patch TimedNotificationPublisher.kt:
// - Respect actual ongoing / autoCancel flags without forcing non-ongoing notifications into insistent mode
// - Schedule 60-second mute timer (mute_after_1m) so insistent alarm rings for 1 minute and notification remains open afterward
// - Cancel any previous active notifications for the same reminderId before posting a repeat alarm so cards/sounds never stack
const publisherPath = path.join(pluginDir, 'TimedNotificationPublisher.kt');
const publisherContent = `package com.capacitorjs.plugins.localnotifications

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.getcapacitor.Logger
import java.text.SimpleDateFormat
import java.util.Date

/**
 * Creates a notification from a timer event. Registered as a broadcast receiver
 * in AndroidManifest.
 */
class TimedNotificationPublisher : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification: Notification? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(NOTIFICATION_KEY, Notification::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(NOTIFICATION_KEY)
        }
        if (notification == null) return

        notification.\`when\` = System.currentTimeMillis()

        val id = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (id == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "No valid id supplied", null)
        }
        val storage = NotificationStorage(context)
        val notificationJson = storage.getSavedNotificationAsJSObject(id.toString())
        if (notificationJson == null) {
            return
        }

        // Ignore stale notifications whose scheduled 'at' timestamp is more than 15 minutes in the past
        try {
            val scheduleObj = notificationJson.getJSObject("schedule")
            val atStr = scheduleObj?.getString("at")
            if (!atStr.isNullOrEmpty()) {
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                val atDate = sdf.parse(atStr)
                if (atDate != null && (System.currentTimeMillis() - atDate.time) > 15 * 60 * 1000L) {
                    storage.deleteNotification(id.toString())
                    return
                }
            }
        } catch (e: Exception) {
        }

        val isOngoing = if (notificationJson.has("ongoing")) {
            notificationJson.getBoolean("ongoing", false) ?: false
        } else {
            (notification.flags and Notification.FLAG_ONGOING_EVENT) != 0
        }
        val isAutoCancel = if (notificationJson != null && notificationJson.has("autoCancel")) {
            notificationJson.getBoolean("autoCancel", true) ?: true
        } else {
            (notification.flags and Notification.FLAG_AUTO_CANCEL) != 0
        }

        if (isOngoing || !isAutoCancel) {
            notification.flags = notification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                Notification.FLAG_INSISTENT
        }

        // Prevent stacking multiple insistent notifications & overlapping audio streams for the same reminder
        val reminderId = notificationJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
        if (reminderId.isNotEmpty() && id != Int.MIN_VALUE) {
            cancelPreviousActiveNotificationsForReminder(storage, notificationManager, id, reminderId)
        }

        LocalNotificationsPlugin.fireReceived(notificationJson)
        notificationManager.notify(id, notification)
        if (id != Int.MIN_VALUE && (notification.flags and Notification.FLAG_INSISTENT) != 0) {
            scheduleMuteAfterOneMinute(context, id, notificationJson.toString())
            YaadAlarmPopupActivity.launch(context, id, notificationJson.toString())
        }
        rescheduleNotificationIfNeeded(context, intent, id)
    }

    private fun scheduleMuteAfterOneMinute(context: Context, id: Int, sourceJson: String?) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            muteIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, id)
            muteIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "mute_after_1m")
            if (sourceJson != null) {
                muteIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            val pi = PendingIntent.getBroadcast(context, id + 500000, muteIntent, flags)
            val triggerAt = System.currentTimeMillis() + 60_000L
            val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
            if (canExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        } catch (e: Exception) {
            Logger.error(Logger.tags("LN"), "Failed to schedule 1m mute timer in publisher", e)
        }
    }

    private fun cancelPreviousActiveNotificationsForReminder(
        storage: NotificationStorage,
        notificationManager: NotificationManager,
        currentId: Int,
        reminderId: String
    ) {
        try {
            val relatedIds = HashSet<Int>()
            var hash = 0
            for (i in 0 until reminderId.length) {
                hash = (hash * 31 + reminderId[i].code) and 0x7fffffff
            }
            val baseId = if (hash == 0) 1 else hash
            relatedIds.add(baseId)
            for (index in 0 until 25) {
                val repeatId = ((baseId.toLong() + 1000L + index.toLong() + 1L) % 2147483647L).toInt()
                relatedIds.add(repeatId)
            }

            for (active in notificationManager.activeNotifications) {
                val activeId = active.id
                if (activeId == currentId) continue
                if (relatedIds.contains(activeId)) {
                    notificationManager.cancel(activeId)
                    continue
                }
                val savedJson = storage.getSavedNotificationAsJSObject(activeId.toString())
                val savedRemId = savedJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                if (savedRemId == reminderId) {
                    notificationManager.cancel(activeId)
                }
            }
        } catch (e: Exception) {
            Logger.error(Logger.tags("LN"), "Failed to cancel previous active notifications for reminder", e)
        }
    }

    private fun rescheduleNotificationIfNeeded(context: Context, intent: Intent, id: Int): Boolean {
        val dateString = intent.getStringExtra(CRON_KEY) ?: return false

        val date = DateMatch.fromMatchString(dateString)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val trigger = date.nextTrigger(Date())
        val clone = intent.clone() as Intent
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getBroadcast(context, id, clone, flags)
        val storedNotification = NotificationStorage(context).getSavedNotificationAsJSObject(id.toString())
        val wantsExact = storedNotification?.getBoolean("isExactNotification", true) ?: true
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
        if (wantsExact && canExact) {
            alarmManager.setExact(AlarmManager.RTC, trigger, pendingIntent)
        } else {
            if (wantsExact) {
                Logger.warn("Capacitor/LocalNotification", "Exact alarms not allowed in user settings.  Notification scheduled with non-exact alarm.")
            }
            alarmManager.set(AlarmManager.RTC, trigger, pendingIntent)
        }
        val sdf = SimpleDateFormat("yyyy/MM/dd HH:mm:ss")
        Logger.debug(Logger.tags("LN"), "notification " + id + " will next fire at " + sdf.format(Date(trigger)))
        return true
    }

    companion object {
        const val NOTIFICATION_KEY = "NotificationPublisher.notification"
        const val CRON_KEY = "NotificationPublisher.cron"
    }
}
`;

// 5. Patch NotificationChannelManager.kt to use AudioAttributes.USAGE_ALARM so notification sound loops continuously on Alarm stream
const channelManagerPath = path.join(pluginDir, 'NotificationChannelManager.kt');
let channelManagerContent = fs.readFileSync(channelManagerPath, 'utf8');
channelManagerContent = applyPatchOrVerify(
  channelManagerContent,
  'NotificationChannelManager.kt',
  'setUsage(AudioAttributes.USAGE_ALARM)',
  '.setUsage(AudioAttributes.USAGE_NOTIFICATION)',
  '.setUsage(AudioAttributes.USAGE_ALARM)',
  '.setUsage(AudioAttributes.USAGE_ALARM)'
);

// 6. Patch NotificationDismissReceiver.kt:
// - Handle "body_tap_noop" (do nothing so tapping notification body never opens app or dismisses notification)
// - Handle "mute_after_1m" (stop insistent alarm audio after 60 seconds while keeping notification & action buttons open in shade)
// - Re-post swiped ongoing notifications up to 3 times (preventing accidental swipe dismissal while allowing 4th-swipe emergency escape if ROM hides buttons)
// - Cancel all related notifications (active + scheduled) when an explicit action button is clicked
// - Record exact actionTimestamp and snoozedUntil timestamp so background Snooze syncs accurately when app opens later
const dismissReceiverContent = `package com.capacitorjs.plugins.localnotifications

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
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
 * Receiver called when a notification is swiped, muted after 1 minute, or when a background action button (Done, Snooze, Dismiss/Stop) is clicked.
 */
class NotificationDismissReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val intExtra = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (intExtra == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "Invalid notification operation", null)
            return
        }

        val actionId = intent.getStringExtra(LocalNotificationManager.ACTION_INTENT_KEY) ?: "swipe_dismiss"
        if (actionId == "body_tap_noop") {
            return
        }

        val storage = NotificationStorage(context)
        val prefs = context.getSharedPreferences("YAAD_BG_NOTIFICATION_ACTIONS", Context.MODE_PRIVATE)
        val swipeKey = "swipe_count_\$intExtra"

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

        // After 1 minute of continuous alarm ringing without user reaction, silence the alarm audio, close the 1-minute popup card,
        // keep the silent notification in the shade, and ensure the 1-minute alarm repeats every 15 minutes until the user reacts.
        if (actionId == "mute_after_1m") {
            YaadAlarmPopupActivity.dismissIfMatching(intExtra)
            try {
                val sysNotifManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                var isStillActive = false
                if (sysNotifManager != null) {
                    for (active in sysNotifManager.activeNotifications) {
                        if (active.id == intExtra) {
                            isStillActive = true
                            break
                        }
                    }
                }
                if (!isStillActive) return

                val savedJson = storage.getSavedNotificationAsJSObject(intExtra.toString()) ?: requestJson
                if (savedJson != null) {
                    val originalChannelId = savedJson.optString("channelId", "yaad_reminders_channel_v2")
                    val originalSound = savedJson.optString("sound", "digital_beep.wav")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && sysNotifManager != null) {
                        if (sysNotifManager.getNotificationChannel("yaad_channel_v2_silent") == null) {
                            val silentChannel = NotificationChannel(
                                "yaad_channel_v2_silent",
                                "YAAD Silent Persistent",
                                NotificationManager.IMPORTANCE_HIGH
                            )
                            silentChannel.setSound(null, null)
                            silentChannel.enableVibration(false)
                            sysNotifManager.createNotificationChannel(silentChannel)
                        }
                    }
                    val silentJson = JSObject(savedJson.toString())
                    silentJson.remove("schedule")
                    silentJson.remove("sound")
                    silentJson.put("channelId", "yaad_channel_v2_silent")
                    val localNotif = LocalNotification.buildNotificationFromJSObject(silentJson)
                    val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                    manager.schedule(null, listOf(localNotif))
                    storage.appendNotifications(listOf(localNotif))

                    // Ensure a 15-minute repeat alarm is scheduled if no future repeat for this reminder is already pending
                    val nowMs = System.currentTimeMillis()
                    var hasFutureRepeat = false
                    if (reminderId.isNotEmpty()) {
                        val sdfParse = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                        sdfParse.timeZone = java.util.TimeZone.getTimeZone("UTC")
                        for (savedIdStr in storage.getSavedNotificationIds()) {
                            val sId = savedIdStr.toIntOrNull() ?: continue
                            if (sId == intExtra) continue
                            val sJson = storage.getSavedNotificationAsJSObject(savedIdStr) ?: continue
                            val sRemId = sJson.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (sRemId == reminderId) {
                                val atStr = sJson.optJSONObject("schedule")?.optString("at", "") ?: ""
                                if (atStr.isNotEmpty()) {
                                    val atDate = try { sdfParse.parse(atStr) } catch (e: Exception) { null }
                                    if (atDate != null && atDate.time > nowMs) {
                                        hasFutureRepeat = true
                                        break
                                    }
                                }
                            }
                        }
                    }
                    if (!hasFutureRepeat) {
                        val nextRepeatAtMs = nowMs + 15L * 60L * 1000L
                        val repeatJson = JSObject(savedJson.toString())
                        val repeatId = if (reminderId.isNotEmpty()) {
                            ((computeBaseId(reminderId).toLong() + 1001L) % 2147483647L).toInt()
                        } else {
                            ((intExtra.toLong() + 1001L) % 2147483647L).toInt()
                        }
                        repeatJson.put("id", repeatId)
                        if (originalChannelId.isNotEmpty() && originalChannelId != "yaad_channel_v2_silent") {
                            repeatJson.put("channelId", originalChannelId)
                        } else {
                            repeatJson.put("channelId", "yaad_reminders_channel_v2")
                        }
                        if (originalSound.isNotEmpty()) {
                            repeatJson.put("sound", originalSound)
                        }
                        val sdfOut = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                        sdfOut.timeZone = java.util.TimeZone.getTimeZone("UTC")
                        val schedObj = JSObject()
                        schedObj.put("at", sdfOut.format(Date(nextRepeatAtMs)))
                        schedObj.put("allowWhileIdle", true)
                        repeatJson.put("schedule", schedObj)
                        val repeatNotif = LocalNotification.buildNotificationFromJSObject(repeatJson)
                        manager.schedule(null, listOf(repeatNotif))
                        storage.appendNotifications(listOf(repeatNotif))
                    }
                }
            } catch (e: Exception) {
                Logger.error(Logger.tags("LN"), "Failed to mute notification after 1 minute", e)
            }
            return
        }

        // If user swiped the notification without clicking an action button (Done / Snooze / Edit):
        // Re-post it immediately if it is an ongoing/persistent notification (up to 3 times as safety guard).
        if (actionId == "swipe_dismiss") {
            val existing = storage.getSavedNotification(intExtra.toString())
            if (existing != null && !existing.cancelled && (existing.ongoing || !existing.autoCancel)) {
                val swipeCount = prefs.getInt(swipeKey, 0)
                if (swipeCount < 3) {
                    prefs.edit().putInt(swipeKey, swipeCount + 1).apply()
                    try {
                        val savedJson = storage.getSavedNotificationAsJSObject(intExtra.toString()) ?: requestJson
                        if (savedJson != null) {
                            val immediateJson = JSObject(savedJson.toString())
                            immediateJson.remove("schedule")
                            val localNotif = LocalNotification.buildNotificationFromJSObject(immediateJson)
                            val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                            manager.schedule(null, listOf(localNotif))
                        }
                    } catch (e: Exception) {
                        Logger.error(Logger.tags("LN"), "Failed to restore swiped ongoing notification", e)
                    }
                    return
                } else {
                    // Emergency escape after 4 consecutive swipes: clean up and stop alarm
                    prefs.edit().remove(swipeKey).apply()
                    YaadAlarmPopupActivity.dismissIfMatching(intExtra)
                    val notificationManager = NotificationManagerCompat.from(context)
                    cancelAllRelatedNotifications(context, storage, notificationManager, intExtra, reminderId)
                    return
                }
            }
            prefs.edit().remove(swipeKey).apply()
            if (LocalNotificationManager.isSafeToForget(existing)) {
                storage.deleteNotification(intExtra.toString())
            }
            return
        }

        // Explicit background action button clicked (done, complete, snooze, stop, dismiss) — NEVER launch MainActivity!
        prefs.edit().remove(swipeKey).apply()
        YaadAlarmPopupActivity.dismissIfMatching(intExtra)
        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.cancel(intExtra)

        // Cancel all repeating notifications, mute timers, and scheduled alarms associated with this reminder
        cancelAllRelatedNotifications(context, storage, notificationManager, intExtra, reminderId)

        val actionTimeMs = System.currentTimeMillis()
        val snoozedUntilMs = actionTimeMs + 15L * 60L * 1000L

        val dataJson = JSObject()
        val results = RemoteInput.getResultsFromIntent(intent)
        if (results != null) {
            val input = results.getCharSequence(LocalNotificationManager.REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        dataJson.put("actionId", actionId)
        dataJson.put("actionTimestamp", actionTimeMs)
        if (actionId == "snooze") {
            dataJson.put("snoozedUntil", snoozedUntilMs)
        }
        if (requestJson != null) {
            dataJson.put("notification", requestJson)
        } else {
            val fallbackNotif = JSObject()
            fallbackNotif.put("id", intExtra)
            dataJson.put("notification", fallbackNotif)
        }

        val dispatched = LocalNotificationsPlugin.fireActionPerformed(dataJson)
        if (!dispatched) {
            // App WebView is not currently active: queue action for next app open
            LocalNotificationsPlugin.queueBackgroundAction(context, dataJson)

            // If user tapped Snooze while app was closed/backgrounded, natively schedule the snoozed notification for 15 minutes later
            if (actionId == "snooze" && requestJson != null) {
                try {
                    val snoozedJson = JSObject(requestJson.toString())
                    if (reminderId.isNotEmpty()) {
                        val baseId = computeBaseId(reminderId)
                        snoozedJson.put("id", baseId)
                    }
                    val origTitle = snoozedJson.getString("title") ?: ""
                    if (origTitle.startsWith("⏰ تکرار آلارم: ")) {
                        snoozedJson.put("title", origTitle.replaceFirst("⏰ تکرار آلارم: ", "🔔 یادآور: "))
                    }
                    // Ensure snoozed notification rings again on its original sound channel rather than silent channel
                    val currentChannel = snoozedJson.optString("channelId", "")
                    if (currentChannel == "yaad_channel_v2_silent") {
                        snoozedJson.put("channelId", "yaad_channel_v2_default")
                    }
                    val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                    sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                    val scheduleObj = JSObject()
                    scheduleObj.put("at", sdf.format(Date(snoozedUntilMs)))
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

    private fun computeBaseId(reminderId: String): Int {
        var hash = 0
        for (i in 0 until reminderId.length) {
            hash = (hash * 31 + reminderId[i].code) and 0x7fffffff
        }
        return if (hash == 0) 1 else hash
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
            val baseId = computeBaseId(reminderId)
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

        // Also check active status bar notifications
        try {
            val sysNotifManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            if (sysNotifManager != null && reminderId.isNotEmpty()) {
                for (active in sysNotifManager.activeNotifications) {
                    val savedJson = storage.getSavedNotificationAsJSObject(active.id.toString())
                    val savedRemId = savedJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                    if (savedRemId == reminderId) {
                        idsToCancel.add(active.id)
                    }
                }
            }
        } catch (e: Exception) {
        }

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        var flags = PendingIntent.FLAG_NO_CREATE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }

        val prefs = context.getSharedPreferences("YAAD_BG_NOTIFICATION_ACTIONS", Context.MODE_PRIVATE)
        val prefsEditor = prefs.edit()

        for (id in idsToCancel) {
            notificationManager.cancel(id)
            prefsEditor.remove("swipe_count_\$id")
            val alarmIntent = Intent(context, TimedNotificationPublisher::class.java)
            val pi = PendingIntent.getBroadcast(context, id, alarmIntent, flags)
            if (pi != null) {
                alarmManager.cancel(pi)
                pi.cancel()
            }
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            val mutePi = PendingIntent.getBroadcast(context, id + 500000, muteIntent, flags)
            if (mutePi != null) {
                alarmManager.cancel(mutePi)
                mutePi.cancel()
            }
            storage.deleteNotification(id.toString())
        }
        prefsEditor.apply()
    }
}
`;

// 7. Patch LocalNotificationsPlugin.kt to add:
// - Permission aliases (microphone, camera, location) & full Android OS permission checking (display, microphone, camera, location, storage)
// - Stale notification purge on load() before LegacyNotificationMigrator runs
// - Cold-start launch intent handling so tapping "Edit" button when app is closed still delivers localNotificationActionPerformed
// - fireActionPerformed, handleOnResume flush, and deduplicated background action queue
const pluginPath = path.join(pluginDir, 'LocalNotificationsPlugin.kt');
let pluginContent = fs.readFileSync(pluginPath, 'utf8');

const origPluginAnnotation = `@CapacitorPlugin(
    name = "LocalNotifications",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = LocalNotificationsPlugin.LOCAL_NOTIFICATIONS)
    ]
)`;

const patchedPluginAnnotation = `@CapacitorPlugin(
    name = "LocalNotifications",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = LocalNotificationsPlugin.LOCAL_NOTIFICATIONS),
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION], alias = "location")
    ]
)`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  '@CapacitorPlugin permissions aliases (microphone, camera, location)',
  origPluginAnnotation,
  patchedPluginAnnotation,
  'Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")'
);

const origPluginLoad = `        LegacyNotificationMigrator.run(context, notificationStorage, manager)
    }`;

const legacyPluginLoad = `        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV2 = `        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV3 = `        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV4 = `        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const patchedPluginLoad = `        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'load configureWebViewForGoogleOAuth, purgeStaleOneShotNotifications, cold-start launch intent, and handleOnResume flushQueuedBackgroundActions',
  origPluginLoad,
  patchedPluginLoad,
  'configureWebViewForGoogleOAuth()',
  [legacyPluginLoad, legacyPluginLoadV2, legacyPluginLoadV3, legacyPluginLoadV4]
);

const origHandleOnNewIntent = `    override fun handleOnNewIntent(data: Intent) {
        super.handleOnNewIntent(data)
        if (Intent.ACTION_MAIN != data.action) {
            return
        }
        val dataJson = manager.handleNotificationActionPerformed(data, notificationStorage)
        if (dataJson != null) {
            notifyListeners("localNotificationActionPerformed", dataJson, true)
        }
    }`;

const patchedHandleOnNewIntent = `    override fun handleOnNewIntent(data: Intent) {
        super.handleOnNewIntent(data)
        if (Intent.ACTION_MAIN != data.action) {
            return
        }
        if (data.getBooleanExtra("yaad_handled_launch_intent", false)) {
            return
        }
        data.putExtra("yaad_handled_launch_intent", true)
        val dataJson = manager.handleNotificationActionPerformed(data, notificationStorage)
        if (dataJson != null) {
            notifyListeners("localNotificationActionPerformed", dataJson, true)
        }
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'handleOnNewIntent deduplication guard',
  origHandleOnNewIntent,
  patchedHandleOnNewIntent,
  'data.getBooleanExtra("yaad_handled_launch_intent", false)'
);

const origPermissionsBlock = `    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            val permissionsResultJSON = JSObject()
            permissionsResultJSON.put("display", getNotificationPermissionText())
            call.resolve(permissionsResultJSON)
        } else {
            super.checkPermissions(call)
        }
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            val permissionsResultJSON = JSObject()
            permissionsResultJSON.put("display", getNotificationPermissionText())
            call.resolve(permissionsResultJSON)
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

const patchedPermissionsBlock = `    private fun buildAllPermissionsJSON(): JSObject {
        val permissionsResultJSON = JSObject()
        val notifEnabled = manager.areNotificationsEnabled() && (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        )
        permissionsResultJSON.put("display", if (notifEnabled) "granted" else "denied")
        val micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("microphone", if (micGranted) "granted" else "denied")

        val camGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("camera", if (camGranted) "granted" else "denied")

        val locGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("location", if (locGranted) "granted" else "denied")

        // Strict storage check: on Android 11+ (API 30+), creating backup folder in shared storage requires All Files Access
        val storageGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.os.Environment.isExternalStorageManager()
        } else {
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
                androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        permissionsResultJSON.put("storage", if (storageGranted) "granted" else "denied")
        return permissionsResultJSON
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildAllPermissionsJSON())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val requested = call.getArray("permissions")
        if (requested != null && requested.length() > 0) {
            val firstAlias = requested.optString(0, LOCAL_NOTIFICATIONS)
            if (firstAlias == "microphone" || firstAlias == "camera" || firstAlias == "location") {
                if (getPermissionState(firstAlias) == PermissionState.GRANTED) {
                    call.resolve(buildAllPermissionsJSON())
                } else {
                    requestPermissionForAlias(firstAlias, call, "permissionsCallback")
                }
                return
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(buildAllPermissionsJSON())
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

const legacyPermissionsBlockV2 = `    private fun buildAllPermissionsJSON(): JSObject {
        val permissionsResultJSON = JSObject()
        permissionsResultJSON.put("display", getNotificationPermissionText())
        val micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("microphone", if (micGranted) "granted" else "denied")

        val camGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("camera", if (camGranted) "granted" else "denied")

        val locGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("location", if (locGranted) "granted" else "denied")

        val storageGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.os.Environment.isExternalStorageManager() ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    androidx.core.content.ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.READ_MEDIA_IMAGES
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED)
        } else {
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
                androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        permissionsResultJSON.put("storage", if (storageGranted) "granted" else "denied")
        return permissionsResultJSON
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildAllPermissionsJSON())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val requested = call.getArray("permissions")
        if (requested != null && requested.length() > 0) {
            val firstAlias = requested.optString(0, LOCAL_NOTIFICATIONS)
            if (firstAlias == "microphone" || firstAlias == "camera" || firstAlias == "location") {
                if (getPermissionState(firstAlias) == PermissionState.GRANTED) {
                    call.resolve(buildAllPermissionsJSON())
                } else {
                    requestPermissionForAlias(firstAlias, call, "permissionsCallback")
                }
                return
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(buildAllPermissionsJSON())
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

const legacyPermissionsBlockV1 = `    private fun buildAllPermissionsJSON(): JSObject {
        val permissionsResultJSON = JSObject()
        permissionsResultJSON.put("display", getNotificationPermissionText())
        val micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("microphone", if (micGranted) "granted" else "denied")

        val camGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("camera", if (camGranted) "granted" else "denied")

        val locGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("location", if (locGranted) "granted" else "denied")

        val storageGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.os.Environment.isExternalStorageManager()
        } else {
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        permissionsResultJSON.put("storage", if (storageGranted) "granted" else "denied")
        return permissionsResultJSON
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildAllPermissionsJSON())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val requested = call.getArray("permissions")
        if (requested != null && requested.length() > 0) {
            val firstAlias = requested.optString(0, LOCAL_NOTIFICATIONS)
            if (firstAlias == "microphone" || firstAlias == "camera" || firstAlias == "location") {
                requestPermissionForAlias(firstAlias, call, "permissionsCallback")
                return
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(buildAllPermissionsJSON())
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'checkPermissions and requestPermissions for all app permissions',
  origPermissionsBlock,
  patchedPermissionsBlock,
  '// Strict storage check: on Android 11+ (API 30+), creating backup folder in shared storage requires All Files Access',
  [legacyPermissionsBlockV1, legacyPermissionsBlockV2]
);

const origPermCallback = `    @PermissionCallback
    private fun permissionsCallback(call: PluginCall) {
        val permissionsResultJSON = JSObject()
        permissionsResultJSON.put("display", getNotificationPermissionText())
        call.resolve(permissionsResultJSON)
    }`;

const patchedPermCallback = `    @PermissionCallback
    private fun permissionsCallback(call: PluginCall) {
        // Resolve all native permissions status after dialog
        call.resolve(buildAllPermissionsJSON())
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'permissionsCallback returning buildAllPermissionsJSON',
  origPermCallback,
  patchedPermCallback,
  '// Resolve all native permissions status after dialog'
);

const origDispatchReceived = `    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }`;

const patchedDispatchReceived = `    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }

    internal fun dispatchActionPerformed(dataJson: JSObject) {
        notifyListeners("localNotificationActionPerformed", dataJson, true)
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'dispatchActionPerformed',
  origDispatchReceived,
  patchedDispatchReceived,
  'internal fun dispatchActionPerformed(dataJson: JSObject)'
);

const origCompanionFire = `        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }`;

const legacyCompanionFire = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            if (instance != null) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                arr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, arr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const patchedCompanionFire = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'companion fireActionPerformed and deduplicated queueBackgroundAction',
  origCompanionFire,
  patchedCompanionFire,
  'val filteredArr = JSONArray()',
  [legacyCompanionFire]
);

// 8. Create standalone YaadAlarmPopupActivity.kt (Out-of-app minimal theme-matched 1-minute notification card)
const popupActivityPath = path.join(pluginDir, 'YaadAlarmPopupActivity.kt');
const popupActivityContent = `package com.capacitorjs.plugins.localnotifications

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import java.lang.ref.WeakReference

/**
 * Standalone out-of-app minimal notification card that displays for 1 minute alongside the alarm
 * without opening the main YAAD app (unless the user explicitly clicks the "Edit" button).
 * Matches the user's selected app theme.
 */
class YaadAlarmPopupActivity : Activity() {

    private var notificationId: Int = Int.MIN_VALUE
    private var sourceJson: String? = null
    private var requestJson: JSObject? = null
    private var countDownTimer: CountDownTimer? = null
    private var progressFillView: View? = null
    private var progressTrackView: FrameLayout? = null
    private var timerTextView: TextView? = null
    private var isPersian: Boolean = true

    data class ThemePalette(
        val cardBg: Int,
        val cardBorder: Int,
        val titleColor: Int,
        val bodyColor: Int,
        val mutedColor: Int,
        val accentColor: Int,
        val doneBtnBg: Int,
        val doneBtnText: Int,
        val secondaryBtnBg: Int,
        val secondaryBtnBorder: Int,
        val secondaryBtnText: Int,
        val editBtnBg: Int,
        val editBtnBorder: Int,
        val editBtnText: Int
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DIM_BEHIND
        )
        window.setDimAmount(0.55f)
        setFinishOnTouchOutside(false)

        activeInstance = WeakReference(this)
        bindFromIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            bindFromIntent(intent)
        }
    }

    private fun dp(value: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            resources.displayMetrics
        ).toInt()
    }

    private fun toPersianDigits(input: String): String {
        val persian = charArrayOf('۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹')
        val sb = StringBuilder(input.length)
        for (ch in input) {
            if (ch in '0'..'9') {
                sb.append(persian[ch - '0'])
            } else {
                sb.append(ch)
            }
        }
        return sb.toString()
    }

    private fun resolvePalette(themeName: String): ThemePalette {
        return when (themeName) {
            "dark-slate" -> ThemePalette(
                cardBg = Color.parseColor("#11223D"),
                cardBorder = Color.parseColor("#0EA5E9"),
                titleColor = Color.parseColor("#EFF6FF"),
                bodyColor = Color.parseColor("#BAE6FD"),
                mutedColor = Color.parseColor("#7DD3FC"),
                accentColor = Color.parseColor("#38BDF8"),
                doneBtnBg = Color.parseColor("#0284C7"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#193154"),
                secondaryBtnBorder = Color.parseColor("#274875"),
                secondaryBtnText = Color.parseColor("#EFF6FF"),
                editBtnBg = Color.parseColor("#0E1F38"),
                editBtnBorder = Color.parseColor("#0EA5E9"),
                editBtnText = Color.parseColor("#38BDF8")
            )
            "system" -> {
                val isNight = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
                if (isNight) {
                    ThemePalette(
                        cardBg = Color.parseColor("#1C2126"),
                        cardBorder = Color.parseColor("#14B8A6"),
                        titleColor = Color.parseColor("#F1F5F9"),
                        bodyColor = Color.parseColor("#CBD5E1"),
                        mutedColor = Color.parseColor("#94A3B8"),
                        accentColor = Color.parseColor("#2DD4BF"),
                        doneBtnBg = Color.parseColor("#0D9488"),
                        doneBtnText = Color.parseColor("#FFFFFF"),
                        secondaryBtnBg = Color.parseColor("#252C33"),
                        secondaryBtnBorder = Color.parseColor("#333D47"),
                        secondaryBtnText = Color.parseColor("#F1F5F9"),
                        editBtnBg = Color.parseColor("#191E23"),
                        editBtnBorder = Color.parseColor("#14B8A6"),
                        editBtnText = Color.parseColor("#2DD4BF")
                    )
                } else {
                    ThemePalette(
                        cardBg = Color.parseColor("#FFFFFF"),
                        cardBorder = Color.parseColor("#0D9488"),
                        titleColor = Color.parseColor("#0F172A"),
                        bodyColor = Color.parseColor("#334155"),
                        mutedColor = Color.parseColor("#64748B"),
                        accentColor = Color.parseColor("#0D9488"),
                        doneBtnBg = Color.parseColor("#0D9488"),
                        doneBtnText = Color.parseColor("#FFFFFF"),
                        secondaryBtnBg = Color.parseColor("#F1F5F9"),
                        secondaryBtnBorder = Color.parseColor("#CBD5E1"),
                        secondaryBtnText = Color.parseColor("#0F172A"),
                        editBtnBg = Color.parseColor("#F0FDFA"),
                        editBtnBorder = Color.parseColor("#0D9488"),
                        editBtnText = Color.parseColor("#0F766E")
                    )
                }
            }
            "light-clean" -> ThemePalette(
                cardBg = Color.parseColor("#FFFFFF"),
                cardBorder = Color.parseColor("#0D9488"),
                titleColor = Color.parseColor("#1C1917"),
                bodyColor = Color.parseColor("#44403C"),
                mutedColor = Color.parseColor("#78716C"),
                accentColor = Color.parseColor("#0D9488"),
                doneBtnBg = Color.parseColor("#0D9488"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#F5F5F4"),
                secondaryBtnBorder = Color.parseColor("#D6D3D1"),
                secondaryBtnText = Color.parseColor("#1C1917"),
                editBtnBg = Color.parseColor("#F0FDFA"),
                editBtnBorder = Color.parseColor("#0D9488"),
                editBtnText = Color.parseColor("#0F766E")
            )
            "jade_warm_light" -> ThemePalette(
                cardBg = Color.parseColor("#F7F6F0"),
                cardBorder = Color.parseColor("#168779"),
                titleColor = Color.parseColor("#202A29"),
                bodyColor = Color.parseColor("#3D4B49"),
                mutedColor = Color.parseColor("#5C6B68"),
                accentColor = Color.parseColor("#168779"),
                doneBtnBg = Color.parseColor("#168779"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#EFEFE8"),
                secondaryBtnBorder = Color.parseColor("#DDE1DA"),
                secondaryBtnText = Color.parseColor("#202A29"),
                editBtnBg = Color.parseColor("#DDEFEA"),
                editBtnBorder = Color.parseColor("#168779"),
                editBtnText = Color.parseColor("#168779")
            )
            "midnight_blue_silver" -> ThemePalette(
                cardBg = Color.parseColor("#202B3A"),
                cardBorder = Color.parseColor("#9CBCE0"),
                titleColor = Color.parseColor("#F0F3F7"),
                bodyColor = Color.parseColor("#C5D9EE"),
                mutedColor = Color.parseColor("#9CBCE0"),
                accentColor = Color.parseColor("#9CBCE0"),
                doneBtnBg = Color.parseColor("#9CBCE0"),
                doneBtnText = Color.parseColor("#101722"),
                secondaryBtnBg = Color.parseColor("#172130"),
                secondaryBtnBorder = Color.parseColor("#39475A"),
                secondaryBtnText = Color.parseColor("#F0F3F7"),
                editBtnBg = Color.parseColor("#293648"),
                editBtnBorder = Color.parseColor("#9CBCE0"),
                editBtnText = Color.parseColor("#C5D9EE")
            )
            "sketch-contrast" -> ThemePalette(
                cardBg = Color.parseColor("#09090B"),
                cardBorder = Color.parseColor("#2DD4BF"),
                titleColor = Color.parseColor("#FFFFFF"),
                bodyColor = Color.parseColor("#D4D4D8"),
                mutedColor = Color.parseColor("#A1A1AA"),
                accentColor = Color.parseColor("#2DD4BF"),
                doneBtnBg = Color.parseColor("#0D9488"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#18181B"),
                secondaryBtnBorder = Color.parseColor("#2DD4BF"),
                secondaryBtnText = Color.parseColor("#5EEAD4"),
                editBtnBg = Color.parseColor("#18181B"),
                editBtnBorder = Color.parseColor("#FFFFFF"),
                editBtnText = Color.parseColor("#FFFFFF")
            )
            else -> ThemePalette(
                cardBg = Color.parseColor("#101222"),
                cardBorder = Color.parseColor("#6366F1"),
                titleColor = Color.parseColor("#F3F4F8"),
                bodyColor = Color.parseColor("#C7CBF0"),
                mutedColor = Color.parseColor("#8A90BD"),
                accentColor = Color.parseColor("#818CF8"),
                doneBtnBg = Color.parseColor("#4F46E5"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#191C33"),
                secondaryBtnBorder = Color.parseColor("#282C4A"),
                secondaryBtnText = Color.parseColor("#F3F4F8"),
                editBtnBg = Color.parseColor("#191C33"),
                editBtnBorder = Color.parseColor("#6366F1"),
                editBtnText = Color.parseColor("#818CF8")
            )
        }
    }

    private fun makeRoundedDrawable(bgColor: Int, borderColor: Int, strokeDp: Float, radiusDp: Float): GradientDrawable {
        val gd = GradientDrawable()
        gd.shape = GradientDrawable.RECTANGLE
        gd.setColor(bgColor)
        gd.cornerRadius = dp(radiusDp).toFloat()
        if (strokeDp > 0f) {
            gd.setStroke(dp(strokeDp), borderColor)
        }
        return gd
    }

    private fun bindFromIntent(data: Intent?) {
        if (data == null) {
            finish()
            return
        }
        notificationId = data.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        activeNotificationId = notificationId
        sourceJson = data.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY)

        val storage = NotificationStorage(this)
        if (sourceJson != null) {
            try {
                requestJson = JSObject(sourceJson)
            } catch (e: Exception) {
            }
        }
        if (requestJson == null && notificationId != Int.MIN_VALUE) {
            requestJson = storage.getSavedNotificationAsJSObject(notificationId.toString())
            if (sourceJson == null && requestJson != null) {
                sourceJson = requestJson.toString()
            }
        }

        val extraObj = requestJson?.optJSONObject("extra")
        val themeName = extraObj?.optString("theme", "dark-gold")?.takeIf { it.isNotEmpty() } ?: "dark-gold"
        val lang = extraObj?.optString("language", "fa")?.takeIf { it.isNotEmpty() } ?: "fa"
        isPersian = lang != "en"

        val rawTitle = requestJson?.getString("title") ?: (if (isPersian) "یادآور" else "Reminder")
        val cleanTitle = rawTitle.replaceFirst("🔔 یادآور: ", "").replaceFirst("یادآور: ", "").replaceFirst("🔔 ", "").trim()
        val bodyText = requestJson?.getString("body") ?: ""

        val palette = resolvePalette(themeName)
        buildMinimalCardUI(palette, cleanTitle, bodyText)
        startOneMinuteCountdown()
    }

    private fun buildMinimalCardUI(palette: ThemePalette, titleStr: String, bodyStr: String) {
        val root = FrameLayout(this)
        root.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.setPadding(dp(16f), dp(36f), dp(16f), dp(16f))

        val cardContainer = LinearLayout(this)
        cardContainer.orientation = LinearLayout.VERTICAL
        cardContainer.layoutDirection = if (isPersian) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        cardContainer.background = makeRoundedDrawable(palette.cardBg, palette.cardBorder, 1.8f, 24f)
        cardContainer.elevation = dp(16f).toFloat()

        val cardParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        cardParams.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        cardContainer.layoutParams = cardParams

        // 1. Minimal 60s top progress bar inside card
        val track = FrameLayout(this)
        val trackParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(4f)
        )
        trackParams.setMargins(dp(18f), dp(12f), dp(18f), 0)
        track.layoutParams = trackParams
        track.background = makeRoundedDrawable(Color.argb(40, 128, 128, 128), Color.TRANSPARENT, 0f, 2f)

        val fill = View(this)
        val fillParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        fill.layoutParams = fillParams
        fill.background = makeRoundedDrawable(palette.accentColor, Color.TRANSPARENT, 0f, 2f)
        track.addView(fill)
        progressTrackView = track
        progressFillView = fill
        cardContainer.addView(track)

        // Inner content container
        val content = LinearLayout(this)
        content.orientation = LinearLayout.VERTICAL
        content.setPadding(dp(18f), dp(14f), dp(18f), dp(18f))

        // Header row: Official App Icon + Brand label + 60s countdown + close button
        val headerRow = LinearLayout(this)
        headerRow.orientation = LinearLayout.HORIZONTAL
        headerRow.gravity = Gravity.CENTER_VERTICAL

        try {
            val appIconView = android.widget.ImageView(this)
            val appDrawable = packageManager.getApplicationIcon(applicationInfo)
            appIconView.setImageDrawable(appDrawable)
            appIconView.scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            val iconSize = dp(24f)
            val iconParams = LinearLayout.LayoutParams(iconSize, iconSize)
            if (isPersian) {
                iconParams.leftMargin = dp(8f)
            } else {
                iconParams.rightMargin = dp(8f)
            }
            appIconView.layoutParams = iconParams
            headerRow.addView(appIconView)
        } catch (e: Exception) {
        }

        val brandTv = TextView(this)
        brandTv.text = if (isPersian) "یادآور هوشمند یاد" else "YAAD Reminder"
        brandTv.setTextColor(palette.accentColor)
        brandTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        brandTv.setTypeface(Typeface.DEFAULT_BOLD)
        val brandParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        brandTv.layoutParams = brandParams
        headerRow.addView(brandTv)

        val timerTv = TextView(this)
        timerTv.text = if (isPersian) "۰۰:۶۰" else "00:60"
        timerTv.setTextColor(palette.mutedColor)
        timerTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        timerTv.setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        timerTv.setPadding(dp(8f), 0, dp(8f), 0)
        timerTextView = timerTv
        headerRow.addView(timerTv)

        val closeTv = TextView(this)
        closeTv.text = "✕"
        closeTv.setTextColor(palette.mutedColor)
        closeTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        closeTv.setPadding(dp(6f), dp(2f), dp(6f), dp(2f))
        closeTv.setOnClickListener {
            performBackgroundAction("mute_after_1m")
        }
        headerRow.addView(closeTv)
        content.addView(headerRow)

        // Reminder Title
        val titleTv = TextView(this)
        titleTv.text = titleStr
        titleTv.setTextColor(palette.titleColor)
        titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17.5f)
        titleTv.setTypeface(Typeface.DEFAULT_BOLD)
        titleTv.maxLines = 2
        titleTv.ellipsize = TextUtils.TruncateAt.END
        val titleParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        titleParams.topMargin = dp(10f)
        titleTv.layoutParams = titleParams
        content.addView(titleTv)

        // Reminder Body / Time
        if (bodyStr.isNotEmpty()) {
            val bodyTv = TextView(this)
            bodyTv.text = bodyStr
            bodyTv.setTextColor(palette.bodyColor)
            bodyTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            bodyTv.maxLines = 3
            bodyTv.ellipsize = TextUtils.TruncateAt.END
            val bodyParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            bodyParams.topMargin = dp(4f)
            bodyTv.layoutParams = bodyParams
            content.addView(bodyTv)
        }

        // Action Buttons Row: 1. Done (انجام شد), 2. Snooze (تعویق), 3. Edit (ویرایش)
        val actionsRow = LinearLayout(this)
        actionsRow.orientation = LinearLayout.HORIZONTAL
        actionsRow.gravity = Gravity.CENTER
        val actionsParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        actionsParams.topMargin = dp(16f)
        actionsRow.layoutParams = actionsParams

        // Button 1: Done (does NOT open app)
        val doneBtn = buildActionButton(
            text = if (isPersian) "✓ انجام شد" else "✓ Done",
            bgColor = palette.doneBtnBg,
            borderColor = Color.TRANSPARENT,
            textColor = palette.doneBtnText,
            strokeDp = 0f
        ) {
            performBackgroundAction("done")
        }

        // Button 2: Snooze (does NOT open app)
        val snoozeBtn = buildActionButton(
            text = if (isPersian) "⏱ تعویق" else "⏱ Snooze",
            bgColor = palette.secondaryBtnBg,
            borderColor = palette.secondaryBtnBorder,
            textColor = palette.secondaryBtnText,
            strokeDp = 1.2f
        ) {
            performBackgroundAction("snooze")
        }

        // Button 3: Edit (OPENS app and goes to Edit Reminder modal)
        val editBtn = buildActionButton(
            text = if (isPersian) "✎ ویرایش" else "✎ Edit",
            bgColor = palette.editBtnBg,
            borderColor = palette.editBtnBorder,
            textColor = palette.editBtnText,
            strokeDp = 1.2f
        ) {
            performEditAction()
        }

        val btnMargin = dp(4f)
        (doneBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        (snoozeBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        (editBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)

        actionsRow.addView(doneBtn)
        actionsRow.addView(snoozeBtn)
        actionsRow.addView(editBtn)
        content.addView(actionsRow)

        cardContainer.addView(content)
        root.addView(cardContainer)
        setContentView(root)
    }

    private fun buildActionButton(
        text: String,
        bgColor: Int,
        borderColor: Int,
        textColor: Int,
        strokeDp: Float,
        onClick: () -> Unit
    ): TextView {
        val btn = TextView(this)
        btn.text = text
        btn.gravity = Gravity.CENTER
        btn.setTextColor(textColor)
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        btn.setTypeface(Typeface.DEFAULT_BOLD)
        btn.setSingleLine(true)
        btn.ellipsize = TextUtils.TruncateAt.END
        btn.setPadding(dp(8f), dp(11f), dp(8f), dp(11f))
        btn.background = makeRoundedDrawable(bgColor, borderColor, strokeDp, 14f)
        btn.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        btn.setOnClickListener { onClick() }
        return btn
    }

    private fun startOneMinuteCountdown() {
        countDownTimer?.cancel()
        countDownTimer = object : CountDownTimer(60_000L, 1_000L) {
            override fun onTick(millisUntilFinished: Long) {
                val secs = ((millisUntilFinished + 999L) / 1000L).toInt().coerceIn(0, 60)
                val formatted = String.format("00:%02d", secs)
                timerTextView?.text = if (isPersian) toPersianDigits(formatted) else formatted
                val trackWidth = progressTrackView?.width ?: 0
                if (trackWidth > 0) {
                    val newWidth = ((millisUntilFinished.toFloat() / 60_000f) * trackWidth).toInt().coerceAtLeast(0)
                    val lp = progressFillView?.layoutParams
                    if (lp != null) {
                        lp.width = newWidth
                        progressFillView?.layoutParams = lp
                    }
                }
            }

            override fun onFinish() {
                performBackgroundAction("mute_after_1m")
            }
        }.start()
    }

    private fun performBackgroundAction(actionId: String) {
        countDownTimer?.cancel()
        try {
            val broadcastIntent = Intent(this, NotificationDismissReceiver::class.java)
            broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            broadcastIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, actionId)
            if (sourceJson != null) {
                broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            sendBroadcast(broadcastIntent)
        } catch (e: Exception) {
        }
        finish()
        overridePendingTransition(0, 0)
    }

    private fun performEditAction() {
        countDownTimer?.cancel()
        try {
            if (notificationId != Int.MIN_VALUE) {
                NotificationManagerCompat.from(this).cancel(notificationId)
                val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val muteIntent = Intent(this, NotificationDismissReceiver::class.java)
                var flags = PendingIntent.FLAG_NO_CREATE
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    flags = flags or PendingIntent.FLAG_MUTABLE
                }
                val mutePi = PendingIntent.getBroadcast(this, notificationId + 500000, muteIntent, flags)
                if (mutePi != null) {
                    alarmManager.cancel(mutePi)
                    mutePi.cancel()
                }
            }
        } catch (e: Exception) {
        }

        val dataJson = JSObject()
        dataJson.put("actionId", "edit")
        dataJson.put("actionTimestamp", System.currentTimeMillis())
        if (requestJson != null) {
            dataJson.put("notification", requestJson)
        }
        val dispatched = LocalNotificationsPlugin.fireActionPerformed(dataJson)
        if (!dispatched) {
            LocalNotificationsPlugin.queueBackgroundAction(this, dataJson)
        }

        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            if (launchIntent != null) {
                launchIntent.action = Intent.ACTION_MAIN
                launchIntent.addCategory(Intent.CATEGORY_LAUNCHER)
                launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                launchIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                launchIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "edit")
                if (sourceJson != null) {
                    launchIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                }
                startActivity(launchIntent)
            }
        } catch (e: Exception) {
        }
        finish()
        overridePendingTransition(0, 0)
    }

    override fun onDestroy() {
        countDownTimer?.cancel()
        if (activeInstance?.get() === this) {
            activeInstance = null
        }
        super.onDestroy()
    }

    companion object {
        private var activeInstance: WeakReference<YaadAlarmPopupActivity>? = null
        private var activeNotificationId: Int = Int.MIN_VALUE

        fun dismissIfMatching(notificationId: Int) {
            val act = activeInstance?.get() ?: return
            if (activeNotificationId == notificationId || notificationId == Int.MIN_VALUE) {
                act.runOnUiThread {
                    try {
                        if (!act.isFinishing && !act.isDestroyed) {
                            act.countDownTimer?.cancel()
                            act.finish()
                            act.overridePendingTransition(0, 0)
                        }
                    } catch (e: Exception) {
                    }
                }
            }
        }

        fun launch(context: Context, notificationId: Int, sourceJson: String?) {
            try {
                val intent = Intent(context, YaadAlarmPopupActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                intent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                if (sourceJson != null) {
                    intent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                // Handled by setFullScreenIntent when background activity start is restricted
            }
        }
    }
}
`;

// 9. Patch plugin AndroidManifest.xml to register YaadAlarmPopupActivity and USE_FULL_SCREEN_INTENT
const manifestPath = path.join(pluginRoot, 'android/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifestContent = fs.readFileSync(manifestPath, 'utf8');
  if (!manifestContent.includes('YaadAlarmPopupActivity')) {
    manifestContent = manifestContent.replace(
      '<application>',
      `<application>
        <activity
            android:name="com.capacitorjs.plugins.localnotifications.YaadAlarmPopupActivity"
            android:theme="@android:style/Theme.Translucent.NoTitleBar"
            android:exported="false"
            android:launchMode="singleTop"
            android:taskAffinity=""
            android:excludeFromRecents="true"
            android:showOnLockScreen="true"
            android:turnScreenOn="true"
            android:configChanges="orientation|screenSize|keyboardHidden|uiMode" />`
    );
  }
  if (!manifestContent.includes('android.permission.USE_FULL_SCREEN_INTENT')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>\n</manifest>`
    );
  }
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');
}

fs.writeFileSync(path.join(pluginDir, 'NotificationAction.kt'), notificationActionContent, 'utf8');
fs.writeFileSync(notificationStoragePath, notificationStorageContent, 'utf8');
fs.writeFileSync(managerPath, managerContent, 'utf8');
fs.writeFileSync(publisherPath, publisherContent, 'utf8');
fs.writeFileSync(channelManagerPath, channelManagerContent, 'utf8');
fs.writeFileSync(path.join(pluginDir, 'NotificationDismissReceiver.kt'), dismissReceiverContent, 'utf8');
fs.writeFileSync(pluginPath, pluginContent, 'utf8');
fs.writeFileSync(popupActivityPath, popupActivityContent, 'utf8');

console.log(
  `[patch-capacitor-notifications] Successfully patched and verified @capacitor/local-notifications@${pluginVersion} (with YaadAlarmPopupActivity).`
);

