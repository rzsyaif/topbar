// Edit these to taste. Everything the island needs to know about you lives here.

export const config = {
  // Weather and prayer times follow your device location (Windows location
  // service). This is only used until the first fix, or if location is off.
  fallbackLocation: {
    name: "Jakarta",
    latitude: -6.2088,
    longitude: 106.8456,
  },
  locationRefreshMinutes: 30,

  prayer: {
    // Calculation method, Asr method and per-prayer adjustments are chosen in
    // the island (welcome screen / prayer settings), not here.
    // Reminder + highlight this many minutes before each prayer...
    alertMinutesBefore: 5,
    // ...but earlier for Friday Dhuhr, to get ready for Jumu'ah.
    jumuahMinutesBefore: 30,
    // Keep showing a prayer this many minutes after it starts.
    alertMinutesAfter: 5,
    // Windows notification when a reminder starts.
    notify: true,
  },

  pomodoro: {
    focusMinutes: 25,
    breakMinutes: 5,
  },

  weather: {
    refreshMinutes: 15,
  },

  use24h: true,

  // Keep the island out of screenshots and screen recordings (it still shows
  // on your screen). Set to false if you want to capture the island itself.
  hideFromScreenCapture: true,
};
