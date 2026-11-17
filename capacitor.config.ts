const config = {
  appId: 'com.yaad.reminder',
  appName: 'YAAD',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: false,
    allowNavigation: [],
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#FF8C00',
      sound: 'beep.wav',
    },
  },
};

export default config;

