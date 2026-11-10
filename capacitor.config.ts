import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kaykays.app',
  appName: "KayKay's",
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    // Show pushes as system notifications while the app is open too (Android shows them
    // itself only when the app is in the background).
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_milk_alarm',
      iconColor: '#F59E0B',
    },
    Keyboard: {
      resize: 'body',
    },
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
      launchFadeOutDuration: 400,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
      backgroundColor: '#ffffff'
    }
  }
};

export default config;
