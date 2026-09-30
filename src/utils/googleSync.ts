import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut as fbSignOut,
  User 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { Reminder, IdeaNote } from '../types';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Workspace Scopes requested
provider.addScope('https://www.googleapis.com/auth/calendar.events');
provider.addScope('https://www.googleapis.com/auth/tasks');

// In-memory token storage (DO NOT store in localStorage per security guidelines)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initGoogleAuth = (
  onSuccess?: (user: User, token: string) => void,
  onSignedOut?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onSuccess) onSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Needs fresh sign-in to obtain access token
        cachedAccessToken = null;
        if (onSignedOut) onSignedOut();
      }
    } else {
      cachedAccessToken = null;
      if (onSignedOut) onSignedOut();
    }
  });
};

export const signInWithGoogle = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('توکن دسترسی گوگل یافت نشد.');
    }
    cachedAccessToken = credential.accessToken;
    isSigningIn = false;
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error) {
    isSigningIn = false;
    throw error;
  }
};

export const signOutGoogle = async () => {
  cachedAccessToken = null;
  await fbSignOut(auth);
};

export const getCachedToken = () => cachedAccessToken;

/**
 * Sync Reminder to Google Calendar as an event
 */
export async function syncReminderToCalendar(reminder: Reminder, token: string): Promise<string> {
  const startTime = new Date(reminder.dueTimestamp);
  const endTime = new Date(reminder.dueTimestamp + 30 * 60 * 1000); // 30 min duration

  const eventPayload = {
    summary: reminder.title,
    description: `${reminder.description || ''}\n[ثبت‌شده توسط اپلیکیشن یادآور هوشمند - دسته: ${reminder.category}]`,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 10 },
        { method: 'popup', minutes: 0 },
      ],
    },
  };

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventPayload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'خطا در ثبت رویداد تقویم گوگل');
  }

  const created = await response.json();
  return created.id;
}

/**
 * Sync Reminder or Idea to Google Tasks
 */
export async function syncToGoogleTasks(
  item: { title: string; description?: string; dueTimestamp?: number },
  token: string
): Promise<string> {
  const taskPayload: { title: string; notes?: string; due?: string } = {
    title: item.title,
    notes: item.description,
  };

  if (item.dueTimestamp) {
    taskPayload.due = new Date(item.dueTimestamp).toISOString();
  }

  const response = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(taskPayload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'خطا در ثبت وظیفه در Google Tasks');
  }

  const data = await response.json();
  return data.id;
}
