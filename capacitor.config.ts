import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'edu.minsu.attendance',
  appName: 'MinSU Attendance',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
