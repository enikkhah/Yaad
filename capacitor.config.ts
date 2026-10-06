const config = {
  appId: 'com.yaad.reminder',
  appName: 'YAAD Reminder',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#8b5cf6',
      sound: 'beep.wav',
    },
  },
};

export default config;
