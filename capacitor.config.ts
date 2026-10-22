const config = {
  appId: 'com.yaad.reminder',
  appName: 'YAAD',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: true,
    allowNavigation: [
      'accounts.google.com',
      '*.google.com',
      '*.googleapis.com',
      '*.firebaseapp.com',
    ],
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#8b5cf6',
      sound: 'beep.wav',
    },
    GoogleAuth: {
      scopes: [
        'profile',
        'email',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/tasks',
      ],
      serverClientId: process.env.VITE_GOOGLE_CLIENT_ID || process.env.VITE_FIREBASE_OAUTH_CLIENT_ID || '',
      androidClientId: process.env.VITE_GOOGLE_ANDROID_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;

